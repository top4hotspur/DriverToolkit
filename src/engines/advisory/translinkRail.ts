import {
  BaselineHourlyExpectation,
  RailActivityClassification,
  RailStationConfig,
  RailStationId,
  RailStationLiveSnapshot,
  RailServiceDisruption,
  TrackedPlace,
} from "../../contracts/advisory";

const TRANSLINK_STATIONS: RailStationConfig[] = [
  {
    id: "lanyon-place",
    stationCode: "LANYNPL",
    label: "Lanyon Place",
    aliases: ["lanyon place", "lanyon", "belfast central"],
    latitude: 54.5942,
    longitude: -5.9197,
  },
  {
    id: "grand-central",
    stationCode: "GRTCNL",
    label: "Grand Central",
    aliases: ["grand central", "great victoria street", "gvs"],
    latitude: 54.5958,
    longitude: -5.9344,
  },
  {
    id: "bangor",
    stationCode: "BANGOR",
    label: "Bangor",
    aliases: ["bangor"],
    latitude: 54.6646,
    longitude: -5.6686,
  },
];

const cacheByStation = new Map<RailStationId, RailStationLiveSnapshot>();
const cacheFetchedAtByStation = new Map<RailStationId, number>();
const DEFAULT_CACHE_MS = 2 * 60 * 1000;

export function getTrackedRailStations(): RailStationConfig[] {
  return [...TRANSLINK_STATIONS];
}

export function stationForTrackedPlace(place: TrackedPlace): RailStationConfig | null {
  if (place.type !== "station") {
    return null;
  }
  const label = place.label.toLowerCase();
  const match =
    TRANSLINK_STATIONS.find((station) => station.aliases.some((alias) => label.includes(alias))) ??
    nearestRailStation(place.latitude, place.longitude);
  return match ?? null;
}

export async function fetchTranslinkRailSnapshots(args: {
  now: Date;
  forceRefresh?: boolean;
  cacheMs?: number;
}): Promise<{ snapshots: RailStationLiveSnapshot[]; warnings: string[] }> {
  const warnings: string[] = [];
  const snapshots: RailStationLiveSnapshot[] = [];
  const cacheMs = args.cacheMs ?? DEFAULT_CACHE_MS;

  for (const station of TRANSLINK_STATIONS) {
    const cachedAt = cacheFetchedAtByStation.get(station.id) ?? 0;
    const cached = cacheByStation.get(station.id);
    const cacheFresh = Date.now() - cachedAt < cacheMs;
    if (!args.forceRefresh && cached && cacheFresh) {
      snapshots.push(cached);
      continue;
    }

    const fetched = await fetchStationSnapshot(station, args.now);
    if (!fetched) {
      warnings.push(`Live rail feed unavailable for ${station.label}.`);
      if (cached) {
        snapshots.push(cached);
      } else {
        const fallback = buildFallbackSnapshot(station, args.now);
        snapshots.push(fallback);
      }
      continue;
    }

    cacheByStation.set(station.id, fetched);
    cacheFetchedAtByStation.set(station.id, Date.now());
    snapshots.push(fetched);
  }

  return { snapshots, warnings };
}

export function classifyRailActivity(args: {
  stationId: RailStationId;
  now: Date;
  arrivalsNextHour: number;
  baselineSeed?: number;
}): {
  classification: RailActivityClassification;
  baseline: BaselineHourlyExpectation;
} {
  const baseline = baselineRailExpectation(args.stationId, args.now, args.baselineSeed);
  if (args.arrivalsNextHour >= baseline.expectedArrivalsNextHour + 4) {
    return { classification: "significantly_higher_than_average", baseline };
  }
  if (args.arrivalsNextHour > baseline.expectedArrivalsNextHour) {
    return { classification: "higher_than_average", baseline };
  }
  return { classification: "normal", baseline };
}

export function buildSeededRailSnapshotForDay(args: {
  station: RailStationConfig;
  at: Date;
}): RailStationLiveSnapshot {
  const base = baselineRailExpectation(args.station.id, args.at);
  const seed = seedFrom(`${args.station.id}-${args.at.toISOString().slice(0, 13)}`);
  const uplift = seed % 5 === 0 ? 4 : seed % 2 === 0 ? 2 : 0;
  const arrivalsNextHour = Math.max(0, base.expectedArrivalsNextHour + uplift);
  const replacementBusCount = seed % 17 === 0 ? 1 : 0;
  const delayedCount = seed % 7 === 0 ? 2 : 0;
  const disruptions: RailServiceDisruption[] = [];
  if (replacementBusCount > 0) {
    disruptions.push({
      serviceId: `${args.station.stationCode}-R1`,
      disruptionType: "replacement-bus",
      note: "Replacement bus service expected on this corridor",
    });
  }
  if (delayedCount > 0) {
    disruptions.push({
      serviceId: `${args.station.stationCode}-D1`,
      disruptionType: "delayed",
      delayMinutes: 12 + (seed % 20),
      note: "Delayed service reported",
    });
  }

  return {
    stationId: args.station.id,
    stationCode: args.station.stationCode,
    stationLabel: args.station.label,
    fetchedAt: args.at.toISOString(),
    arrivalsNextHour,
    delayedCount,
    cancelledCount: 0,
    replacementBusCount,
    disruptions,
    rawSource: "fallback",
  };
}

function baselineRailExpectation(stationId: RailStationId, now: Date, seedOverride?: number): BaselineHourlyExpectation {
  const seed = seedOverride ?? seedFrom(stationId);
  const weekday = now.getDay();
  const hour = now.getHours();
  const commuteBoost = hour >= 7 && hour <= 9 ? 2 : hour >= 16 && hour <= 18 ? 2 : 0;
  return {
    trackedPlaceId: `rail-${stationId}`,
    weekday,
    hour,
    expectedArrivalsNextHour: 2 + ((seed + weekday + hour) % 4) + commuteBoost,
  };
}

async function fetchStationSnapshot(station: RailStationConfig, now: Date): Promise<RailStationLiveSnapshot | null> {
  const urls = candidateUrlsForStation(station);
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json, text/xml;q=0.9,*/*;q=0.8" } });
      if (!response.ok) {
        continue;
      }
      const text = await response.text();
      const parsed = parseSnapshotResponse(station, text, now);
      if (parsed) {
        return parsed;
      }
    } catch {
      // Try next candidate endpoint
    }
  }
  return null;
}

function candidateUrlsForStation(station: RailStationConfig): string[] {
  const envBase = process.env.EXPO_PUBLIC_TRANSLINK_RAIL_BASE_URL?.trim();
  const explicitTemplate = process.env.EXPO_PUBLIC_TRANSLINK_RAIL_STATION_URL_TEMPLATE?.trim();
  const urls = new Set<string>();

  if (explicitTemplate) {
    urls.add(explicitTemplate.replace("{stationCode}", station.stationCode));
  }
  if (envBase) {
    const base = envBase.replace(/\/+$/, "");
    urls.add(`${base}/${station.stationCode}`);
    urls.add(`${base}/${station.stationCode}.json`);
    urls.add(`${base}/${station.stationCode}?format=json`);
  }

  urls.add(`https://tiger.worldline.global/toc/NIR/${station.stationCode}`);
  urls.add(`https://tiger.worldline.global/toc/NIR/${station.stationCode}.json`);
  urls.add(`https://tiger.worldline.global/toc/NIR/${station.stationCode}?format=json`);

  return [...urls];
}

function parseSnapshotResponse(
  station: RailStationConfig,
  responseText: string,
  now: Date,
): RailStationLiveSnapshot | null {
  const trimmed = responseText.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const json = safeJsonParse(trimmed);
    if (!json) {
      return null;
    }
    return parseJsonSnapshot(station, json, now);
  }

  if (trimmed.startsWith("<")) {
    return parseXmlSnapshot(station, trimmed, now);
  }

  return null;
}

function parseJsonSnapshot(station: RailStationConfig, payload: unknown, now: Date): RailStationLiveSnapshot | null {
  const serviceRows = collectServiceRows(payload);
  if (serviceRows.length === 0) {
    return null;
  }

  return summarizeServiceRows(station, serviceRows, "translink-opendata", now);
}

function parseXmlSnapshot(station: RailStationConfig, xml: string, now: Date): RailStationLiveSnapshot | null {
  const rows = [...xml.matchAll(/<service[\s\S]*?<\/service>/gi)].map((match) => match[0]);
  if (rows.length === 0) {
    const itemRows = [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)].map((match) => match[0]);
    if (itemRows.length === 0) {
      return null;
    }
    const mapped = itemRows.map((item) => ({
      status: xmlValue(item, ["status", "delayreason", "platformstatus"]),
      eta: xmlValue(item, ["eta", "expectedtime", "expectedarrival", "arrivaltime"]),
      std: xmlValue(item, ["std", "scheduledtime", "aimedarrival"]),
      serviceId: xmlValue(item, ["serviceid", "trainid", "id"]),
      notes: xmlValue(item, ["note", "message", "remark"]),
    }));
    return summarizeServiceRows(station, mapped, "tiger", now);
  }

  const mapped = rows.map((service) => ({
    status: xmlValue(service, ["status", "delayreason", "platformstatus"]),
    eta: xmlValue(service, ["eta", "expectedtime", "expectedarrival", "arrivaltime"]),
    std: xmlValue(service, ["std", "scheduledtime", "aimedarrival"]),
    serviceId: xmlValue(service, ["serviceid", "trainid", "id"]),
    notes: xmlValue(service, ["note", "message", "remark"]),
  }));
  return summarizeServiceRows(station, mapped, "tiger", now);
}

function summarizeServiceRows(
  station: RailStationConfig,
  rows: Array<{ status?: string | null; eta?: string | null; std?: string | null; serviceId?: string | null; notes?: string | null }>,
  source: "translink-opendata" | "tiger",
  now: Date,
): RailStationLiveSnapshot {
  const oneHourMs = 60 * 60 * 1000;
  const nowMs = now.getTime();
  let arrivalsNextHour = 0;
  let delayedCount = 0;
  let cancelledCount = 0;
  let replacementBusCount = 0;
  const disruptions: RailServiceDisruption[] = [];

  for (const row of rows) {
    const statusText = `${row.status ?? ""} ${row.notes ?? ""}`.toLowerCase();
    const etaMs = parseTimeNearNowMs(row.eta ?? row.std ?? null, now);
    const inNextHour = etaMs !== null && etaMs >= nowMs && etaMs <= nowMs + oneHourMs;
    if (inNextHour) {
      arrivalsNextHour += 1;
    }

    const isCancelled = /cancel/.test(statusText);
    const isReplacementBus = /replacement bus|bus service/.test(statusText);
    const delayMinutes = parseDelayMinutes(statusText);
    const isDelayed = delayMinutes > 0 || /delayed|late/.test(statusText);

    if (isCancelled) {
      cancelledCount += 1;
      disruptions.push({
        serviceId: row.serviceId ?? `${station.stationCode}-C${cancelledCount}`,
        disruptionType: "cancelled",
        note: row.status ?? row.notes ?? "Cancelled service",
      });
    }
    if (isReplacementBus) {
      replacementBusCount += 1;
      disruptions.push({
        serviceId: row.serviceId ?? `${station.stationCode}-R${replacementBusCount}`,
        disruptionType: "replacement-bus",
        note: row.status ?? row.notes ?? "Replacement bus service",
      });
    }
    if (isDelayed) {
      delayedCount += 1;
      disruptions.push({
        serviceId: row.serviceId ?? `${station.stationCode}-D${delayedCount}`,
        disruptionType: "delayed",
        delayMinutes: delayMinutes > 0 ? delayMinutes : undefined,
        note: row.status ?? row.notes ?? "Delayed service",
      });
    }
  }

  return {
    stationId: station.id,
    stationCode: station.stationCode,
    stationLabel: station.label,
    fetchedAt: now.toISOString(),
    arrivalsNextHour,
    delayedCount,
    cancelledCount,
    replacementBusCount,
    disruptions,
    rawSource: source,
  };
}

function collectServiceRows(payload: unknown): Array<{ status?: string | null; eta?: string | null; std?: string | null; serviceId?: string | null; notes?: string | null }> {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const queue: unknown[] = [payload];
  const rows: Array<{ status?: string | null; eta?: string | null; std?: string | null; serviceId?: string | null; notes?: string | null }> = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") {
      continue;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }

    const map = current as Record<string, unknown>;
    const status = firstString(map, ["status", "delayReason", "reason", "state"]);
    const eta = firstString(map, ["eta", "expectedTime", "expectedArrival", "arrivalTime", "arrival"]);
    const std = firstString(map, ["std", "scheduledTime", "aimedArrival"]);
    const serviceId = firstString(map, ["serviceId", "trainId", "id", "runId"]);
    const notes = firstString(map, ["note", "message", "remark"]);
    if (status || eta || std || serviceId || notes) {
      rows.push({ status, eta, std, serviceId, notes });
    }

    for (const value of Object.values(map)) {
      if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  return rows;
}

function buildFallbackSnapshot(station: RailStationConfig, now: Date): RailStationLiveSnapshot {
  return buildSeededRailSnapshotForDay({ station, at: now });
}

function nearestRailStation(latitude: number, longitude: number): RailStationConfig | null {
  let best: { station: RailStationConfig; distance: number } | null = null;
  for (const station of TRANSLINK_STATIONS) {
    const distance = haversineMiles(latitude, longitude, station.latitude, station.longitude);
    if (!best || distance < best.distance) {
      best = { station, distance };
    }
  }
  return best?.distance !== undefined && best.distance <= 2.5 ? best.station : null;
}

function safeJsonParse(input: string): unknown | null {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function xmlValue(xml: string, keys: string[]): string | null {
  for (const key of keys) {
    const match = xml.match(new RegExp(`<${key}[^>]*>([\\s\\S]*?)</${key}>`, "i"));
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function parseDelayMinutes(text: string): number {
  const match = text.match(/(\d+)\s*(min|minute)/i);
  return match ? Number(match[1]) : 0;
}

function parseTimeNearNowMs(timeText: string | null, now: Date): number | null {
  if (!timeText) {
    return null;
  }
  const normalized = timeText.trim();
  const isoMillis = Date.parse(normalized);
  if (!Number.isNaN(isoMillis)) {
    return isoMillis;
  }
  const hmMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!hmMatch) {
    return null;
  }
  const hours = Number(hmMatch[1]);
  const minutes = Number(hmMatch[2]);
  const candidate = new Date(now);
  candidate.setHours(hours, minutes, 0, 0);
  const delta = candidate.getTime() - now.getTime();
  if (delta < -12 * 60 * 60 * 1000) {
    candidate.setDate(candidate.getDate() + 1);
  } else if (delta > 12 * 60 * 60 * 1000) {
    candidate.setDate(candidate.getDate() - 1);
  }
  return candidate.getTime();
}

function seedFrom(value: string): number {
  let seed = 0;
  for (let i = 0; i < value.length; i += 1) {
    seed += value.charCodeAt(i);
  }
  return seed;
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRadians = (v: number) => (v * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
}
