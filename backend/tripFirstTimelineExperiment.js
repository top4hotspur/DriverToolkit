const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const {
  parseTimelineFileChunked,
  buildRawSignalIndex,
} = require("./timelineBackfill");

function toIso(value) {
  if (!value) return null;
  const parsed = Date.parse(String(value).trim());
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function toNum(value) {
  if (value == null) return null;
  const n = Number.parseFloat(String(value).trim());
  return Number.isNaN(n) ? null : n;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  values.push(current);
  return values;
}

function parseCsvText(csvText) {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map((h) => String(h).trim().replace(/^\uFEFF/, ""));
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j += 1) {
      row[headers[j]] = (values[j] ?? "").trim();
    }
    rows.push(row);
  }
  return { headers, rows };
}

function normalizeHeader(header) {
  return String(header ?? "")
    .trim()
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function findField(headers, aliases) {
  const map = new Map(headers.map((h) => [normalizeHeader(h), h]));
  for (const alias of aliases) {
    const hit = map.get(normalizeHeader(alias));
    if (hit) return hit;
  }
  return null;
}

function getMonthBucket(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function parseLatLngFromValue(value) {
  if (value == null) return { lat: null, lng: null };
  if (typeof value === "object") {
    const lat = toNum(value.latitude ?? value.lat);
    const lng = toNum(value.longitude ?? value.lng);
    if (lat != null && lng != null) return { lat, lng };
  }
  const raw = String(value).trim();
  if (!raw) return { lat: null, lng: null };
  const cleaned = raw.replace(/^geo:/i, "").replace(/°/g, "").replace(/Â°/g, "");
  const parts = cleaned.split(",").map((p) => p.trim());
  if (parts.length < 2) return { lat: null, lng: null };
  return { lat: toNum(parts[0]), lng: toNum(parts[1]) };
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  if (
    lat1 == null ||
    lng1 == null ||
    lat2 == null ||
    lng2 == null ||
    !Number.isFinite(lat1) ||
    !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lng2)
  ) {
    return null;
  }
  const toRad = (deg) => (deg * Math.PI) / 180;
  const Rm = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Rm * c;
}

function inferAreaLabelFromCoords(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat >= 54.64 && lat <= 54.67 && lng >= -6.24 && lng <= -6.19) return "BT29 area";
  if (lat >= 54.60 && lat <= 54.62 && lng >= -5.88 && lng <= -5.83) return "BFS Airport";
  if (lat >= 54.58 && lat <= 54.61 && lng >= -5.95 && lng <= -5.90) return "Belfast City Centre";
  if (lat >= 54.59 && lat <= 54.61 && lng >= -5.94 && lng <= -5.91) return "BT1 area";
  return "Local area";
}

function pickTripsEntry(entries) {
  const names = entries.map((e) => e.entryName);
  const direct = names.find((n) => n.toLowerCase().includes("driver_lifetime_trips"));
  if (!direct) return null;
  return entries.find((e) => e.entryName === direct) ?? null;
}

function buildTripRows(zipPath) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  const tripsEntry = pickTripsEntry(entries);
  if (!tripsEntry) {
    throw new Error("driver_lifetime_trips CSV not found in ZIP");
  }
  const csv = zip.readAsText(tripsEntry, "utf8");
  const parsed = parseCsvText(csv);
  const requestField = findField(parsed.headers, ["request_timestamp_local"]);
  const beginField = findField(parsed.headers, ["begintrip_timestamp_local"]);
  const dropoffField = findField(parsed.headers, ["dropoff_timestamp_local"]);
  const durationField = findField(parsed.headers, ["trip_duration_seconds"]);
  const distanceField = findField(parsed.headers, ["trip_distance_miles"]);
  const fareField = findField(parsed.headers, ["original_fare_local"]);
  const statusField = findField(parsed.headers, ["status"]);
  if (!requestField || !beginField || !dropoffField) {
    throw new Error("Required trip timestamp columns missing");
  }

  const trips = [];
  for (let i = 0; i < parsed.rows.length; i += 1) {
    const row = parsed.rows[i];
    const requestTs = toIso(row[requestField]);
    const beginTs = toIso(row[beginField]);
    const dropoffTs = toIso(row[dropoffField]);
    if (!requestTs || !beginTs || !dropoffTs) continue;
    trips.push({
      uniqueTripId: `trip-${String(i + 1).padStart(6, "0")}`,
      requestTimestampLocal: requestTs,
      beginTripTimestampLocal: beginTs,
      dropoffTimestampLocal: dropoffTs,
      tripDurationSeconds: toNum(durationField ? row[durationField] : null),
      tripDistanceMiles: toNum(distanceField ? row[distanceField] : null),
      originalFareLocal: toNum(fareField ? row[fareField] : null),
      status: statusField ? row[statusField] ?? null : null,
    });
  }
  return { trips, tripsEntry: tripsEntry.entryName };
}

async function extractTimelinePathPointPositions(filePath) {
  const raw = await fs.promises.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const semanticSegments = Array.isArray(parsed?.semanticSegments) ? parsed.semanticSegments : [];
  const points = [];
  for (const segment of semanticSegments) {
    const timelinePath = segment?.timelinePath;
    const entries = Array.isArray(timelinePath)
      ? timelinePath
      : Array.isArray(timelinePath?.points)
        ? timelinePath.points
        : Array.isArray(timelinePath?.point)
          ? timelinePath.point
          : [];
    for (const entry of entries) {
      const timeIso = toIso(entry?.time) ?? toIso(entry?.timestamp) ?? toIso(entry?.eventTime) ?? null;
      if (!timeIso) continue;
      const latLng = parseLatLngFromValue(
        entry?.point ?? entry?.latLng ?? entry?.LatLng ?? entry?.location ?? entry,
      );
      if (latLng.lat == null || latLng.lng == null) continue;
      const timestampMs = Date.parse(timeIso);
      if (Number.isNaN(timestampMs)) continue;
      points.push({
        timestampMs,
        timestampIso: timeIso,
        lat: latLng.lat,
        lng: latLng.lng,
        dateBucket: getMonthBucket(timeIso),
        source: "timelinePath",
      });
    }
  }
  return points;
}

function auditPoints(points) {
  const safe = Array.isArray(points) ? points : [];
  const monthCounts = new Map();
  let minMs = null;
  let maxMs = null;
  for (const point of safe) {
    if (!Number.isFinite(point.timestampMs)) continue;
    if (minMs == null || point.timestampMs < minMs) minMs = point.timestampMs;
    if (maxMs == null || point.timestampMs > maxMs) maxMs = point.timestampMs;
    const bucket = point.dateBucket ?? getMonthBucket(point.timestampIso);
    if (!bucket) continue;
    monthCounts.set(bucket, (monthCounts.get(bucket) ?? 0) + 1);
  }
  const sorted = [...safe].sort((a, b) => a.timestampMs - b.timestampMs);
  const sample = (point) => ({
    timestamp: point.timestampIso ?? null,
    lat: point.lat ?? null,
    lng: point.lng ?? null,
    monthBucket: point.dateBucket ?? getMonthBucket(point.timestampIso) ?? null,
    source: point.source ?? null,
  });
  return {
    minTimestamp: minMs == null ? null : new Date(minMs).toISOString(),
    maxTimestamp: maxMs == null ? null : new Date(maxMs).toISOString(),
    monthCounts: Object.fromEntries(
      Array.from(monthCounts.entries()).sort((a, b) => a[0].localeCompare(b[0])),
    ),
    distinctMonthBucketCount: monthCounts.size,
    pointCount: safe.length,
    earliestPoints: sorted.slice(0, 10).map(sample),
    latestPoints: sorted.slice(Math.max(0, sorted.length - 10)).map(sample),
  };
}

function makeTimelinePointIndex(rawByBucket, timelinePathPoints) {
  const byBucket = new Map();
  for (const [bucket, rawPoints] of rawByBucket.entries()) {
    const list = byBucket.get(bucket) ?? [];
    for (const p of rawPoints) {
      list.push({
        timestampMs: p.timestampMs,
        timestampIso: p.timestampIso,
        lat: p.lat,
        lng: p.lng,
        source: "rawSignal",
      });
    }
    byBucket.set(bucket, list);
  }

  for (const point of timelinePathPoints ?? []) {
    const bucket = point.dateBucket ?? getMonthBucket(point.timestampIso);
    if (!bucket) continue;
    const list = byBucket.get(bucket) ?? [];
    list.push({
      timestampMs: point.timestampMs,
      timestampIso: point.timestampIso,
      lat: point.lat,
      lng: point.lng,
      source: "timelinePath",
    });
    byBucket.set(bucket, list);
  }

  for (const [bucket, list] of byBucket.entries()) {
    list.sort((a, b) => a.timestampMs - b.timestampMs);
    byBucket.set(bucket, list);
  }
  return byBucket;
}

function buildRawSignalDateAudit(rawSignalPositions) {
  const safe = Array.isArray(rawSignalPositions) ? rawSignalPositions : [];
  let minMs = null;
  let maxMs = null;
  const monthCounts = new Map();
  const sorted = [...safe].sort((a, b) => a.timestampMs - b.timestampMs);

  for (const point of sorted) {
    if (!Number.isFinite(point.timestampMs)) continue;
    if (minMs == null || point.timestampMs < minMs) minMs = point.timestampMs;
    if (maxMs == null || point.timestampMs > maxMs) maxMs = point.timestampMs;
    const bucket = point.dateBucket ?? getMonthBucket(point.timestampIso);
    if (!bucket) continue;
    monthCounts.set(bucket, (monthCounts.get(bucket) ?? 0) + 1);
  }

  const rawSignalMonthCounts = Object.fromEntries(
    Array.from(monthCounts.entries()).sort((a, b) => a[0].localeCompare(b[0])),
  );
  const toSample = (point) => ({
    timestamp: point.timestampIso ?? null,
    lat: point.lat ?? null,
    lng: point.lng ?? null,
    monthBucket: point.dateBucket ?? getMonthBucket(point.timestampIso) ?? null,
  });
  return {
    rawSignalMinTimestamp: minMs == null ? null : new Date(minMs).toISOString(),
    rawSignalMaxTimestamp: maxMs == null ? null : new Date(maxMs).toISOString(),
    rawSignalMonthCounts,
    rawSignalDistinctMonthBucketCount: monthCounts.size,
    earliestRawSignalPoints: sorted.slice(0, 10).map(toSample),
    latestRawSignalPoints: sorted.slice(Math.max(0, sorted.length - 10)).map(toSample),
  };
}

function nearestPoint(points, targetMs, windowSeconds) {
  const maxDeltaMs = windowSeconds * 1000;
  let best = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const delta = Math.abs(point.timestampMs - targetMs);
    if (delta <= maxDeltaMs && delta < bestDelta) {
      best = point;
      bestDelta = delta;
    }
  }
  return best ? { ...best, deltaSeconds: bestDelta / 1000 } : null;
}

function getNearbyBuckets(iso) {
  const base = getMonthBucket(iso);
  if (!base) return [];
  const [y, m] = base.split("-").map((v) => Number(v));
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const next = new Date(Date.UTC(y, m, 1));
  return Array.from(new Set([base, getMonthBucket(prev.toISOString()), getMonthBucket(next.toISOString())]));
}

function findTimestampMatch(index, timestampIso, windowSeconds) {
  if (!timestampIso) return null;
  const targetMs = Date.parse(timestampIso);
  if (Number.isNaN(targetMs)) return null;
  const buckets = getNearbyBuckets(timestampIso);
  const rawFirst = [];
  const semanticFallback = [];
  for (const b of buckets) {
    const list = index.get(b) ?? [];
    for (const point of list) {
      if (point.source === "rawSignal") rawFirst.push(point);
      else semanticFallback.push(point);
    }
  }
  const rawHit = nearestPoint(rawFirst, targetMs, windowSeconds);
  if (rawHit) return rawHit;
  return nearestPoint(semanticFallback, targetMs, windowSeconds);
}

function csvEscape(value) {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function computeMatchRow(trip, windowSeconds, timelineIndex) {
  const requestHit = findTimestampMatch(timelineIndex, trip.requestTimestampLocal, windowSeconds);
  const beginHit = findTimestampMatch(timelineIndex, trip.beginTripTimestampLocal, windowSeconds);
  const dropoffHit = findTimestampMatch(timelineIndex, trip.dropoffTimestampLocal, windowSeconds);

  const requestMatched = Boolean(requestHit);
  const beginMatched = Boolean(beginHit);
  const dropoffMatched = Boolean(dropoffHit);
  const fullyMatched = beginMatched && dropoffMatched;

  const beginMs = Date.parse(trip.beginTripTimestampLocal);
  const dropoffMs = Date.parse(trip.dropoffTimestampLocal);
  const requestMs = Date.parse(trip.requestTimestampLocal);
  const observedTripDuration = Number.isFinite(beginMs) && Number.isFinite(dropoffMs)
    ? Math.max(0, Math.round((dropoffMs - beginMs) / 1000))
    : null;
  const durationPlausibility =
    trip.tripDurationSeconds != null && observedTripDuration != null
      ? Math.abs(observedTripDuration - trip.tripDurationSeconds) / Math.max(trip.tripDurationSeconds, 1)
      : null;
  const observedDistanceMiles =
    beginHit && dropoffHit
      ? haversineMiles(beginHit.lat, beginHit.lng, dropoffHit.lat, dropoffHit.lng)
      : null;
  const distancePlausibility =
    trip.tripDistanceMiles != null && observedDistanceMiles != null
      ? Math.abs(observedDistanceMiles - trip.tripDistanceMiles) / Math.max(trip.tripDistanceMiles, 0.25)
      : null;
  const pickupDeadMilesEstimate =
    requestHit && beginHit
      ? haversineMiles(requestHit.lat, requestHit.lng, beginHit.lat, beginHit.lng)
      : null;
  const pickupDeadMinutesEstimate =
    Number.isFinite(requestMs) && Number.isFinite(beginMs) ? Math.max(0, (beginMs - requestMs) / 60000) : null;

  const beginSource = beginHit?.source ?? null;
  const dropoffSource = dropoffHit?.source ?? null;
  const sameSource = beginSource && dropoffSource ? beginSource === dropoffSource : null;
  const sourceMix = sameSource == null ? "unknown" : sameSource ? "same-source" : "mixed-source";
  const requestSupport = Boolean(requestMatched && requestHit && requestHit.deltaSeconds <= Math.min(windowSeconds, 90));
  const maxCoreDelta =
    beginMatched && dropoffMatched
      ? Math.max(beginHit.deltaSeconds, dropoffHit.deltaSeconds)
      : null;

  let matchConfidence = "review";
  if (fullyMatched) {
    const strictTiming = maxCoreDelta != null && maxCoreDelta <= Math.min(45, windowSeconds);
    const strictDuration = durationPlausibility == null || durationPlausibility <= 0.35;
    const strictDistance = distancePlausibility == null || distancePlausibility <= 0.6;
    const strictSource = Boolean(sameSource && beginSource === "rawSignal");
    if (strictTiming && strictDuration && strictDistance && requestSupport && strictSource) {
      matchConfidence = "strict";
    } else {
      const goodTiming = maxCoreDelta != null && maxCoreDelta <= windowSeconds;
      const goodDuration = durationPlausibility == null || durationPlausibility <= 0.75;
      const goodDistance = distancePlausibility == null || distancePlausibility <= 1.2;
      if (goodTiming && goodDuration && goodDistance) {
        matchConfidence = "good";
      } else {
        matchConfidence = "review";
      }
    }
  } else if (beginMatched || dropoffMatched || requestMatched) {
    matchConfidence = "review";
  }

  const matchMethod = fullyMatched
    ? [beginHit?.source, dropoffHit?.source].filter(Boolean).join("+")
    : "unmatched";
  const qaBucket = fullyMatched ? "FULL_MATCH" : beginMatched || dropoffMatched ? "PARTIAL_MATCH" : "NO_MATCH";
  const qaNotes = [];
  if (durationPlausibility != null) {
    qaNotes.push(`duration_ratio_diff=${durationPlausibility.toFixed(3)}`);
  }
  if (distancePlausibility != null) {
    qaNotes.push(`distance_ratio_diff=${distancePlausibility.toFixed(3)}`);
  }
  if (pickupDeadMilesEstimate != null) {
    qaNotes.push(`pickup_dead_miles=${pickupDeadMilesEstimate.toFixed(2)}`);
  }

  return {
    uniqueTripId: trip.uniqueTripId,
    requestTimestampLocal: trip.requestTimestampLocal,
    beginTripTimestampLocal: trip.beginTripTimestampLocal,
    dropoffTimestampLocal: trip.dropoffTimestampLocal,
    tripDurationSeconds: trip.tripDurationSeconds,
    tripDistanceMiles: trip.tripDistanceMiles,
    originalFareLocal: trip.originalFareLocal,
    status: trip.status,
    windowSeconds,
    requestMatched,
    beginMatched,
    dropoffMatched,
    requestTimeDeltaSeconds: requestHit ? requestHit.deltaSeconds : null,
    beginTimeDeltaSeconds: beginHit ? beginHit.deltaSeconds : null,
    dropoffTimeDeltaSeconds: dropoffHit ? dropoffHit.deltaSeconds : null,
    requestLat: requestHit?.lat ?? null,
    requestLng: requestHit?.lng ?? null,
    requestAreaLabel: requestHit ? inferAreaLabelFromCoords(requestHit.lat, requestHit.lng) : null,
    beginLat: beginHit?.lat ?? null,
    beginLng: beginHit?.lng ?? null,
    beginAreaLabel: beginHit ? inferAreaLabelFromCoords(beginHit.lat, beginHit.lng) : null,
    dropoffLat: dropoffHit?.lat ?? null,
    dropoffLng: dropoffHit?.lng ?? null,
    dropoffAreaLabel: dropoffHit ? inferAreaLabelFromCoords(dropoffHit.lat, dropoffHit.lng) : null,
    pickupDeadMilesEstimate,
    pickupDeadMinutesEstimate,
    observedDistanceMiles,
    durationPlausibility,
    distancePlausibility,
    requestSupport,
    beginSource,
    dropoffSource,
    sourceMix,
    matchConfidence,
    matchMethod,
    qaBucket,
    qaNotes: qaNotes.join("; "),
    fullyMatched,
  };
}

function writeCsv(filePath, rows) {
  const columns = [
    "uniqueTripId",
    "requestTimestampLocal",
    "beginTripTimestampLocal",
    "dropoffTimestampLocal",
    "tripDurationSeconds",
    "tripDistanceMiles",
    "originalFareLocal",
    "status",
    "windowSeconds",
    "requestMatched",
    "beginMatched",
    "dropoffMatched",
    "requestTimeDeltaSeconds",
    "beginTimeDeltaSeconds",
    "dropoffTimeDeltaSeconds",
    "requestLat",
    "requestLng",
    "requestAreaLabel",
    "beginLat",
    "beginLng",
    "beginAreaLabel",
    "dropoffLat",
    "dropoffLng",
    "dropoffAreaLabel",
    "pickupDeadMilesEstimate",
    "pickupDeadMinutesEstimate",
    "observedDistanceMiles",
    "durationPlausibility",
    "distancePlausibility",
    "requestSupport",
    "beginSource",
    "dropoffSource",
    "sourceMix",
    "matchConfidence",
    "matchMethod",
    "qaBucket",
    "qaNotes",
  ];
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c])).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function average(numbers) {
  const valid = numbers.filter((v) => Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((sum, n) => sum + n, 0) / valid.length;
}

function summarizeConfidence(rows) {
  const matched = rows.filter((r) => r.fullyMatched);
  const buckets = ["strict", "good", "review"];
  const result = {};
  for (const bucket of buckets) {
    const slice = matched.filter((r) => r.matchConfidence === bucket);
    result[bucket] = {
      count: slice.length,
      averageBeginDeltaSeconds: average(slice.map((r) => r.beginTimeDeltaSeconds)),
      averageDropoffDeltaSeconds: average(slice.map((r) => r.dropoffTimeDeltaSeconds)),
      averageRequestDeltaSeconds: average(slice.map((r) => r.requestTimeDeltaSeconds)),
      averageDurationPlausibility: average(slice.map((r) => r.durationPlausibility)),
      averageDistancePlausibility: average(slice.map((r) => r.distancePlausibility)),
    };
  }
  return {
    fullMatchesTotal: matched.length,
    ...result,
  };
}

function pickRandomSample(rows, size) {
  if (rows.length <= size) return [...rows];
  const arr = [...rows];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr.slice(0, size);
}

function summarize(rows, windowSeconds) {
  const total = rows.length;
  const requestMatches = rows.filter((r) => r.requestMatched).length;
  const beginMatches = rows.filter((r) => r.beginMatched).length;
  const dropoffMatches = rows.filter((r) => r.dropoffMatched).length;
  const fullMatched = rows.filter((r) => r.fullyMatched).length;
  const beginDeltas = rows.map((r) => r.beginTimeDeltaSeconds).filter((v) => Number.isFinite(v));
  const dropDeltas = rows.map((r) => r.dropoffTimeDeltaSeconds).filter((v) => Number.isFinite(v));
  const avg = (arr) => (arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length);
  return {
    windowSeconds,
    totalTripsTested: total,
    requestMatches,
    beginMatches,
    dropoffMatches,
    fullMatchedTrips: fullMatched,
    percentageMatched: total > 0 ? (fullMatched / total) * 100 : 0,
    averageBeginDeltaSeconds: avg(beginDeltas),
    averageDropoffDeltaSeconds: avg(dropDeltas),
    confidence: summarizeConfidence(rows),
  };
}

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function newestFile(dir, predicate) {
  const files = fs
    .readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((p) => fs.statSync(p).isFile() && predicate(path.basename(p)))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] ?? null;
}

async function main() {
  const uploadsDir = path.join(__dirname, "uploads");
  const zipPath =
    getArg("zip") ??
    newestFile(uploadsDir, (name) => /^import_.*\.zip$/i.test(name));
  const timelinePath =
    getArg("timeline") ??
    newestFile(
      path.join(uploadsDir, "storage", "timeline"),
      () => false,
    );

  let resolvedTimelinePath = timelinePath;
  if (!resolvedTimelinePath) {
    const timelineDirs = fs
      .readdirSync(path.join(uploadsDir, "storage", "timeline"))
      .map((d) => path.join(uploadsDir, "storage", "timeline", d))
      .filter((p) => fs.statSync(p).isDirectory())
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const dir of timelineDirs) {
      const candidate = path.join(dir, "Timeline.json");
      if (fs.existsSync(candidate)) {
        resolvedTimelinePath = candidate;
        break;
      }
    }
  }
  const outDir = getArg("outDir") ?? path.join(uploadsDir, "experiments", "trip_first");

  if (!zipPath) throw new Error("No import ZIP found. Pass --zip=<path>");
  if (!resolvedTimelinePath || !fs.existsSync(resolvedTimelinePath)) {
    throw new Error("No Timeline.json found. Pass --timeline=<path>");
  }
  fs.mkdirSync(outDir, { recursive: true });

  const { trips, tripsEntry } = buildTripRows(zipPath);
  const parsedTimeline = await parseTimelineFileChunked(resolvedTimelinePath, "trip-first-experiment");
  const rawIndex = buildRawSignalIndex(parsedTimeline.rawSignalPositions ?? []);
  const timelinePathPoints = await extractTimelinePathPointPositions(resolvedTimelinePath);
  const pointIndex = makeTimelinePointIndex(rawIndex, timelinePathPoints);
  const rawSignalPointsFlattened = Array.from(rawIndex.values()).flatMap((points) =>
    points.map((p) => ({
      timestampMs: p.timestampMs,
      timestampIso: p.timestampIso,
      lat: p.lat,
      lng: p.lng,
      dateBucket: p.dateBucket,
      source: "rawSignal",
    })),
  );
  const combinedPointsFlattened = Array.from(pointIndex.values()).flatMap((points) => points);

  const windows = [60, 120];
  const rawSignalDateAudit = buildRawSignalDateAudit(parsedTimeline.rawSignalPositions ?? []);
  const timelinePathDateAudit = auditPoints(timelinePathPoints);
  const combinedPointDateAudit = auditPoints(combinedPointsFlattened);
  const summary = {
    generatedAt: new Date().toISOString(),
    zipPath,
    timelinePath: resolvedTimelinePath,
    tripsEntry,
    tripsCount: trips.length,
    rawSignalDateAudit,
    timelinePathDateAudit,
    combinedPointDateAudit,
    windows: [],
    outputs: {},
  };

  for (const windowSeconds of windows) {
    const rows = trips.map((trip) => computeMatchRow(trip, windowSeconds, pointIndex));
    const csvPath = path.join(outDir, `timeline_trip_match_${windowSeconds}s.csv`);
    writeCsv(csvPath, rows);
    const qaSample = pickRandomSample(
      rows.filter((r) => r.fullyMatched),
      100,
    );
    const qaPath = path.join(outDir, `${windowSeconds}s_qa_sample.csv`);
    writeCsv(qaPath, qaSample);
    const windowSummary = summarize(rows, windowSeconds);
    summary.windows.push(windowSummary);
    summary.outputs[`csv_${windowSeconds}s`] = csvPath;
    summary.outputs[`qa_${windowSeconds}s`] = qaPath;
  }

  const summaryPath = path.join(outDir, "timeline_trip_match_summary.json");
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  summary.outputs.summary = summaryPath;

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("[trip-first-experiment] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
