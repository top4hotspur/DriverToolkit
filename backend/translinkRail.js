const fs = require("fs");
const path = require("path");

const TRANSLINK_BASE_URL =
  process.env.TRANSLINK_API_BASE_URL ?? "https://api.translink.example";
const TRANSLINK_API_TOKEN = process.env.TRANSLINK_API_TOKEN ?? "";
const TRANSLINK_STOP_FINDER_URL =
  process.env.TRANSLINK_STOP_FINDER_URL ?? `${TRANSLINK_BASE_URL}/StopFinder`;
const TRANSLINK_DEPARTURE_MONITOR_URL =
  process.env.TRANSLINK_DEPARTURE_MONITOR_URL ?? `${TRANSLINK_BASE_URL}/DepartureMonitor`;
const TRANSLINK_ADD_INFO_URL =
  process.env.TRANSLINK_ADD_INFO_URL ?? `${TRANSLINK_BASE_URL}/AddInfo`;
const TRANSLINK_RAPID_JSON = process.env.TRANSLINK_RAPID_JSON ?? "1";

const TRACKED_HUBS = {
  belfast_central: {
    hubKey: "belfast_central",
    name: "Lanyon Place",
    stopFinderQuery: "Lanyon Place",
    fallbackStopId: "TRANSLINK_BELFAST_CENTRAL",
    sourceRefs: [
      {
        sourceKey: "rail_primary",
        mode: "train",
        stopFinderQuery: "Lanyon Place",
        fallbackStopId: "TRANSLINK_BELFAST_CENTRAL",
      },
    ],
    latitude: 54.5966,
    longitude: -5.9187,
  },
  great_victoria_street: {
    hubKey: "great_victoria_street",
    name: "Grand Central",
    stopFinderQuery: "Grand Central",
    fallbackStopId: "TRANSLINK_GVS",
    sourceRefs: [
      {
        sourceKey: "rail_primary",
        mode: "train",
        stopFinderQuery: "Grand Central",
        fallbackStopId: "TRANSLINK_GVS_RAIL",
      },
      {
        sourceKey: "bus_primary",
        mode: "bus",
        stopFinderQuery: "Grand Central Bus",
        fallbackStopId: "TRANSLINK_GVS_BUS",
      },
    ],
    latitude: 54.5922,
    longitude: -5.9342,
  },
  bangor: {
    hubKey: "bangor",
    name: "Bangor",
    stopFinderQuery: "Bangor",
    fallbackStopId: "TRANSLINK_BANGOR",
    sourceRefs: [
      {
        sourceKey: "rail_primary",
        mode: "train",
        stopFinderQuery: "Bangor",
        fallbackStopId: "TRANSLINK_BANGOR",
      },
    ],
    latitude: 54.6648,
    longitude: -5.6691,
  },
};

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function safeWriteJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeHubKey(hubKey) {
  return String(hubKey ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_");
}

function makeBaselineKey(date = new Date()) {
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()] ?? "Sun";
  const hour = String(date.getHours()).padStart(2, "0");
  return `${day}-${hour}`;
}

function parseServiceTimeToDate(value, now = new Date()) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const iso = Date.parse(raw);
  if (!Number.isNaN(iso)) {
    return new Date(iso);
  }
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    const date = new Date(now);
    date.setSeconds(0, 0);
    date.setHours(Number(match[1]), Number(match[2]), 0, 0);
    return date;
  }
  return null;
}

function isCancellationLike(raw) {
  const text = String(raw ?? "").toLowerCase();
  return (
    text.includes("cancel") ||
    text.includes("replacement bus") ||
    text.includes("bus service in operation")
  );
}

function isDisruptionLike(raw) {
  const text = String(raw ?? "").toLowerCase();
  return (
    text.includes("cancel") ||
    text.includes("disrupt") ||
    text.includes("replacement bus") ||
    text.includes("bus service in operation") ||
    text.includes("delay") ||
    text.includes("late") ||
    text.includes("suspend") ||
    text.includes("diversion") ||
    text.includes("engineering")
  );
}

function classifyDisruptionText(raw) {
  const text = String(raw ?? "").toLowerCase();
  if (!text) return null;
  if (text.includes("cancel")) return "cancelled";
  if (text.includes("replacement bus") || text.includes("bus service in operation")) {
    return "replacement_bus";
  }
  if (text.includes("delay") || text.includes("late")) return "delayed";
  if (text.includes("disrupt") || text.includes("suspend") || text.includes("diversion")) {
    return "disrupted";
  }
  return "disrupted";
}

function flattenObjects(root) {
  const out = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }
    if (typeof current === "object") {
      out.push(current);
      for (const value of Object.values(current)) {
        if (value && (Array.isArray(value) || typeof value === "object")) {
          queue.push(value);
        }
      }
    }
  }
  return out;
}

function topLevelKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value).slice(0, 25);
}

function normalizeServiceObject(object, hubName, now = new Date()) {
  const rawTime =
    object.timeIso ??
    object.timeLabel ??
    object.time ??
    object.rtTime ??
    object.schedTime ??
    object.plannedTime ??
    object.departureTime ??
    object.arrivalTime ??
    object.dateTime ??
    object.datetime ??
    null;
  const time = parseServiceTimeToDate(rawTime, now);
  if (!time) return null;

  const destination =
    object.destination ??
    object.direction ??
    object.towards ??
    object.dest ??
    object.to ??
    null;
  const origin = object.origin ?? object.from ?? object.start ?? hubName ?? null;
  const disruptionText =
    object.addInfo ??
    object.info ??
    object.text ??
    object.message ??
    object.statusText ??
    null;
  const statusRaw = object.status ?? object.rtStatus ?? disruptionText ?? null;
  const cancelled =
    Boolean(object.cancelled === true || object.isCancelled === true) ||
    isCancellationLike(statusRaw);
  const disruptionTypeFromText = classifyDisruptionText(disruptionText ?? statusRaw);
  const delayed =
    Boolean(
      object.delayed === true ||
      object.isDelayed === true ||
      object.delay != null ||
      object.delayMinutes != null,
    ) ||
    disruptionTypeFromText === "delayed";
  const modeRaw =
    object.mode ??
    object.transportMode ??
    object.vehicleMode ??
    object.product ??
    object.lineType ??
    null;
  const modeText = String(modeRaw ?? disruptionText ?? "").toLowerCase();
  const mode =
    modeText.includes("bus") || modeText.includes("coach") || modeText.includes("replacement bus")
      ? "bus"
      : "train";

  return {
    timeIso: time.toISOString(),
    timeLabel: `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`,
    origin: origin ? String(origin) : hubName,
    destination: destination ? String(destination) : null,
    mode,
    cancelled,
    delayed,
    disruptionText: disruptionText ? String(disruptionText) : cancelled ? "Cancellation/disruption detected" : null,
    disruptionType: cancelled ? "cancelled" : disruptionTypeFromText,
    raw: object,
  };
}

function normalizeServicesFromPayload(payload, hubName) {
  const now = new Date();
  const parsed = flattenObjects(payload)
    .map((obj) => normalizeServiceObject(obj, hubName, now))
    .filter((item) => Boolean(item));
  const upcoming = parsed
    .filter((item) => {
      const serviceTime = Date.parse(item.timeIso);
      if (Number.isNaN(serviceTime)) return false;
      const diffMs = serviceTime - now.getTime();
      return diffMs >= -5 * 60 * 1000 && diffMs <= 60 * 60 * 1000;
    })
    .sort((a, b) => Date.parse(a.timeIso) - Date.parse(b.timeIso));
  return {
    events: upcoming,
    rawServiceCandidateCount: parsed.length,
  };
}

function fallbackServicesForHub(hubName, mode = "train", sourceKey = "fallback") {
  const now = new Date();
  const offsets = [8, 22, 41, 54];
  return offsets.map((minutes, index) => {
    const when = new Date(now.getTime() + minutes * 60 * 1000);
    return {
      timeIso: when.toISOString(),
      timeLabel: `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`,
      origin: hubName,
      destination: index % 2 === 0 ? "Belfast direction" : "Bangor direction",
      mode,
      cancelled: false,
      disruptionText: null,
      raw: { fallback: true, sourceKey, mode },
    };
  });
}

async function translinkRequest(url, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null) query.set(key, String(value));
  }
  if (!query.has("rapidJSON")) query.set("rapidJSON", TRANSLINK_RAPID_JSON);
  const fullUrl = `${url}?${query.toString()}`;
  const headers = {
    Accept: "application/json",
  };
  if (TRANSLINK_API_TOKEN) {
    headers["X-API-TOKEN"] = TRANSLINK_API_TOKEN;
  }
  const controller = new AbortController();
  const timeoutMs = Number(process.env.TRANSLINK_REQUEST_TIMEOUT_MS ?? 1500);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(fullUrl, { method: "GET", headers, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) {
    throw new Error(`Translink request failed (${response.status})`);
  }
  return response.json();
}

function resolveStopIdFromStopFinderPayload(payload, queryText) {
  const query = String(queryText ?? "").toLowerCase();
  const objects = flattenObjects(payload);
  for (const obj of objects) {
    const text = String(obj.name ?? obj.desc ?? obj.anyType ?? "").toLowerCase();
    if (!text.includes(query.split(" ")[0])) continue;
    const id =
      obj.id ??
      obj.stopID ??
      obj.stopId ??
      obj.extId ??
      obj.locality ??
      obj.localityId ??
      obj.ref ??
      null;
    if (id) {
      return String(id);
    }
  }
  return null;
}

function parseDisruptionAlerts(payload, hubName) {
  const now = new Date();
  const alerts = [];
  for (const obj of flattenObjects(payload)) {
    const text = String(
      obj.text ?? obj.message ?? obj.info ?? obj.addInfo ?? obj.status ?? obj.rtStatus ?? "",
    ).trim();
    if (!text || !isDisruptionLike(text)) continue;
    const when = parseServiceTimeToDate(
      obj.time ?? obj.rtTime ?? obj.departureTime ?? obj.arrivalTime ?? null,
      now,
    );
    if (!when) continue;
    const diff = when.getTime() - now.getTime();
    if (diff < -5 * 60 * 1000 || diff > 60 * 60 * 1000) continue;
    alerts.push({
      hubName,
      timeIso: when.toISOString(),
      timeLabel: `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`,
      destination: obj.destination ?? obj.direction ?? null,
      disruptionText: text,
      disruptionType: classifyDisruptionText(text),
    });
  }
  return alerts;
}

function createTranslinkRailService(options) {
  const { uploadsDir } = options;
  const artifactDir = path.join(uploadsDir, "translink");
  ensureDir(artifactDir);
  const hubsFile = path.join(artifactDir, "tracked-hubs.json");
  const baselineFile = path.join(artifactDir, "arrival-baseline.json");

  const hubsCache = safeReadJson(hubsFile, {
    updatedAt: null,
    hubs: Object.values(TRACKED_HUBS).map((hub) => ({
      hubKey: hub.hubKey,
      name: hub.name,
      sourceRefs: (hub.sourceRefs ?? []).map((sourceRef) => ({
        sourceKey: sourceRef.sourceKey,
        mode: sourceRef.mode,
        stopId: sourceRef.fallbackStopId,
        query: sourceRef.stopFinderQuery,
        source: "fallback",
      })),
    })),
  });

  function saveHubsCache() {
    hubsCache.updatedAt = nowIso();
    safeWriteJson(hubsFile, hubsCache);
  }

  const baselineCache = safeReadJson(baselineFile, {
    updatedAt: null,
    values: {},
  });

  function saveBaselineCache() {
    baselineCache.updatedAt = nowIso();
    safeWriteJson(baselineFile, baselineCache);
  }

  function getHubByKey(hubKey) {
    const key = normalizeHubKey(hubKey);
    return TRACKED_HUBS[key] ?? null;
  }

  function findCachedHubEntry(hubKey) {
    return hubsCache.hubs.find((item) => item.hubKey === hubKey) ?? null;
  }

  function ensureCachedHubEntry(hub) {
    let entry = findCachedHubEntry(hub.hubKey);
    if (entry) {
      return entry;
    }
    entry = {
      hubKey: hub.hubKey,
      name: hub.name,
      sourceRefs: (hub.sourceRefs ?? []).map((sourceRef) => ({
        sourceKey: sourceRef.sourceKey,
        mode: sourceRef.mode,
        stopId: sourceRef.fallbackStopId,
        query: sourceRef.stopFinderQuery,
        source: "fallback",
      })),
    };
    hubsCache.hubs.push(entry);
    return entry;
  }

  async function ensureHubSourceStopId(hubKey, sourceRef) {
    const hub = getHubByKey(hubKey);
    if (!hub) return null;
    const cachedHub = ensureCachedHubEntry(hub);
    const cachedSource = (cachedHub.sourceRefs ?? []).find(
      (value) => value.sourceKey === sourceRef.sourceKey,
    );
    if (cachedSource?.stopId && cachedSource.source === "resolved") {
      return cachedSource.stopId;
    }
    try {
      if (!TRANSLINK_API_TOKEN) {
        return cachedSource?.stopId ?? sourceRef.fallbackStopId;
      }
      const payload = await translinkRequest(TRANSLINK_STOP_FINDER_URL, {
        query: sourceRef.stopFinderQuery,
      });
      const resolved = resolveStopIdFromStopFinderPayload(payload, sourceRef.stopFinderQuery);
      const stopId = resolved ?? cachedSource?.stopId ?? sourceRef.fallbackStopId;
      const nextSource = {
        sourceKey: sourceRef.sourceKey,
        mode: sourceRef.mode,
        stopId,
        query: sourceRef.stopFinderQuery,
        source: resolved ? "resolved" : "fallback",
      };
      const sourceIndex = (cachedHub.sourceRefs ?? []).findIndex(
        (value) => value.sourceKey === sourceRef.sourceKey,
      );
      if (sourceIndex >= 0) {
        cachedHub.sourceRefs[sourceIndex] = nextSource;
      } else {
        cachedHub.sourceRefs = [...(cachedHub.sourceRefs ?? []), nextSource];
      }
      saveHubsCache();
      return stopId;
    } catch {
      return cachedSource?.stopId ?? sourceRef.fallbackStopId;
    }
  }

  async function ensureHubSourceIds(hub) {
    const refs = Array.isArray(hub.sourceRefs) && hub.sourceRefs.length > 0
      ? hub.sourceRefs
      : [
          {
            sourceKey: "rail_primary",
            mode: "train",
            stopFinderQuery: hub.stopFinderQuery,
            fallbackStopId: hub.fallbackStopId,
          },
        ];
    const resolved = [];
    for (const sourceRef of refs) {
      const stopId = await ensureHubSourceStopId(hub.hubKey, sourceRef);
      resolved.push({
        sourceKey: sourceRef.sourceKey,
        mode: sourceRef.mode,
        stopFinderQuery: sourceRef.stopFinderQuery,
        stopId,
      });
    }
    return resolved;
  }

  function getBaseline(hubKey, weekdayHourKey = makeBaselineKey()) {
    const hubValues = baselineCache.values?.[hubKey] ?? {};
    const value = hubValues[weekdayHourKey];
    return Number.isFinite(Number(value?.meanArrivals)) ? Number(value.meanArrivals) : 3;
  }

  function updateRollingBaseline(hubKey, arrivalsCount, weekdayHourKey = makeBaselineKey()) {
    if (!baselineCache.values[hubKey]) baselineCache.values[hubKey] = {};
    const existing = baselineCache.values[hubKey][weekdayHourKey] ?? {
      samples: 0,
      meanArrivals: 3,
      updatedAt: null,
    };
    const alpha = 0.25;
    const nextMean =
      existing.samples > 0
        ? existing.meanArrivals * (1 - alpha) + arrivalsCount * alpha
        : arrivalsCount;
    baselineCache.values[hubKey][weekdayHourKey] = {
      samples: Number(existing.samples ?? 0) + 1,
      meanArrivals: Number(nextMean.toFixed(2)),
      updatedAt: nowIso(),
    };
    saveBaselineCache();
    return baselineCache.values[hubKey][weekdayHourKey];
  }

  async function getNextEvents(hubKey) {
    const hub = getHubByKey(hubKey);
    if (!hub) return null;
    const sourceRefs = await ensureHubSourceIds(hub);
    const sourceDetails = [];
    const aggregatedEvents = [];
    const aggregatedDisruptions = [];
    for (const sourceRef of sourceRefs) {
      const stopId = sourceRef.stopId;
      let departurePayload = null;
      let addInfoPayload = null;
      let source = "translink";
      try {
        if (!TRANSLINK_API_TOKEN) throw new Error("missing_token");
        departurePayload = await translinkRequest(TRANSLINK_DEPARTURE_MONITOR_URL, {
          stopId,
        });
        addInfoPayload = await translinkRequest(TRANSLINK_ADD_INFO_URL, {
          stopId,
        });
      } catch {
        source = "fallback";
        departurePayload = { events: fallbackServicesForHub(hub.name, sourceRef.mode, sourceRef.sourceKey) };
        addInfoPayload = { alerts: [] };
      }
      const normalizedFromDeparture = normalizeServicesFromPayload(departurePayload, hub.name);
      const nextEvents = normalizedFromDeparture.events.map((event) => ({
        ...event,
        mode: event.mode ?? sourceRef.mode ?? "train",
        sourceKey: sourceRef.sourceKey,
        stopId,
        isFallback: event.raw?.fallback === true || event.raw?.raw?.fallback === true,
      }));
      const disruptionsFromAddInfo = parseDisruptionAlerts(addInfoPayload, hub.name).map((alert) => ({
        ...alert,
        sourceKey: sourceRef.sourceKey,
        stopId,
      }));
      const disruptionsFromRows = nextEvents
        .filter((event) => event.cancelled || event.delayed || String(event.disruptionText ?? "").trim().length > 0)
        .map((event) => ({
          hubName: hub.name,
          timeIso: event.timeIso,
          timeLabel: event.timeLabel,
          destination: event.destination ?? null,
          disruptionText: event.disruptionText ?? (event.cancelled ? "Cancellation" : event.delayed ? "Delay" : "Disruption"),
          disruptionType:
            event.disruptionType ??
            (event.cancelled ? "cancelled" : event.delayed ? "delayed" : "disrupted"),
          sourceKey: sourceRef.sourceKey,
          stopId,
        }));
      const disruptions = dedupeDisruptionAlerts([
        ...disruptionsFromAddInfo,
        ...disruptionsFromRows,
      ]);
      aggregatedEvents.push(...nextEvents);
      aggregatedDisruptions.push(...disruptions);
      const byMode = countByMode(nextEvents);
      sourceDetails.push({
        sourceKey: sourceRef.sourceKey,
        mode: sourceRef.mode,
        stopFinderQuery: sourceRef.stopFinderQuery,
        stopId,
        source,
        eventCount: nextEvents.length,
        rawServiceCandidateCount: normalizedFromDeparture.rawServiceCandidateCount,
        railRawCount: sourceRef.mode === "train" ? normalizedFromDeparture.rawServiceCandidateCount : 0,
        busRawCount: sourceRef.mode === "bus" ? normalizedFromDeparture.rawServiceCandidateCount : 0,
        railNormalizedCount: byMode.train,
        busNormalizedCount: byMode.bus,
        disruptionAlertCount: disruptions.length,
        disruptionTypes: Array.from(
          new Set(disruptions.map((item) => String(item.disruptionType ?? "")).filter(Boolean)),
        ),
        departureTopLevelKeys: topLevelKeys(departurePayload),
        addInfoTopLevelKeys: topLevelKeys(addInfoPayload),
        departureObjectCount: flattenObjects(departurePayload).length,
        addInfoObjectCount: flattenObjects(addInfoPayload).length,
      });
      console.log(
        `[TRANSPORT][raw] hub=${hub.hubKey} sourceKey=${sourceRef.sourceKey} mode=${sourceRef.mode} source=${source} railRawCount=${sourceRef.mode === "train" ? normalizedFromDeparture.rawServiceCandidateCount : 0} busRawCount=${sourceRef.mode === "bus" ? normalizedFromDeparture.rawServiceCandidateCount : 0} departureObjectCount=${flattenObjects(departurePayload).length} addInfoObjectCount=${flattenObjects(addInfoPayload).length}`,
      );
      console.log(
        `[TRANSPORT][normalize] hub=${hub.hubKey} sourceKey=${sourceRef.sourceKey} railNormalizedCount=${byMode.train} busNormalizedCount=${byMode.bus} disruptionCount=${disruptions.length} disruptionTypes=${Array.from(
          new Set(disruptions.map((item) => String(item.disruptionType ?? "")).filter(Boolean)),
        ).join("|") || "none"}`,
      );
    }
    const hasLiveTranslinkSource = sourceDetails.some((entry) => entry.source === "translink");
    let availability = "departure_monitor_as_closest_arrivals_equivalent";
    let events = aggregatedEvents;
    if (events.length === 0) {
      if (hasLiveTranslinkSource) {
        availability = "no_row_level_events_from_translink";
        events = [];
      } else {
        availability = "fallback_rows_only";
        events = sourceRefs.flatMap((sourceRef) =>
          fallbackServicesForHub(
            hub.name,
            sourceRef.mode ?? "train",
            sourceRef.sourceKey ?? "fallback",
          ).map((event) => ({
            ...event,
            sourceKey: sourceRef.sourceKey,
            stopId: sourceRef.stopId,
            isFallback: true,
          })),
        );
      }
    }
    if (events.length > 0 && !hasLiveTranslinkSource) {
      availability = "fallback_rows_only";
    }
    events = events.sort((a, b) => Date.parse(a.timeIso) - Date.parse(b.timeIso));
    const disruptions = aggregatedDisruptions;
    const rawCountsByMode = sourceDetails.reduce(
      (acc, entry) => {
        acc.railRawCount += Number(entry.railRawCount ?? 0);
        acc.busRawCount += Number(entry.busRawCount ?? 0);
        return acc;
      },
      { railRawCount: 0, busRawCount: 0 },
    );
    const normalizedCountsByMode = sourceDetails.reduce(
      (acc, entry) => {
        acc.railNormalizedCount += Number(entry.railNormalizedCount ?? 0);
        acc.busNormalizedCount += Number(entry.busNormalizedCount ?? 0);
        return acc;
      },
      { railNormalizedCount: 0, busNormalizedCount: 0 },
    );
    const source =
      sourceDetails.some((entry) => entry.source === "translink") ? "translink" : "fallback";
    const modeCounts = events.reduce(
      (acc, event) => {
        if (event.mode === "bus") {
          acc.bus += 1;
        } else {
          acc.train += 1;
        }
        return acc;
      },
      { train: 0, bus: 0 },
    );
    const surfacedCountsByMode = countByMode(events);
    const disruptionTypes = Array.from(
      new Set(disruptions.map((item) => String(item.disruptionType ?? "").trim()).filter(Boolean)),
    );
    const affectedModes = Array.from(
      new Set(
        events
          .filter((event) => event.cancelled || event.delayed || String(event.disruptionText ?? "").trim().length > 0)
          .map((event) => String(event.mode ?? "train")),
      ),
    );
    const hasLiveRows = events.some((event) => event.isFallback !== true);
    const hasFallbackRows = events.some((event) => event.isFallback === true);
    console.log(
      `[TRANSPORT][detail] hub=${hub.hubKey} surfacedRailCount=${surfacedCountsByMode.train} surfacedBusCount=${surfacedCountsByMode.bus} hasLiveRows=${String(
        hasLiveRows,
      )} hasFallbackRows=${String(hasFallbackRows)} arrivalsAvailability=${availability}`,
    );
    console.log(
      `[TRANSPORT][disruption] hub=${hub.hubKey} disruptionCount=${disruptions.length} disruptionTypes=${disruptionTypes.join("|") || "none"} affectedModes=${affectedModes.join("|") || "none"}`,
    );
    const nowKey = makeBaselineKey(new Date());
    const baselineValue = getBaseline(hub.hubKey, nowKey);
    const arrivalsCount = events.length;
    const baselineUpdated = updateRollingBaseline(hub.hubKey, arrivalsCount, nowKey);
    const veryBusyThreshold = Math.max(2, baselineValue * 1.6);
    const busyThreshold = Math.max(1, baselineValue * 1.1);
    const status =
      arrivalsCount >= veryBusyThreshold ? "very_busy" : arrivalsCount > busyThreshold ? "busy" : "normal";
    return {
      hubKey: hub.hubKey,
      hubName: hub.name,
      stopId: sourceRefs[0]?.stopId ?? null,
      sourceRefs: sourceDetails,
      source,
      modeCounts,
      nextHourExpectedArrivalsCount: arrivalsCount,
      baselineCount: baselineUpdated.meanArrivals,
      status,
      cancellationsCount: disruptions.length,
      alertItems: disruptions,
      nextThree: events.slice(0, 3).map((event) => ({
        time: event.timeLabel,
        mode: event.mode ?? "train",
        origin: event.origin,
        destination: event.destination,
        timeIso: event.timeIso,
        cancelled: Boolean(event.cancelled),
      })),
      nextEvents: events,
      availability,
      diagnostics: {
        railRawCount: rawCountsByMode.railRawCount,
        busRawCount: rawCountsByMode.busRawCount,
        railNormalizedCount: normalizedCountsByMode.railNormalizedCount,
        busNormalizedCount: normalizedCountsByMode.busNormalizedCount,
        surfacedRailCount: surfacedCountsByMode.train,
        surfacedBusCount: surfacedCountsByMode.bus,
        hasLiveRows,
        hasFallbackRows,
        disruptionCount: disruptions.length,
        disruptionTypes,
        affectedModes,
        arrivalsAvailability: availability,
      },
    };
  }

  function isNearbyHub(hub, latitude, longitude) {
    const lat = toNumber(latitude);
    const lng = toNumber(longitude);
    if (lat == null || lng == null) return false;
    const hubLat = toNumber(hub.latitude);
    const hubLng = toNumber(hub.longitude);
    if (hubLat == null || hubLng == null) return false;
    const kmPerDegree = 111;
    const dLat = (lat - hubLat) * kmPerDegree;
    const dLng = (lng - hubLng) * kmPerDegree * Math.cos((hubLat * Math.PI) / 180);
    const distanceKm = Math.sqrt(dLat * dLat + dLng * dLng);
    return distanceKm <= 5;
  }

  async function getSmartDiarySignal(hubKey, options = {}) {
    const hub = getHubByKey(hubKey);
    if (!hub) return null;
    const events = await getNextEvents(hub.hubKey);
    if (!events) return null;
    return {
      currentHub: {
        hubKey: hub.hubKey,
        hubName: hub.name,
        stopId: events.stopId,
        sourceRefs: events.sourceRefs ?? [],
      },
      nextHourExpectedArrivalsCount: events.nextHourExpectedArrivalsCount,
      baselineCount: events.baselineCount,
      status: events.status,
      modeCounts: events.modeCounts ?? { train: 0, bus: 0 },
      cancellationsCountInNextHour: events.cancellationsCount,
      alertItems: events.alertItems,
      nextThree: events.nextThree,
      nextEvents: events.nextEvents,
      proximityTile: {
        hubName: hub.name,
        isNearby: isNearbyHub(hub, options.latitude, options.longitude),
        nextThree: events.nextThree,
        cancellationsInNextHour: events.cancellationsCount,
        smartDiaryStatus: events.status,
      },
      notes: {
        arrivalsAvailability: events.availability,
        modeCounts: events.modeCounts ?? { train: 0, bus: 0 },
        sourceRefs: events.sourceRefs ?? [],
        diagnostics: events.diagnostics ?? null,
      },
    };
  }

  return {
    env: {
      TRANSLINK_API_TOKEN: Boolean(TRANSLINK_API_TOKEN),
      TRANSLINK_STOP_FINDER_URL,
      TRANSLINK_DEPARTURE_MONITOR_URL,
      TRANSLINK_ADD_INFO_URL,
      TRANSLINK_RAPID_JSON,
    },
    trackedHubs: Object.values(TRACKED_HUBS),
    getHubs: async () => {
      const hubs = [];
      for (const hub of Object.values(TRACKED_HUBS)) {
        const sourceRefs = await ensureHubSourceIds(hub);
        const stopId = sourceRefs[0]?.stopId ?? null;
        hubs.push({
          hubKey: hub.hubKey,
          name: hub.name,
          stopId,
          localityId: stopId,
          sourceRefs,
        });
      }
      return hubs;
    },
    getBaselineForHub: (hubKey) => {
      const hub = getHubByKey(hubKey);
      if (!hub) return null;
      const hubValues = baselineCache.values?.[hub.hubKey] ?? {};
      return {
        hubKey: hub.hubKey,
        hubName: hub.name,
        byWeekdayHour: hubValues,
      };
    },
    getNextEventsForHub: getNextEvents,
    getDisruptionsForHub: async (hubKey) => {
      const result = await getNextEvents(hubKey);
      if (!result) return null;
      return {
        hubKey: result.hubKey,
        hubName: result.hubName,
        cancellationsCountInNextHour: result.cancellationsCount,
        alerts: result.alertItems,
      };
    },
    getSmartDiarySignalForHub: getSmartDiarySignal,
  };
}

module.exports = {
  createTranslinkRailService,
};

function countByMode(events) {
  return (Array.isArray(events) ? events : []).reduce(
    (acc, event) => {
      const mode = String(event?.mode ?? "train").toLowerCase();
      if (mode === "bus") {
        acc.bus += 1;
      } else {
        acc.train += 1;
      }
      return acc;
    },
    { train: 0, bus: 0 },
  );
}

function dedupeDisruptionAlerts(alerts) {
  const map = new Map();
  for (const alert of Array.isArray(alerts) ? alerts : []) {
    const key = [
      String(alert?.sourceKey ?? ""),
      String(alert?.timeIso ?? ""),
      String(alert?.destination ?? ""),
      String(alert?.disruptionText ?? ""),
    ].join("|");
    if (!map.has(key)) {
      map.set(key, alert);
    }
  }
  return Array.from(map.values());
}
