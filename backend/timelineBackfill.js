const fs = require("fs");

function toIso(value) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function toNumber(value) {
  if (value == null) {
    return null;
  }
  const parsed = Number.parseFloat(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

function getDateBucket(iso) {
  if (!iso) {
    return null;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  const month = `${d.getUTCMonth() + 1}`.padStart(2, "0");
  return `${d.getUTCFullYear()}-${month}`;
}

function parseLatLngFromValue(value) {
  if (value == null) {
    return { lat: null, lng: null };
  }
  if (typeof value === "object") {
    const lat = toNumber(value.latitude ?? value.lat);
    const lng = toNumber(value.longitude ?? value.lng);
    if (lat != null && lng != null) {
      return { lat, lng };
    }
  }

  const raw = String(value).trim();
  if (!raw) {
    return { lat: null, lng: null };
  }
  // Supports forms like:
  // - "54.597,-5.930"
  // - "geo:54.597,-5.930"
  // - "54.597°,-5.930°"
  const cleaned = raw.replace(/^geo:/i, "").replace(/°/g, "");
  const parts = cleaned.split(",").map((p) => p.trim());
  if (parts.length < 2) {
    return { lat: null, lng: null };
  }
  const lat = toNumber(parts[0]);
  const lng = toNumber(parts[1]);
  return { lat, lng };
}

function extractTimestamp(payload, keys) {
  for (const key of keys) {
    if (!key) {
      continue;
    }
    const value = key
      .split(".")
      .reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), payload);
    const iso = toIso(value);
    if (iso) {
      return iso;
    }
  }
  return null;
}

function inferParserBranch(entry) {
  if (entry?.timelinePath || entry?.activity || entry?.visit) {
    return "semantic-segments";
  }
  if (entry?.activitySegment || entry?.placeVisit) {
    return "semantic-segments";
  }
  return "unknown-entry";
}

function detectSemanticSubtype(entry) {
  if (entry?.timelinePath) {
    return "timelinePath";
  }
  if (entry?.activity || entry?.activitySegment) {
    return "activity";
  }
  if (entry?.visit || entry?.placeVisit) {
    return "visit";
  }
  return "unknown";
}

function extractTimelinePathEndpoints(timelinePathPayload) {
  const points = Array.isArray(timelinePathPayload)
    ? timelinePathPayload
    : Array.isArray(timelinePathPayload?.points)
      ? timelinePathPayload.points
      : Array.isArray(timelinePathPayload?.point)
        ? timelinePathPayload.point
        : [];

  if (points.length === 0) {
    return { startLat: null, startLng: null, endLat: null, endLng: null, pathPointCount: 0 };
  }
  const first = points[0];
  const last = points[points.length - 1];
  const firstLatLng = parseLatLngFromValue(
    first?.latLng ?? first?.location ?? first?.point ?? first,
  );
  const lastLatLng = parseLatLngFromValue(
    last?.latLng ?? last?.location ?? last?.point ?? last,
  );
  return {
    startLat: firstLatLng.lat,
    startLng: firstLatLng.lng,
    endLat: lastLatLng.lat,
    endLng: lastLatLng.lng,
    pathPointCount: points.length,
  };
}

function extractRawSignalPosition(entry, sourceFileId) {
  const payload = entry?.position ?? entry?.rawSignals?.position ?? null;
  const payloads = Array.isArray(payload) ? payload : payload ? [payload] : [];
  if (payloads.length === 0) {
    return [];
  }
  const extracted = [];
  for (const item of payloads) {
    const timestampIso =
      toIso(item?.timestamp) ??
      toIso(item?.time) ??
      toIso(item?.timestampMs) ??
      toIso(item?.recordedAt) ??
      null;
    if (!timestampIso) {
      continue;
    }
    const latLng = parseLatLngFromValue(
      item?.latLng ??
        item?.LatLng ??
        item?.coordinate ??
        item?.location?.latLng ??
        item?.location?.LatLng ??
        item?.location ??
        item,
    );
    if (latLng.lat == null || latLng.lng == null) {
      continue;
    }
    const timestampMs = Date.parse(timestampIso);
    if (Number.isNaN(timestampMs)) {
      continue;
    }
    extracted.push({
      sourceFileId,
      timestampIso,
      timestampMs,
      lat: latLng.lat,
      lng: latLng.lng,
      dateBucket: getDateBucket(timestampIso),
    });
  }
  return extracted;
}

function normalizeTimelineEntry(entry, sourceFileId) {
  const timelinePath = entry.timelinePath ?? null;
  const activity = entry.activity ?? null;
  const visit = entry.visit ?? null;
  const activitySegment = entry.activitySegment ?? null;
  const placeVisit = entry.placeVisit ?? null;

  const payload =
    timelinePath ||
    activity ||
    visit ||
    activitySegment ||
    placeVisit;
  if (!payload) {
    return { segment: null, reason: "missing_supported_payload" };
  }

  const segmentType = timelinePath
    ? "timelinePath"
    : activity
      ? "activity"
      : visit
        ? "visit"
        : activitySegment
          ? "activity"
          : "visit";

  const startTime = extractTimestamp(entry, [
    "startTime",
    "startTimestamp",
    "start_time",
  ]) ?? extractTimestamp(payload, [
    "startTime",
    "startTimestamp",
    "start_time",
    "duration.startTimestamp",
    "duration.startTime",
  ]);
  const endTime = extractTimestamp(entry, [
    "endTime",
    "endTimestamp",
    "end_time",
  ]) ?? extractTimestamp(payload, [
    "endTime",
    "endTimestamp",
    "end_time",
    "duration.endTimestamp",
    "duration.endTime",
  ]);

  const isTimelinePath = Boolean(timelinePath);
  const pathEndpoints = isTimelinePath
    ? extractTimelinePathEndpoints(timelinePath)
    : { startLat: null, startLng: null, endLat: null, endLng: null, pathPointCount: 0 };

  const activityPayload = activity ?? activitySegment ?? null;
  const visitPayload = visit ?? placeVisit ?? null;
  const activityStartLatLng = parseLatLngFromValue(activityPayload?.start?.latLng);
  const activityEndLatLng = parseLatLngFromValue(activityPayload?.end?.latLng);
  const visitLatLng = parseLatLngFromValue(visitPayload?.topCandidate?.placeLocation?.latLng);
  const startFromLatLng = parseLatLngFromValue(
    payload.startLocation?.latLng ?? payload.location?.latLng
  );
  const endFromLatLng = parseLatLngFromValue(
    payload.endLocation?.latLng ?? payload.location?.latLng
  );
  const startLat =
    toNumber(payload.startLat ?? payload.startLatitude ?? payload.latitudeE7Start) ??
    pathEndpoints.startLat ??
    activityStartLatLng.lat ??
    visitLatLng.lat ??
    startFromLatLng.lat;
  const startLng =
    toNumber(payload.startLng ?? payload.startLongitude ?? payload.longitudeE7Start) ??
    pathEndpoints.startLng ??
    activityStartLatLng.lng ??
    visitLatLng.lng ??
    startFromLatLng.lng;
  const endLat =
    toNumber(payload.endLat ?? payload.endLatitude ?? payload.latitudeE7End) ??
    pathEndpoints.endLat ??
    activityEndLatLng.lat ??
    visitLatLng.lat ??
    endFromLatLng.lat;
  const endLng =
    toNumber(payload.endLng ?? payload.endLongitude ?? payload.longitudeE7End) ??
    pathEndpoints.endLng ??
    activityEndLatLng.lng ??
    visitLatLng.lng ??
    endFromLatLng.lng;
  const distanceMeters = toNumber(
    payload.distanceMeters ??
      payload.distance_meters ??
      activityPayload?.distanceMeters ??
      activityPayload?.distance_meters
  );
  const semanticType = String(
    payload.semanticType ??
      payload.activityType ??
      payload.visitType ??
      activityPayload?.topCandidate?.type ??
      visitPayload?.topCandidate?.semanticType ??
      segmentType,
  );
  const dateBucket = getDateBucket(startTime ?? endTime);

  if (!startTime && !endTime) {
    return { segment: null, reason: "missing_time_fields" };
  }

  return {
    segment: {
    segmentType,
    startTime,
    endTime,
    startLat,
    startLng,
    endLat,
    endLng,
    distanceMeters,
    semanticType,
    sourceFileId,
    dateBucket,
    pathPointCount: pathEndpoints.pathPointCount,
    },
    reason: null,
  };
}

async function parseTimelineFileChunked(filePath, sourceFileId) {
  const segments = [];
  const rawSignalPositions = [];
  const diagnostics = {
    mode: "stream-object",
    chunksRead: 0,
    parsedObjects: 0,
    parseErrors: 0,
    ndjsonModeDetected: false,
    candidateObjectsSeen: 0,
    emittedSegments: 0,
    skippedReasonCounts: {},
    parserBranchSelected: "unknown",
    rootType: "unknown",
    topLevelKeys: [],
    candidateCounts: {},
    sampleShapes: [],
    formatDetected: "unknown",
    zeroSegmentReason: null,
    semanticSubtypeCounts: {
      timelinePath: 0,
      activity: 0,
      visit: 0,
      unknown: 0,
    },
    emittedBySubtype: {
      timelinePath: 0,
      activity: 0,
      visit: 0,
      unknown: 0,
    },
    skippedBySubtype: {
      timelinePath: {},
      activity: {},
      visit: {},
      unknown: {},
    },
    rawSignalsDiagnostics: {
      topLevelKeysCounts: {},
      positionEntriesSeen: 0,
      extractedPointCount: 0,
      samplePositionKeys: [],
      sampleExtractedPoints: [],
    },
  };

  let inspectRoot = null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const trimmed = raw.trim();
    diagnostics.rootType = trimmed.startsWith("[")
      ? "array"
      : trimmed.startsWith("{")
        ? "object"
        : "unknown";
    if (diagnostics.rootType === "array") {
      diagnostics.parserBranchSelected = "stream-any-object-in-array";
      diagnostics.formatDetected = "array-of-segments-or-objects";
    } else if (diagnostics.rootType === "object") {
      const parsedRoot = JSON.parse(raw);
      inspectRoot = parsedRoot;
      diagnostics.topLevelKeys = Object.keys(parsedRoot).slice(0, 50);
      const candidateCounts = {};
      for (const key of diagnostics.topLevelKeys) {
        const value = parsedRoot[key];
        if (Array.isArray(value)) {
          candidateCounts[key] = value.length;
        } else if (value && typeof value === "object") {
          candidateCounts[key] = Object.keys(value).length;
        }
      }
      diagnostics.candidateCounts = candidateCounts;

      const samples = [];
      for (const key of diagnostics.topLevelKeys) {
        const value = parsedRoot[key];
        if (Array.isArray(value) && value.length > 0) {
          for (let i = 0; i < Math.min(3 - samples.length, value.length); i += 1) {
            const item = value[i];
            if (item && typeof item === "object") {
              samples.push({
                fromKey: key,
                sampleKeys: Object.keys(item).slice(0, 12),
              });
            }
          }
        } else if (value && typeof value === "object" && samples.length < 3) {
          samples.push({
            fromKey: key,
            sampleKeys: Object.keys(value).slice(0, 12),
          });
        }
        if (samples.length >= 3) {
          break;
        }
      }
      diagnostics.sampleShapes = samples;

      if (Array.isArray(parsedRoot.semanticSegments)) {
        diagnostics.formatDetected = "google-takeout-semanticSegments";
        diagnostics.parserBranchSelected = "semantic-segments";
      } else if (Array.isArray(parsedRoot.timelineObjects)) {
        diagnostics.formatDetected = "google-takeout-timelineObjects";
        diagnostics.parserBranchSelected = "timeline-objects";
      } else if (Array.isArray(parsedRoot.locations)) {
        diagnostics.formatDetected = "google-takeout-raw-locations";
        diagnostics.parserBranchSelected = "raw-locations-unsupported";
      } else {
        diagnostics.formatDetected = "object-with-unknown-nesting";
        diagnostics.parserBranchSelected = "stream-any-object-in-object";
      }
    }
  } catch {
    diagnostics.rootType = "unknown";
    diagnostics.formatDetected = "parse-inspection-failed";
    diagnostics.parserBranchSelected = "stream-any-object";
  }

  const processEntryCandidate = (entry, fromKey) => {
    diagnostics.candidateObjectsSeen += 1;
    const subtype = detectSemanticSubtype(entry);
    diagnostics.semanticSubtypeCounts[subtype] =
      (diagnostics.semanticSubtypeCounts[subtype] ?? 0) + 1;
    if (diagnostics.sampleShapes.length < 3 && entry && typeof entry === "object") {
      diagnostics.sampleShapes.push({
        fromKey,
        sampleKeys: Object.keys(entry).slice(0, 12),
      });
    }
    const branch = inferParserBranch(entry);
    if (diagnostics.parserBranchSelected === "unknown" && branch !== "unknown-entry") {
      diagnostics.parserBranchSelected = branch;
    }
    const normalized = normalizeTimelineEntry(entry, sourceFileId);
    if (normalized.segment) {
      segments.push(normalized.segment);
      diagnostics.emittedSegments += 1;
      diagnostics.emittedBySubtype[subtype] =
        (diagnostics.emittedBySubtype[subtype] ?? 0) + 1;
      return;
    }
    const reason = normalized.reason ?? "not_emitted";
    diagnostics.skippedReasonCounts[reason] =
      (diagnostics.skippedReasonCounts[reason] ?? 0) + 1;
    const subtypeSkips = diagnostics.skippedBySubtype[subtype] ?? {};
    subtypeSkips[reason] = (subtypeSkips[reason] ?? 0) + 1;
    diagnostics.skippedBySubtype[subtype] = subtypeSkips;
  };

  const processRawSignalCandidate = (entry) => {
    const entryKeys = entry && typeof entry === "object" ? Object.keys(entry) : [];
    for (const key of entryKeys) {
      diagnostics.rawSignalsDiagnostics.topLevelKeysCounts[key] =
        (diagnostics.rawSignalsDiagnostics.topLevelKeysCounts[key] ?? 0) + 1;
    }
    const positionPayload = entry?.position ?? null;
    const positionPayloads = Array.isArray(positionPayload)
      ? positionPayload
      : positionPayload
        ? [positionPayload]
        : [];
    diagnostics.rawSignalsDiagnostics.positionEntriesSeen += positionPayloads.length;
    if (positionPayloads.length > 0 && diagnostics.rawSignalsDiagnostics.samplePositionKeys.length < 3) {
      for (const payload of positionPayloads) {
        if (!payload || typeof payload !== "object") {
          continue;
        }
        diagnostics.rawSignalsDiagnostics.samplePositionKeys.push(
          Object.keys(payload).slice(0, 12),
        );
        if (diagnostics.rawSignalsDiagnostics.samplePositionKeys.length >= 3) {
          break;
        }
      }
    }
    const positions = extractRawSignalPosition(entry, sourceFileId);
    if (!positions || positions.length === 0) {
      return;
    }
    diagnostics.rawSignalsDiagnostics.extractedPointCount += positions.length;
    for (const point of positions) {
      rawSignalPositions.push(point);
      if (diagnostics.rawSignalsDiagnostics.sampleExtractedPoints.length < 10) {
        diagnostics.rawSignalsDiagnostics.sampleExtractedPoints.push({
          timestampIso: point.timestampIso,
          lat: point.lat,
          lng: point.lng,
          dateBucket: point.dateBucket,
        });
      }
    }
  };

  // If we inspected a root object with known timeline arrays, process them directly.
  if (inspectRoot && diagnostics.rootType === "object") {
    const directCandidates = [];
    if (Array.isArray(inspectRoot.semanticSegments)) {
      for (const item of inspectRoot.semanticSegments) {
        directCandidates.push({ entry: item, fromKey: "semanticSegments" });
      }
    }
    if (Array.isArray(inspectRoot.rawSignals)) {
      for (const item of inspectRoot.rawSignals) {
        processRawSignalCandidate(item);
      }
    }
    if (Array.isArray(inspectRoot.timelineObjects)) {
      for (const item of inspectRoot.timelineObjects) {
        directCandidates.push({ entry: item, fromKey: "timelineObjects" });
      }
    }
    if (Array.isArray(inspectRoot.timelinePath)) {
      for (const item of inspectRoot.timelinePath) {
        directCandidates.push({ entry: item, fromKey: "timelinePath" });
      }
    }
    if (directCandidates.length > 0) {
      diagnostics.mode = "root-array-direct";
      for (const candidate of directCandidates) {
        processEntryCandidate(candidate.entry, candidate.fromKey);
      }
      if (segments.length > 0) {
        return { segments, rawSignalPositions, diagnostics };
      }
    }
  }

  const stream = fs.createReadStream(filePath, { encoding: "utf8", highWaterMark: 64 * 1024 });
  let buffer = "";
  let objectStart = -1;
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  const pushObjectCandidate = (rawObject) => {
    const trimmed = rawObject.trim().replace(/,\s*$/, "");
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      return;
    }
    try {
      const obj = JSON.parse(trimmed);
      diagnostics.parsedObjects += 1;
      processRawSignalCandidate(obj);
      processEntryCandidate(obj, "stream-object");
    } catch {
      diagnostics.parseErrors += 1;
    }
  };

  for await (const chunk of stream) {
    diagnostics.chunksRead += 1;
    const text = String(chunk);
    if (!diagnostics.ndjsonModeDetected && text.includes("\n{")) {
      diagnostics.ndjsonModeDetected = true;
    }
    buffer += text;

    for (let i = 0; i < buffer.length; i += 1) {
      const ch = buffer[i];
      if (inString) {
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        if (ch === "\\") {
          escapeNext = true;
          continue;
        }
        if (ch === "\"") {
          inString = false;
        }
        continue;
      }

      if (ch === "\"") {
        inString = true;
        continue;
      }
      if (ch === "{") {
        if (depth === 0) {
          objectStart = i;
        }
        depth += 1;
        continue;
      }
      if (ch === "}") {
        if (depth > 0) {
          depth -= 1;
          if (depth === 0 && objectStart >= 0) {
            pushObjectCandidate(buffer.slice(objectStart, i + 1));
            buffer = buffer.slice(i + 1);
            i = -1;
            objectStart = -1;
          }
        }
      }
    }
  }

  if (segments.length === 0) {
    const reasonParts = [];
    if (diagnostics.parsedObjects === 0) {
      reasonParts.push("no_objects_parsed");
    }
    if (diagnostics.candidateObjectsSeen > 0 && diagnostics.emittedSegments === 0) {
      reasonParts.push("objects_seen_but_no_supported_segment_shape");
    }
    const skippedReasons = Object.entries(diagnostics.skippedReasonCounts)
      .map(([key, value]) => `${key}:${value}`)
      .join(",");
    if (skippedReasons) {
      reasonParts.push(`skipped=${skippedReasons}`);
    }
    diagnostics.zeroSegmentReason = reasonParts.join(";") || "unknown";
  }

  return { segments, rawSignalPositions, diagnostics };
}

function buildTimelineIndex(segments) {
  const byBucket = new Map();
  for (const segment of segments) {
    if (!segment.dateBucket) {
      continue;
    }
    const list = byBucket.get(segment.dateBucket) ?? [];
    list.push(segment);
    byBucket.set(segment.dateBucket, list);
  }
  return byBucket;
}

function buildRawSignalIndex(rawSignalPositions) {
  const byBucket = new Map();
  for (const point of rawSignalPositions ?? []) {
    if (!point.dateBucket) {
      continue;
    }
    const list = byBucket.get(point.dateBucket) ?? [];
    list.push(point);
    byBucket.set(point.dateBucket, list);
  }
  for (const [bucket, list] of byBucket.entries()) {
    list.sort((a, b) => a.timestampMs - b.timestampMs);
    byBucket.set(bucket, list);
  }
  return byBucket;
}

function scoreTimelineCandidate(tripRequestMs, segment) {
  const startMs = Date.parse(segment.startTime ?? "");
  const endMs = Date.parse(segment.endTime ?? segment.startTime ?? "");
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return null;
  }
  const nearestMs = Math.min(
    Math.abs(tripRequestMs - startMs),
    Math.abs(tripRequestMs - endMs),
  );
  const durationSec = Math.max(0, Math.floor((endMs - startMs) / 1000));
  let score = 0;
  if (nearestMs <= 60_000) {
    score += 3;
  } else if (nearestMs <= 5 * 60_000) {
    score += 2;
  } else if (nearestMs <= 15 * 60_000) {
    score += 1;
  }
  if (durationSec > 30 && durationSec < 3 * 60 * 60) {
    score += 1;
  }
  if (segment.distanceMeters != null && segment.distanceMeters > 50) {
    score += 1;
  }
  return {
    score,
    nearestMs,
    durationSec,
    startMs,
    endMs,
  };
}

function confidenceFromScore(score) {
  if (score >= 5) {
    return "high";
  }
  if (score >= 4) {
    return "likely";
  }
  if (score >= 2) {
    return "review";
  }
  return "weak";
}

function correlateHistoricalTripsWithTimeline(args) {
  const { importId, sequenceSuggestions, segmentsByBucket, rawSignalsByBucket } = args;
  const inferred = [];
  const scoredSamples = [];
  const metrics = {
    timelineCandidatesFound: 0,
    promotedHighCount: 0,
    promotedLikelyCount: 0,
    keptReviewCount: 0,
    duplicatesRejected: 0,
    poorDistanceFitRejected: 0,
    poorDurationFitRejected: 0,
    nonUniqueRejected: 0,
    scoreHistogram: {
      lt2: 0,
      b2_3: 0,
      b3_4: 0,
      b4_5: 0,
      b5_6: 0,
      b6_8: 0,
      gte8: 0,
    },
    promotionBlockers: {
      belowLikelyThreshold: 0,
      belowHighThreshold: 0,
      downgradedByUniquenessMargin: 0,
      missingDurationData: 0,
      missingDistanceData: 0,
      weakAreaSupport: 0,
      weakRawSignalSupport: 0,
    },
    scoringPathDiagnostics: {
      durationComparedCount: 0,
      durationMissingDataCount: 0,
      distanceComparedCount: 0,
      distanceMissingDataCount: 0,
    },
    scoringInputCounts: {
      matchesWithRawSignalSupport: 0,
      matchesWithAreaScoreNonZero: 0,
      matchesWithDurationScoreNonZero: 0,
      matchesWithDistanceScoreNonZero: 0,
    },
  };
  const usedBundleKeys = new Set();

  const getNearbySegments = (tripIso) => {
    const bucket = getDateBucket(tripIso);
    const [year, month] = (bucket ?? "").split("-").map((v) => Number(v));
    const buckets = [];
    if (bucket) {
      buckets.push(bucket);
    }
    if (Number.isFinite(year) && Number.isFinite(month)) {
      const prevDate = new Date(Date.UTC(year, month - 2, 1));
      const nextDate = new Date(Date.UTC(year, month, 1));
      buckets.push(getDateBucket(prevDate.toISOString()));
      buckets.push(getDateBucket(nextDate.toISOString()));
    }
    const unique = Array.from(new Set(buckets.filter(Boolean)));
    const segments = unique.flatMap((b) => segmentsByBucket.get(b) ?? []);
    const rawSignals = unique.flatMap((b) => rawSignalsByBucket?.get(b) ?? []);
    return { segments, rawSignals };
  };

  const haversineMiles = (lat1, lng1, lat2, lng2) => {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const Rm = 3958.8;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Rm * c;
  };

  const areaHintFromLatLng = (lat, lng) => {
    if (lat == null || lng == null) {
      return null;
    }
    if (lat >= 54.64 && lat <= 54.67 && lng >= -6.24 && lng <= -6.19) {
      return "BT29 area";
    }
    if (lat >= 54.60 && lat <= 54.62 && lng >= -5.88 && lng <= -5.83) {
      return "BFS Airport";
    }
    if (lat >= 54.58 && lat <= 54.61 && lng >= -5.95 && lng <= -5.90) {
      return "Belfast City Centre";
    }
    if (lat >= 54.59 && lat <= 54.61 && lng >= -5.94 && lng <= -5.91) {
      return "BT1 area";
    }
    return "Local area";
  };

  const getHistogramBucket = (score) => {
    if (score < 2) {
      return "lt2";
    }
    if (score < 3) {
      return "b2_3";
    }
    if (score < 4) {
      return "b3_4";
    }
    if (score < 5) {
      return "b4_5";
    }
    if (score < 6) {
      return "b5_6";
    }
    if (score < 8) {
      return "b6_8";
    }
    return "gte8";
  };

  const scoreBundle = (trip, bundle) => {
    const reasons = [];
    const components = {
      timestampScore: 0,
      durationScore: 0,
      distanceScore: 0,
      areaScore: 0,
      rawSignalScore: 0,
      uniquenessAdjustment: 0,
    };
    let score = 0;
    const tripMs = Date.parse(trip.tripRequestTimestamp ?? "");
    const startMs = Date.parse(bundle.segment.startTime ?? "");
    const endMs = Date.parse(bundle.segment.endTime ?? bundle.segment.startTime ?? "");
    const midMs = !Number.isNaN(startMs) && !Number.isNaN(endMs)
      ? startMs + Math.floor((endMs - startMs) / 2)
      : NaN;
    if (!Number.isNaN(tripMs) && !Number.isNaN(midMs)) {
      const diffMin = Math.abs(tripMs - midMs) / 60_000;
      if (diffMin <= 2) {
        components.timestampScore = 4;
      } else if (diffMin <= 5) {
        components.timestampScore = 3;
      } else if (diffMin <= 15) {
        components.timestampScore = 2;
      } else if (diffMin <= 30) {
        components.timestampScore = 1;
      } else {
        components.timestampScore = -3;
        reasons.push("large_time_mismatch");
      }
      score += components.timestampScore;
    }

    const segDuration = !Number.isNaN(startMs) && !Number.isNaN(endMs)
      ? Math.max(0, Math.floor((endMs - startMs) / 1000))
      : null;
    const tripDuration = Number.isFinite(Number(trip.durationSeconds))
      ? Number(trip.durationSeconds)
      : null;
    if (tripDuration && segDuration != null) {
      metrics.scoringPathDiagnostics.durationComparedCount += 1;
      const ratioDiff = Math.abs(segDuration - tripDuration) / Math.max(tripDuration, 1);
      if (ratioDiff <= 0.25) {
        components.durationScore = 3;
      } else if (ratioDiff <= 0.5) {
        components.durationScore = 2;
      } else if (ratioDiff <= 1) {
        components.durationScore = 1;
      } else if (ratioDiff > 2) {
        components.durationScore = -3;
        reasons.push("poor_duration_fit");
      } else {
        components.durationScore = -1;
      }
      score += components.durationScore;
    } else {
      metrics.scoringPathDiagnostics.durationMissingDataCount += 1;
    }

    const tripDistance = Number.isFinite(Number(trip.distanceMiles))
      ? Number(trip.distanceMiles)
      : null;
    const bundleDistance =
      Number.isFinite(Number(bundle.segment.distanceMeters))
        ? Number(bundle.segment.distanceMeters) / 1609.34
        : (
            bundle.segment.startLat != null &&
            bundle.segment.startLng != null &&
            bundle.segment.endLat != null &&
            bundle.segment.endLng != null
          )
          ? haversineMiles(
              bundle.segment.startLat,
              bundle.segment.startLng,
              bundle.segment.endLat,
              bundle.segment.endLng,
            )
          : null;
    if (tripDistance && bundleDistance != null) {
      metrics.scoringPathDiagnostics.distanceComparedCount += 1;
      const absDiff = Math.abs(bundleDistance - tripDistance);
      const pctDiff = absDiff / Math.max(tripDistance, 0.1);
      if (absDiff <= 1 || pctDiff <= 0.25) {
        components.distanceScore = 3;
      } else if (pctDiff <= 0.5) {
        components.distanceScore = 1;
      } else if (pctDiff > 1) {
        components.distanceScore = -3;
        reasons.push("poor_distance_fit");
      } else {
        components.distanceScore = -1;
      }
      score += components.distanceScore;
    } else {
      metrics.scoringPathDiagnostics.distanceMissingDataCount += 1;
    }

    const tripArea = String(trip.areaHint ?? "").toLowerCase();
    const bundleArea = String(bundle.areaHint ?? "").toLowerCase();
    if (tripArea && bundleArea) {
      if (tripArea === bundleArea || tripArea.includes(bundleArea) || bundleArea.includes(tripArea)) {
        components.areaScore = 1;
      } else {
        components.areaScore = -1;
      }
      score += components.areaScore;
    }

    if (bundle.rawSignalSupport >= 2) {
      components.rawSignalScore = 1;
      score += components.rawSignalScore;
    }

    return {
      score,
      reasons,
      components,
      derived: {
        tripDuration,
        segmentDuration: segDuration,
        tripDistance,
        segmentDistance: bundleDistance,
      },
    };
  };

  const toConfidence = (score) => {
    if (score >= 8) {
      return "high";
    }
    if (score >= 5) {
      return "likely";
    }
    if (score >= 2) {
      return "review";
    }
    return "weak";
  };

  for (const item of sequenceSuggestions ?? []) {
    const tripIso = item.tripRequestTimestamp ?? null;
    if (!tripIso) {
      continue;
    }
    const tripMs = Date.parse(tripIso);
    if (Number.isNaN(tripMs)) {
      continue;
    }
    const nearby = getNearbySegments(tripIso);
    const movementCandidates = nearby.segments.filter(
      (segment) => segment.segmentType === "timelinePath" || segment.segmentType === "activity"
    );
    const visitCandidates = nearby.segments.filter((segment) => segment.segmentType === "visit");
    const bundles = [];

    for (const movement of movementCandidates) {
      const moveStartMs = Date.parse(movement.startTime ?? "");
      const moveEndMs = Date.parse(movement.endTime ?? movement.startTime ?? "");
      if (Number.isNaN(moveStartMs) || Number.isNaN(moveEndMs)) {
        continue;
      }
      const proximityMs = Math.min(
        Math.abs(tripMs - moveStartMs),
        Math.abs(tripMs - moveEndMs),
      );
      if (proximityMs > 2 * 60 * 60 * 1000) {
        continue;
      }

      const prevVisit = visitCandidates
        .filter((visit) => {
          const end = Date.parse(visit.endTime ?? visit.startTime ?? "");
          return !Number.isNaN(end) && end <= moveStartMs && moveStartMs - end <= 90 * 60 * 1000;
        })
        .sort((a, b) => Date.parse(b.endTime ?? b.startTime ?? "") - Date.parse(a.endTime ?? a.startTime ?? ""))[0] ?? null;
      const nextVisit = visitCandidates
        .filter((visit) => {
          const start = Date.parse(visit.startTime ?? "");
          return !Number.isNaN(start) && start >= moveEndMs && start - moveEndMs <= 90 * 60 * 1000;
        })
        .sort((a, b) => Date.parse(a.startTime ?? "") - Date.parse(b.startTime ?? ""))[0] ?? null;

      const intervalStart = Math.min(moveStartMs, moveEndMs) - 5 * 60 * 1000;
      const intervalEnd = Math.max(moveStartMs, moveEndMs) + 5 * 60 * 1000;
      const intervalSignalCount = nearby.rawSignals.filter((signal) =>
        signal.timestampMs >= intervalStart && signal.timestampMs <= intervalEnd
      ).length;
      const startSignalCount = nearby.rawSignals.filter(
        (signal) => Math.abs(signal.timestampMs - moveStartMs) <= 10 * 60 * 1000,
      ).length;
      const endSignalCount = nearby.rawSignals.filter(
        (signal) => Math.abs(signal.timestampMs - moveEndMs) <= 10 * 60 * 1000,
      ).length;
      const rawSignalSupport =
        intervalSignalCount >= 3
          ? 2
          : intervalSignalCount > 0 || startSignalCount > 0 || endSignalCount > 0
            ? 1
            : 0;

      const areaHint =
        prevVisit?.semanticType ??
        nextVisit?.semanticType ??
        areaHintFromLatLng(movement.startLat, movement.startLng) ??
        areaHintFromLatLng(movement.endLat, movement.endLng);

      const bundle = {
        segment: movement,
        prevVisit,
        nextVisit,
        areaHint,
        rawSignalSupport,
      };
      const scored = scoreBundle(item, bundle);
      bundles.push({ bundle, scored });
    }

    if (bundles.length === 0) {
      continue;
    }

    metrics.timelineCandidatesFound += 1;
    bundles.sort((a, b) => b.scored.score - a.scored.score);
    const best = bundles[0];
    const second = bundles[1] ?? null;
    if (best.scored.reasons.includes("poor_distance_fit")) {
      metrics.poorDistanceFitRejected += 1;
    }
    if (best.scored.reasons.includes("poor_duration_fit")) {
      metrics.poorDurationFitRejected += 1;
    }

    const bundleKey = `${best.bundle.segment.segmentType}:${best.bundle.segment.startTime ?? "na"}:${best.bundle.segment.endTime ?? "na"}`;
    const margin = second ? best.scored.score - second.scored.score : 99;
    const preUniquenessConfidence = toConfidence(best.scored.score);
    const sample = {
      candidateId: `${importId}:${tripIso}`,
      tripDate: tripIso,
      areaHint: best.bundle.areaHint ?? item?.areaHint ?? null,
      finalScore: best.scored.score,
      confidence: preUniquenessConfidence,
      timestampScore: best.scored.components.timestampScore,
      durationScore: best.scored.components.durationScore,
      distanceScore: best.scored.components.distanceScore,
      areaScore: best.scored.components.areaScore,
      rawSignalScore: best.scored.components.rawSignalScore,
      uniquenessAdjustment: 0,
      downgradeReason: null,
      notes: [...best.scored.reasons],
    };
    const histogramBucket = getHistogramBucket(best.scored.score);
    metrics.scoreHistogram[histogramBucket] =
      (metrics.scoreHistogram[histogramBucket] ?? 0) + 1;
    if (best.scored.score < 5) {
      metrics.promotionBlockers.belowLikelyThreshold += 1;
    }
    if (best.scored.score < 8) {
      metrics.promotionBlockers.belowHighThreshold += 1;
    }
    if (best.scored.derived.tripDuration == null || best.scored.derived.segmentDuration == null) {
      metrics.promotionBlockers.missingDurationData += 1;
    }
    if (best.scored.derived.tripDistance == null || best.scored.derived.segmentDistance == null) {
      metrics.promotionBlockers.missingDistanceData += 1;
    }
    if (best.scored.components.areaScore <= 0) {
      metrics.promotionBlockers.weakAreaSupport += 1;
    }
    if (best.bundle.rawSignalSupport < 2) {
      metrics.promotionBlockers.weakRawSignalSupport += 1;
    }
    if (usedBundleKeys.has(bundleKey)) {
      metrics.duplicatesRejected += 1;
      sample.notes.push("duplicate_bundle_reused");
      sample.downgradeReason = "duplicate_bundle_reused";
      if (scoredSamples.length < 20) {
        scoredSamples.push(sample);
      }
      continue;
    }

    let confidence = toConfidence(best.scored.score);
    if ((confidence === "high" || confidence === "likely") && margin < 2) {
      confidence = "review";
      metrics.nonUniqueRejected += 1;
      metrics.promotionBlockers.downgradedByUniquenessMargin += 1;
      best.scored.components.uniquenessAdjustment = -1;
      sample.uniquenessAdjustment = -1;
      sample.downgradeReason = "downgraded_by_uniqueness_margin";
      sample.notes.push("non_unique_margin");
    }
    sample.confidence = confidence;
    if (scoredSamples.length < 20) {
      scoredSamples.push(sample);
    }

    if (confidence === "weak") {
      metrics.keptReviewCount += 1;
      continue;
    }
    if (confidence === "high") {
      metrics.promotedHighCount += 1;
    } else if (confidence === "likely") {
      metrics.promotedLikelyCount += 1;
    } else {
      metrics.keptReviewCount += 1;
    }
    if (best.bundle.rawSignalSupport > 0) {
      metrics.scoringInputCounts.matchesWithRawSignalSupport += 1;
    }
    if (best.scored.components.areaScore !== 0) {
      metrics.scoringInputCounts.matchesWithAreaScoreNonZero += 1;
    }
    if (best.scored.components.durationScore !== 0) {
      metrics.scoringInputCounts.matchesWithDurationScoreNonZero += 1;
    }
    if (best.scored.components.distanceScore !== 0) {
      metrics.scoringInputCounts.matchesWithDistanceScoreNonZero += 1;
    }

    usedBundleKeys.add(bundleKey);
    const scored = scoreTimelineCandidate(tripMs, best.bundle.segment);
    if (!scored) {
      continue;
    }
    const bestSegment = best.bundle.segment;
    inferred.push({
      linkedTripId: `${importId}:${tripIso}:timeline`,
      sourceImportId: importId,
      source: "google_timeline_inferred",
      matchMethod: "timeline-inferred",
      geoSource: "google_timeline_inferred",
      confidence,
      reason: "Historical correlation from timeline journey bundle",
      tripRequestTimestamp: tripIso,
      areaHint: best.bundle.areaHint ?? item?.areaHint ?? null,
      linkedEarnings:
        item?.estimatedEarnings ??
        item?.topCandidates?.suggestedFinancialTotal ??
        null,
      timelineSegment: {
        segmentType: bestSegment.segmentType,
        startTime: bestSegment.startTime,
        endTime: bestSegment.endTime,
        startLat: bestSegment.startLat,
        startLng: bestSegment.startLng,
        endLat: bestSegment.endLat,
        endLng: bestSegment.endLng,
        semanticType: bestSegment.semanticType,
      },
      scoring: {
        timestampProximityMs: scored.nearestMs,
        durationSeconds: scored.durationSec,
        score: best.scored.score,
        finalScore: best.scored.score,
        timestampScore: best.scored.components.timestampScore,
        durationScore: best.scored.components.durationScore,
        distanceScore: best.scored.components.distanceScore,
        areaScore: best.scored.components.areaScore,
        rawSignalScore: best.scored.components.rawSignalScore,
        uniquenessAdjustment: best.scored.components.uniquenessAdjustment,
        downgradeReason: sample.downgradeReason,
      },
      journeyBundle: {
        hasPreviousVisit: Boolean(best.bundle.prevVisit),
        hasFollowingVisit: Boolean(best.bundle.nextVisit),
        rawSignalSupport: best.bundle.rawSignalSupport,
        uniquenessMargin: margin,
      },
    });
  }

  return { inferred, metrics, scoredSamples };
}

module.exports = {
  parseTimelineFileChunked,
  buildTimelineIndex,
  buildRawSignalIndex,
  correlateHistoricalTripsWithTimeline,
};
