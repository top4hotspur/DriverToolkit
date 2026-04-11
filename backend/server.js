const express = require("express");
const cors = require("cors");
const fs = require("fs");
const os = require("os");
const path = require("path");
const multer = require("multer");
const { pipeline } = require("stream/promises");
const AdmZip = require("adm-zip");
const { getCoverageTier } = require("./coverageTier");
const {
  recomputeCoverageSummary,
  splitReviewSuggestions,
} = require("./manualReconciliation");
const {
  buildTimelineIndex,
  buildRawSignalIndex,
  parseTimelineFileChunked,
} = require("./timelineBackfill");
const { isTimelineRawUploadRequest } = require("./timelineUploadRoute");
const { createTranslinkRailService } = require("./translinkRail");
const { createSmartDiarySignalEngine } = require("./smartDiaryEngine");
const { createSignalPlatform } = require("./signalPlatform");
const { createSignalAdminConfig } = require("./signalAdminConfig");
const { createTranslinkSignalProvider } = require("./providers/translinkSignalProvider");
const { createSportsDbSignalProvider } = require("./providers/sportsDbSignalProvider");
const { createTicketmasterSignalProvider } = require("./providers/ticketmasterSignalProvider");
const { createEarningsOcrService } = require("./earningsOcr");
const { createReceiptOcrService } = require("./receiptOcr");
const { createEarningsImportBatchManager } = require("./earningsImportBatches");

const app = express();
app.use(cors());
const jsonParser = express.json({ limit: "50mb" });
const urlEncodedParser = express.urlencoded({ limit: "50mb", extended: true });
app.use((req, res, next) => {
  if (isTimelineRawUploadRequest(req)) {
    return next();
  }
  return jsonParser(req, res, next);
});
app.use((req, res, next) => {
  if (isTimelineRawUploadRequest(req)) {
    return next();
  }
  return urlEncodedParser(req, res, next);
});

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const SAMPLE_LAN_IPV4 = detectLanIpv4();
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  `http://${SAMPLE_LAN_IPV4 || "127.0.0.1"}:${PORT}`;
const SERVER_VERSION = "trip_backbone_v2_timelinePath_expanded";
const SIGNAL_BACKEND_MARKER = `signals-v1|${SERVER_VERSION}|cache=v4`;
const EARNINGS_OCR_ROUTE = "/api/earnings/parse-screenshots";
const EARNINGS_OCR_MARKER = `earnings-ocr-v1|${SERVER_VERSION}`;
const EARNINGS_BATCH_MARKER = `earnings-batch-v1|${SERVER_VERSION}`;
const PRODUCT_FEATURE_FLAGS = {
  uploads: false,
  heatmap: false,
  pricingAnalysis: false,
  smartDiary: true,
  translinkSignals: true,
};
const SERVER_STARTED_AT = nowIso();
const uploadsDir = path.join(__dirname, "uploads");
const storageDir = path.join(uploadsDir, "storage");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

const imports = new Map();
const timelineImports = new Map();
const translinkRail = createTranslinkRailService({ uploadsDir });
const smartDiaryEngine = createSmartDiarySignalEngine({
  uploadsDir,
  translinkRail,
});
const signalAdminConfig = createSignalAdminConfig({
  uploadsDir,
});
const translinkSignalProvider = createTranslinkSignalProvider({
  translinkRail,
  adminConfig: signalAdminConfig,
});
const sportsSignalProvider = createSportsDbSignalProvider({
  adminConfig: signalAdminConfig,
});
const ticketmasterSignalProvider = createTicketmasterSignalProvider({
  adminConfig: signalAdminConfig,
});
const signalPlatform = createSignalPlatform({
  translinkProvider: translinkSignalProvider,
  sportsProvider: sportsSignalProvider,
  ticketmasterProvider: ticketmasterSignalProvider,
  adminConfig: signalAdminConfig,
});
const earningsOcrService = createEarningsOcrService();
const receiptOcrService = createReceiptOcrService();
const earningsImportBatchManager = createEarningsImportBatchManager({
  uploadsDir,
  earningsOcrService,
});
const earningsUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 10,
  },
});
const earningsBatchUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 200,
  },
});

process.on("uncaughtException", (error) => {
  console.error(
    `[SERVER][uncaughtException] message=${error instanceof Error ? error.message : "unknown"}`,
  );
  if (error instanceof Error && error.stack) {
    console.error(`[SERVER][uncaughtException][stack] ${error.stack}`);
  }
});

process.on("unhandledRejection", (reason) => {
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : JSON.stringify(reason);
  console.error(`[SERVER][unhandledRejection] message=${message}`);
  if (reason instanceof Error && reason.stack) {
    console.error(`[SERVER][unhandledRejection][stack] ${reason.stack}`);
  }
});

process.on("SIGINT", () => {
  console.log("[SERVER][signal] SIGINT");
});

process.on("SIGTERM", () => {
  console.log("[SERVER][signal] SIGTERM");
});

process.on("exit", (code) => {
  console.log(`[SERVER][exit] code=${code}`);
});

function nowIso() {
  return new Date().toISOString();
}

function detectLanIpv4() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (
        entry &&
        entry.family === "IPv4" &&
        entry.internal === false &&
        typeof entry.address === "string" &&
        entry.address.trim().length > 0
      ) {
        return entry.address;
      }
    }
  }
  return null;
}

function featureDisabledResponse(res, feature, reason) {
  return res.status(410).json({
    ok: false,
    error: "feature_disabled_v1",
    feature,
    reason,
  });
}

function requireFeatureEnabled(feature, reason) {
  return (req, res, next) => {
    if (PRODUCT_FEATURE_FLAGS[feature] === true) {
      return next();
    }
    return featureDisabledResponse(res, feature, reason);
  };
}

function sanitizeStorageSegment(value) {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function resolveStoragePathForFileKey(fileKey) {
  const normalized = String(fileKey ?? "").replace(/\\/g, "/");
  const resolved = path.resolve(storageDir, normalized);
  const storageRoot = path.resolve(storageDir);
  if (!resolved.startsWith(storageRoot)) {
    return null;
  }
  return resolved;
}

function buildTimelineStatusPayload(record) {
  const confidenceCounts =
    record.summary?.inferredSummary?.byConfidence ?? {
      high: 0,
      likely: 0,
      review: 0,
      weak: 0,
    };
  return {
    timelineImportId: record.timelineImportId,
    importId: record.importId ?? null,
    stage: record.stage,
    progressPercent: record.progressPercent,
    fileKey: record.fileKey ?? null,
    summary: record.summary
      ? {
          segmentCount: record.summary.segmentsCount ?? 0,
          inferredCount: record.summary.inferredMatchesCount ?? 0,
          parserMode: record.summary?.parserDiagnostics?.mode ?? null,
          emittedBySubtype:
            record.summary?.parserDiagnostics?.emittedBySubtype ?? null,
          confidenceCounts,
          candidateStats: record.summary?.historicalCandidateStats ?? null,
        }
      : null,
    segmentCount: record.summary?.segmentsCount ?? 0,
    inferredCount: record.summary?.inferredMatchesCount ?? 0,
    parserMode: record.summary?.parserDiagnostics?.mode ?? null,
    emittedBySubtype: record.summary?.parserDiagnostics?.emittedBySubtype ?? null,
    confidenceCounts,
    candidatesConsidered: record.summary?.historicalCandidateStats?.candidatesConsidered ?? 0,
    candidatesOutsideAnalyticsWindow:
      record.summary?.historicalCandidateStats?.candidatesOutsideAnalyticsWindow ?? 0,
    candidatesAlreadyCovered:
      record.summary?.historicalCandidateStats?.candidatesAlreadyCovered ?? 0,
    candidatesMatchedByTimeline:
      record.summary?.historicalCandidateStats?.candidatesMatchedByTimeline ?? 0,
    timelineCandidatesFound:
      record.summary?.historicalCandidateStats?.timelineCandidatesFound ?? 0,
    usableHistoricalMatches:
      record.summary?.historicalCandidateStats?.usableHistoricalMatches ?? 0,
    candidatesInsideAnalyticsWindow:
      record.summary?.historicalCandidateStats?.candidatesInsideAnalyticsWindow ?? 0,
    candidatesEligibleForTimeline:
      record.summary?.historicalCandidateStats?.candidatesEligibleForTimeline ?? 0,
    promotedHighCount:
      record.summary?.historicalCandidateStats?.promotedHighCount ?? 0,
    promotedLikelyCount:
      record.summary?.historicalCandidateStats?.promotedLikelyCount ?? 0,
    keptReviewCount:
      record.summary?.historicalCandidateStats?.keptReviewCount ?? 0,
    duplicatesRejected:
      record.summary?.historicalCandidateStats?.duplicatesRejected ?? 0,
    poorDistanceFitRejected:
      record.summary?.historicalCandidateStats?.poorDistanceFitRejected ?? 0,
    poorDurationFitRejected:
      record.summary?.historicalCandidateStats?.poorDurationFitRejected ?? 0,
    nonUniqueRejected:
      record.summary?.historicalCandidateStats?.nonUniqueRejected ?? 0,
    scoreHistogram:
      record.summary?.historicalCandidateStats?.scoreHistogram ?? null,
    promotionBlockers:
      record.summary?.historicalCandidateStats?.promotionBlockers ?? null,
    scoringPathDiagnostics:
      record.summary?.historicalCandidateStats?.scoringPathDiagnostics ?? null,
    scoredSampleMatches:
      record.summary?.historicalCandidateStats?.scoredSampleMatches ?? [],
    candidatesWithDuration:
      record.summary?.historicalCandidateStats?.candidatesWithDuration ?? 0,
    candidatesWithDistance:
      record.summary?.historicalCandidateStats?.candidatesWithDistance ?? 0,
    candidatesWithAreaHint:
      record.summary?.historicalCandidateStats?.candidatesWithAreaHint ?? 0,
    totalTripsParsed:
      record.summary?.historicalCandidateStats?.totalTripsParsed ?? 0,
    totalPaymentGroupsParsed:
      record.summary?.historicalCandidateStats?.totalPaymentGroupsParsed ?? 0,
    tripsWithUuid:
      record.summary?.historicalCandidateStats?.tripsWithUuid ?? 0,
    paymentGroupsWithUuid:
      record.summary?.historicalCandidateStats?.paymentGroupsWithUuid ?? 0,
    joinedTripPaymentCandidates:
      record.summary?.historicalCandidateStats?.joinedTripPaymentCandidates ?? 0,
    paymentOnlyCandidates:
      record.summary?.historicalCandidateStats?.paymentOnlyCandidates ?? 0,
    tripOnlyCandidates:
      record.summary?.historicalCandidateStats?.tripOnlyCandidates ?? 0,
    joinFailureReasons:
      record.summary?.historicalCandidateStats?.joinFailureReasons ?? {},
    sampleCandidates:
      record.summary?.historicalCandidateStats?.sampleCandidates ?? [],
    matchesWithRawSignalSupport:
      record.summary?.historicalCandidateStats?.matchesWithRawSignalSupport ?? 0,
    matchesWithAreaScoreNonZero:
      record.summary?.historicalCandidateStats?.matchesWithAreaScoreNonZero ?? 0,
    matchesWithDurationScoreNonZero:
      record.summary?.historicalCandidateStats?.matchesWithDurationScoreNonZero ?? 0,
    matchesWithDistanceScoreNonZero:
      record.summary?.historicalCandidateStats?.matchesWithDistanceScoreNonZero ?? 0,
    rawSignalPointsIndexed:
      record.summary?.historicalCandidateStats?.rawSignalPointsIndexed ?? 0,
    rawSignalIndexedSample:
      record.summary?.historicalCandidateStats?.rawSignalIndexedSample ?? [],
    rawSignalSupportInsight:
      record.summary?.historicalCandidateStats?.rawSignalSupportInsight ?? null,
    inferredByMonth: record.summary?.inferredSummary?.byMonth ?? [],
    inferredSample: record.summary?.inferredSummary?.sampleInferred ?? [],
    errorMessage: record.error ?? null,
    updatedAt: record.updatedAt ?? nowIso(),
  };
}

function getMonthBucket(iso) {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}`;
}

function getDateBucket(iso) {
  return getMonthBucket(iso);
}

function makeDateBucketKey(day, hour) {
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const safeDay = dayLabels.includes(day) ? day : "Sun";
  const safeHour = Number.isFinite(Number(hour))
    ? Math.max(0, Math.min(23, Math.floor(Number(hour))))
    : 0;
  return `${safeDay}-${String(safeHour).padStart(2, "0")}`;
}

function confidenceToScore(confidence) {
  if (confidence === "high") {
    return 4;
  }
  if (confidence === "likely") {
    return 3;
  }
  if (confidence === "review") {
    return 2;
  }
  return 1;
}

function scoreToConfidenceLabel(score) {
  if (score >= 3.5) {
    return "high";
  }
  if (score >= 2.5) {
    return "likely";
  }
  if (score >= 1.5) {
    return "review";
  }
  return "weak";
}

function buildTimelineInferenceSummary(inferredMatches) {
  const safe = Array.isArray(inferredMatches) ? inferredMatches : [];
  const byConfidence = {
    high: 0,
    likely: 0,
    review: 0,
    weak: 0,
  };
  const monthMap = new Map();

  for (const match of safe) {
    const confidence = match?.confidence ?? "weak";
    if (confidence in byConfidence) {
      byConfidence[confidence] += 1;
    } else {
      byConfidence.weak += 1;
    }
    const month = getMonthBucket(match?.tripRequestTimestamp);
    if (!month) {
      continue;
    }
    const monthEntry = monthMap.get(month) ?? {
      month,
      count: 0,
      confidenceScoreTotal: 0,
      totalMatchedEarnings: 0,
      areaLabels: new Set(),
    };
    monthEntry.count += 1;
    monthEntry.confidenceScoreTotal += confidenceToScore(confidence);
    const linkedEarnings = Number(match?.linkedEarnings ?? 0);
    if (!Number.isNaN(linkedEarnings)) {
      monthEntry.totalMatchedEarnings += linkedEarnings;
    }
    if (match?.areaHint) {
      monthEntry.areaLabels.add(String(match.areaHint));
    }
    monthMap.set(month, monthEntry);
  }

  const byMonth = Array.from(monthMap.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((entry) => {
      const avgScore = entry.count > 0 ? entry.confidenceScoreTotal / entry.count : 0;
      return {
        month: entry.month,
        count: entry.count,
        averageConfidence: scoreToConfidenceLabel(avgScore),
        totalMatchedEarnings: Math.round(entry.totalMatchedEarnings * 100) / 100,
        uniqueAreaLabelsCount: entry.areaLabels.size,
      };
    });

  return {
    inferredCount: safe.length,
    byConfidence,
    byMonth,
    sampleInferred: safe.slice(0, 10),
  };
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
  const rows = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const ch = csvText[i];
    const next = csvText[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '""';
        i += 1;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") {
        i += 1;
      }
      rows.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    rows.push(current);
  }

  if (rows.length === 0) {
    return { headers: [], rowCount: 0, sampleRows: [], dataRows: [] };
  }

  const headerValues = parseCsvLine(rows[0]).map((value) =>
    String(value ?? "").trim().replace(/^\uFEFF/, "")
  );
  const dataRows = [];

  for (let i = 1; i < rows.length; i += 1) {
    const rawLine = rows[i];
    if (!rawLine || rawLine.trim().length === 0) {
      continue;
    }
    const values = parseCsvLine(rawLine);
    const row = {};
    for (let j = 0; j < headerValues.length; j += 1) {
      row[headerValues[j]] = (values[j] ?? "").trim();
    }
    dataRows.push(row);
  }

  return {
    headers: headerValues,
    rowCount: dataRows.length,
    sampleRows: dataRows.slice(0, 3),
    dataRows,
  };
}

function parseDateValue(value) {
  if (value == null) {
    return null;
  }
  const trimmed = String(value).trim().replace(/^"|"$/g, "");
  if (!trimmed) {
    return null;
  }

  const direct = Date.parse(trimmed);
  if (!Number.isNaN(direct)) {
    return new Date(direct);
  }

  const normalized = trimmed.includes(" ")
    ? trimmed.replace(" ", "T")
    : trimmed;
  const normalizedParse = Date.parse(normalized);
  if (!Number.isNaN(normalizedParse)) {
    return new Date(normalizedParse);
  }

  return null;
}

function normalizeTimestampKey(value) {
  const parsed = parseDateValue(value);
  if (!parsed) {
    return null;
  }
  return `${parsed.toISOString().slice(0, 19)}Z`;
}

function resolveFieldByAliases(headers, aliases) {
  const normalizedToRaw = new Map(
    headers.map((header) => [normalizeHeader(header), header])
  );

  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    if (normalizedToRaw.has(normalizedAlias)) {
      return normalizedToRaw.get(normalizedAlias);
    }
  }

  return null;
}

function resolveTimestampField(headers, preferredField, additionalAliases = []) {
  return resolveFieldByAliases(headers, [preferredField, ...additionalAliases]);
}

function computeDateRange(rows, timestampField) {
  if (!timestampField) {
    return null;
  }

  let minMs = null;
  let maxMs = null;

  for (const row of rows) {
    const parsed = parseDateValue(row[timestampField]);
    if (!parsed) {
      continue;
    }
    const ts = parsed.getTime();
    if (minMs == null || ts < minMs) {
      minMs = ts;
    }
    if (maxMs == null || ts > maxMs) {
      maxMs = ts;
    }
  }

  if (minMs == null || maxMs == null) {
    return null;
  }

  return {
    startAt: new Date(minMs).toISOString(),
    endAt: new Date(maxMs).toISOString(),
  };
}

function normalizeUuid(value) {
  if (value == null) {
    return null;
  }
  const cleaned = String(value).trim().replace(/^"|"$/g, "").toLowerCase();
  if (!cleaned) {
    return null;
  }
  return cleaned;
}

function isWithinRange(timestampMs, range) {
  if (!range || typeof timestampMs !== "number") {
    return false;
  }
  const startMs = Date.parse(range.startAt ?? "");
  const endMs = Date.parse(range.endAt ?? "");
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return false;
  }
  return timestampMs >= startMs && timestampMs <= endMs;
}

function inferAreaLabelFromCoords(latitude, longitude) {
  if (latitude == null || longitude == null) {
    return "Local area";
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return "Local area";
  }

  // Lightweight Northern Ireland hub buckets for UX-friendly labels.
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
}

function mapCityNameToAreaLabel(value) {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  const lower = normalized.toLowerCase();
  if (lower.includes("belfast")) {
    return "Belfast area";
  }
  if (lower.includes("bangor")) {
    return "Bangor area";
  }
  return normalized;
}

function buildPaymentGroupsByTripUuid(paymentRows, paymentUuidField, paymentTimestampField) {
  const groups = new Map();
  for (const row of paymentRows) {
    const uuid = normalizeUuid(row[paymentUuidField]);
    if (!uuid) {
      continue;
    }
    const amountRaw = getRowValueByAliases(row, ["local_amount", "amount"]);
    const amount = Number.parseFloat(String(amountRaw ?? "0"));
    const timestampParsed = parseDateValue(row[paymentTimestampField]);
    const entry = groups.get(uuid) ?? {
      tripUuid: uuid,
      rows: [],
      timestampMs: null,
      timestampIso: null,
      financialTotal: 0,
      cityName: null,
    };
    entry.rows.push(row);
    if (!Number.isNaN(amount)) {
      entry.financialTotal += amount;
    }
    if (timestampParsed) {
      const currentMs = timestampParsed.getTime();
      if (entry.timestampMs == null || currentMs < entry.timestampMs) {
        entry.timestampMs = currentMs;
        entry.timestampIso = timestampParsed.toISOString();
      }
    }
    if (!entry.cityName) {
      const city = getRowValueByAliases(row, ["city_name", "city name", "city"]);
      if (city != null && String(city).trim()) {
        entry.cityName = String(city).trim();
      }
    }
    groups.set(uuid, entry);
  }
  return Array.from(groups.values());
}

function findNearestAnalyticsEvent(analyticsRowsSorted, targetMs, toleranceMs) {
  if (!Array.isArray(analyticsRowsSorted) || analyticsRowsSorted.length === 0) {
    return null;
  }

  let lo = 0;
  let hi = analyticsRowsSorted.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (analyticsRowsSorted[mid].eventMs < targetMs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  const candidates = [];
  if (analyticsRowsSorted[lo]) {
    candidates.push(analyticsRowsSorted[lo]);
  }
  if (analyticsRowsSorted[lo - 1]) {
    candidates.push(analyticsRowsSorted[lo - 1]);
  }
  if (analyticsRowsSorted[lo + 1]) {
    candidates.push(analyticsRowsSorted[lo + 1]);
  }

  let nearest = null;
  let nearestDiff = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const diff = Math.abs(candidate.eventMs - targetMs);
    if (diff < nearestDiff) {
      nearest = candidate;
      nearestDiff = diff;
    }
  }

  if (!nearest || nearestDiff > toleranceMs) {
    return null;
  }

  return {
    event: nearest,
    diffMs: nearestDiff,
  };
}

function getRowValueByAliases(row, aliases) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const keys = Object.keys(row);
  const normalized = new Map(keys.map((key) => [normalizeHeader(key), key]));
  for (const alias of aliases) {
    const rawKey = normalized.get(normalizeHeader(alias));
    if (rawKey != null) {
      return row[rawKey];
    }
  }
  return null;
}

function getNumericRowValue(row, aliases) {
  const raw = getRowValueByAliases(row, aliases);
  const numeric = Number.parseFloat(String(raw ?? ""));
  return Number.isNaN(numeric) ? null : numeric;
}

function getBooleanRowValue(row, aliases) {
  const raw = getRowValueByAliases(row, aliases);
  if (raw == null) {
    return null;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n"].includes(normalized)) {
    return false;
  }
  return null;
}

function parseDurationSecondsValue(value) {
  if (value == null) {
    return null;
  }
  const raw = String(value).trim().replace(/^"|"$/g, "");
  if (!raw) {
    return null;
  }
  const asNumber = Number.parseFloat(raw);
  if (!Number.isNaN(asNumber)) {
    if (asNumber > 0 && asNumber < 24 * 60 * 60) {
      return Math.round(asNumber);
    }
    if (asNumber >= 24 * 60 * 60) {
      // Sometimes export duration can be milliseconds.
      return Math.round(asNumber / 1000);
    }
  }
  const isoMatch = raw.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (isoMatch) {
    const h = Number.parseInt(isoMatch[1] ?? "0", 10) || 0;
    const m = Number.parseInt(isoMatch[2] ?? "0", 10) || 0;
    const s = Number.parseInt(isoMatch[3] ?? "0", 10) || 0;
    return h * 3600 + m * 60 + s;
  }
  const parts = raw.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.length === 2 && parts.every((part) => Number.isFinite(part))) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return null;
}

function parseDistanceMilesValue(value) {
  if (value == null) {
    return null;
  }
  const raw = String(value).trim().replace(/^"|"$/g, "");
  if (!raw) {
    return null;
  }
  const normalized = raw.toLowerCase();
  const numeric = Number.parseFloat(normalized.replace(/[^0-9.+-]/g, ""));
  if (Number.isNaN(numeric)) {
    return null;
  }
  if (normalized.includes("km")) {
    return numeric * 0.621371;
  }
  if (normalized.includes("meter") || normalized.includes(" m")) {
    return numeric / 1609.34;
  }
  return numeric;
}

function deriveUkOutwardCode(value) {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim().toUpperCase().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }
  if (normalized.includes(" ")) {
    const outward = normalized.split(" ")[0].trim();
    return outward || null;
  }
  const compact = normalized.replace(/\s+/g, "");
  if (compact.length < 3) {
    return null;
  }
  const withInward = compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/);
  if (withInward) {
    return withInward[1];
  }
  const outwardOnly = compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)$/);
  if (outwardOnly) {
    return outwardOnly[1];
  }
  return null;
}

function resolveAreaHintFromTripRow(tripRow, mapping) {
  if (!tripRow || typeof tripRow !== "object") {
    return null;
  }
  const directAreaValue =
    (mapping.pickupAreaField ? tripRow[mapping.pickupAreaField] : null) ??
    (mapping.dropoffAreaField ? tripRow[mapping.dropoffAreaField] : null) ??
    getRowValueByAliases(tripRow, [
      "pickup_postcode",
      "pickup_area",
      "pickup_zone",
      "pickup_city",
      "pickup_location",
      "pickup_address",
      "dropoff_postcode",
      "dropoff_area",
      "dropoff_zone",
      "dropoff_city",
      "dropoff_location",
      "dropoff_address",
      "start_location",
      "end_location",
      "city",
      "town",
      "area",
    ]);
  const outward = deriveUkOutwardCode(directAreaValue);
  if (outward) {
    return `${outward} area`;
  }
  if (directAreaValue != null && String(directAreaValue).trim()) {
    return String(directAreaValue).trim();
  }
  return null;
}

function computeTimestampFallbackMatchingSummary(
  tripRows,
  paymentRows,
  tripTimestampField,
  paymentTimestampField
) {
  const safeTripRows = Array.isArray(tripRows) ? tripRows : [];
  const safePaymentRows = Array.isArray(paymentRows) ? paymentRows : [];
  const tripsByTimestamp = new Map();
  const paymentsByTimestamp = new Map();
  let validTripTimestamps = 0;
  let validPaymentTimestamps = 0;

  for (const tripRow of safeTripRows) {
    const key = normalizeTimestampKey(tripRow[tripTimestampField]);
    if (!key) {
      continue;
    }
    validTripTimestamps += 1;
    const list = tripsByTimestamp.get(key) ?? [];
    list.push(tripRow);
    tripsByTimestamp.set(key, list);
  }

  for (const paymentRow of safePaymentRows) {
    const key = normalizeTimestampKey(paymentRow[paymentTimestampField]);
    if (!key) {
      continue;
    }
    validPaymentTimestamps += 1;
    const list = paymentsByTimestamp.get(key) ?? [];
    list.push(paymentRow);
    paymentsByTimestamp.set(key, list);
  }

  let matchedTrips = 0;
  let unmatchedTrips = 0;
  let ambiguousMatches = 0;
  const usedPaymentGroupKeys = new Set();

  for (const [timestampKey, tripGroup] of tripsByTimestamp.entries()) {
    const paymentGroup = paymentsByTimestamp.get(timestampKey);
    const tripCount = tripGroup.length;

    if (!paymentGroup || paymentGroup.length === 0) {
      unmatchedTrips += tripCount;
      continue;
    }

    if (paymentGroup.length === 1) {
      matchedTrips += 1;
      usedPaymentGroupKeys.add(timestampKey);
      if (tripCount > 1) {
        ambiguousMatches += tripCount - 1;
      }
      continue;
    }

    ambiguousMatches += tripCount;
  }

  let unmatchedPayments = 0;
  for (const [timestampKey] of paymentsByTimestamp.entries()) {
    if (!usedPaymentGroupKeys.has(timestampKey)) {
      unmatchedPayments += 1;
    }
  }

  return {
    matchingMode: "timestamp-fallback",
    matchedTrips,
    unmatchedTrips,
    unmatchedPayments,
    ambiguousMatches,
    diagnostics: {
      tripsConsidered: safeTripRows.length,
      paymentsConsidered: safePaymentRows.length,
      validTripTimestamps,
      validPaymentTimestamps,
      uniqueTripTimestamps: tripsByTimestamp.size,
      uniquePaymentTimestamps: paymentsByTimestamp.size,
      uuidMatchedTrips: 0,
      uuidMissingTrips: safeTripRows.length,
      tripUuidFieldUsed: null,
      paymentUuidFieldUsed: null,
    },
  };
}

function computeFirstPassMatchingSummary(
  importId,
  tripRows,
  paymentRows,
  tripTimestampField,
  paymentTimestampField,
  analyticsRows,
  analyticsTimestampField,
  tripHeaders,
  paymentHeaders
) {
  const safeTripRows = Array.isArray(tripRows) ? tripRows : [];
  const safePaymentRows = Array.isArray(paymentRows) ? paymentRows : [];
  const paymentUuidField = resolveFieldByAliases(paymentHeaders ?? [], [
    "trip_uuid",
    "trip uuid",
    "uuid",
    "trip_id",
    "trip id",
  ]);

  const analyticsEvents = (Array.isArray(analyticsRows) ? analyticsRows : [])
    .map((row) => {
      const eventDate = parseDateValue(
        analyticsTimestampField ? row[analyticsTimestampField] : null
      );
      if (!eventDate) {
        return null;
      }
      return {
        raw: row,
        eventMs: eventDate.getTime(),
        eventIso: eventDate.toISOString(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.eventMs - b.eventMs);

  const analyticsCoverageRange =
    analyticsEvents.length > 0
      ? {
          startAt: analyticsEvents[0].eventIso,
          endAt: analyticsEvents[analyticsEvents.length - 1].eventIso,
        }
      : null;

  if (!paymentUuidField || !tripTimestampField || !paymentTimestampField) {
    const fallback = computeTimestampFallbackMatchingSummary(
      safeTripRows,
      safePaymentRows,
      tripTimestampField,
      paymentTimestampField
    );
    return {
      ...fallback,
      analyticsCoverageRange,
      geoLinkedTrips: 0,
      geoEligibleTrips: 0,
      notGeoEligibleTrips: safeTripRows.length,
      groupedTripsMatchedToPayments: 0,
      unmatchedTripsInWindow: 0,
      unmatchedPaymentGroupsInWindow: 0,
      eligibleEarningsTotal: 0,
      linkedEarningsTotal: 0,
      earningsCoveragePercent: 0,
      earningsCoverageTier: "Needs review",
      sequenceQuickWinsCount: 0,
      reviewSuggestions: [],
      coverageSuggestions: [],
      historySuggestions: [],
      sequenceSuggestions: [],
      toleranceUsedSeconds: 60,
      geoLinkedDataset: [],
      diagnostics: {
        ...fallback.diagnostics,
        tripUuidFieldUsed: null,
        paymentUuidFieldUsed: paymentUuidField,
        tripsInAnalyticsWindow: 0,
        paymentGroupsInAnalyticsWindow: 0,
        groupedTripsMatchedToPayments: 0,
      },
    };
  }

  const paymentGroups = buildPaymentGroupsByTripUuid(
    safePaymentRows,
    paymentUuidField,
    paymentTimestampField
  );
  const validPaymentUuidRows = paymentGroups.reduce(
    (sum, group) => sum + group.rows.length,
    0
  );

  const tripsWithTs = safeTripRows
    .map((tripRow) => {
      const parsed = parseDateValue(
        tripTimestampField ? tripRow[tripTimestampField] : null
      );
      return {
        row: tripRow,
        timestampMs: parsed ? parsed.getTime() : null,
        timestampIso: parsed ? parsed.toISOString() : null,
      };
    })
    .filter((entry) => entry.timestampMs != null);

  const tripsInAnalyticsWindow = tripsWithTs.filter((trip) =>
    isWithinRange(trip.timestampMs, analyticsCoverageRange)
  );
  const paymentGroupsInAnalyticsWindow = paymentGroups.filter((group) =>
    isWithinRange(group.timestampMs, analyticsCoverageRange)
  );

  const tripsByTimestamp = new Map();
  for (const trip of tripsInAnalyticsWindow) {
    const key = normalizeTimestampKey(trip.timestampIso);
    if (!key) {
      continue;
    }
    const group = tripsByTimestamp.get(key) ?? [];
    group.push(trip);
    tripsByTimestamp.set(key, group);
  }

  const paymentGroupsByTimestamp = new Map();
  for (const paymentGroup of paymentGroupsInAnalyticsWindow) {
    const key = normalizeTimestampKey(paymentGroup.timestampIso);
    if (!key) {
      continue;
    }
    const group = paymentGroupsByTimestamp.get(key) ?? [];
    group.push(paymentGroup);
    paymentGroupsByTimestamp.set(key, group);
  }

  let matchedTrips = 0;
  let unmatchedTrips = 0;
  let ambiguousMatches = 0;
  let unmatchedPayments = 0;
  const groupedMatchedPaymentKeys = new Set();
  const groupedMatches = [];
  const unmatchedTripCandidates = [];

  for (const [timestampKey, tripGroup] of tripsByTimestamp.entries()) {
    const paymentGroup = paymentGroupsByTimestamp.get(timestampKey);
    if (!paymentGroup || paymentGroup.length === 0) {
      unmatchedTrips += tripGroup.length;
      for (const trip of tripGroup) {
        unmatchedTripCandidates.push({ trip, reason: "no_payment_group_same_timestamp" });
      }
      continue;
    }
    if (tripGroup.length === 1 && paymentGroup.length === 1) {
      matchedTrips += 1;
      groupedMatchedPaymentKeys.add(timestampKey);
      groupedMatches.push({
        trip: tripGroup[0],
        paymentGroup: paymentGroup[0],
      });
      continue;
    }
    ambiguousMatches += Math.max(tripGroup.length, paymentGroup.length);
    for (const trip of tripGroup) {
      unmatchedTripCandidates.push({ trip, reason: "ambiguous_timestamp_group" });
    }
  }

  const unmatchedPaymentKeys = Array.from(paymentGroupsByTimestamp.keys()).filter(
    (key) => !groupedMatchedPaymentKeys.has(key)
  );
  unmatchedPayments = unmatchedPaymentKeys.length;
  const unmatchedPaymentGroups = unmatchedPaymentKeys.flatMap(
    (key) => paymentGroupsByTimestamp.get(key) ?? []
  );

  const toleranceMs = 60_000;
  const geoLinkedDataset = [];
  const reviewSuggestions = [];
  const usedAnalyticsEventIso = new Set();
  const usedUnmatchedPaymentUuids = new Set();

  const toCanonicalLinkedRecord = (args) => {
    const {
      tripEntry,
      paymentGroup,
      nearestAnalytics,
      matchMethod,
      sequenceSupport,
      previousConfirmedTripId,
      nextConfirmedTripId,
      candidateCountInInterval,
      autoAccepted,
    } = args;
    const requestTimestampIso = tripEntry.timestampIso;
    const beginTimestamp = parseDateValue(
      getRowValueByAliases(tripEntry.row, [
        "begintrip_timestamp_local",
        "begintrip_timestamp",
      ])
    );
    const dropoffTimestamp = parseDateValue(
      getRowValueByAliases(tripEntry.row, [
        "dropoff_timestamp_local",
        "dropoff_timestamp",
      ])
    );
    const paymentClassifications = Array.from(
      new Set(
        (paymentGroup?.rows ?? [])
          .map((row) =>
            getRowValueByAliases(row, ["classification", "classifications"])
          )
          .filter((value) => value != null)
          .map((value) => String(value))
      )
    );
    const paymentCategories = Array.from(
      new Set(
        (paymentGroup?.rows ?? [])
          .map((row) => getRowValueByAliases(row, ["category", "categories"]))
          .filter((value) => value != null)
          .map((value) => String(value))
      )
    );
    const diffMs = nearestAnalytics?.diffMs ?? Number.POSITIVE_INFINITY;
    const matchConfidence =
      diffMs <= 15_000 ? "high" : diffMs <= 45_000 ? "medium" : "review";

    return {
      linkedTripId: `${importId}:${requestTimestampIso ?? "unknown"}:${paymentGroup?.tripUuid ?? "no-uuid"}`,
      sourceImportId: importId,
      provider: "uber",
      matchMode: "payment_group_timestamp",
      matchMethod,
      geoSource: "uber_analytics",
      sequenceSupport,
      previousConfirmedTripId: previousConfirmedTripId ?? null,
      nextConfirmedTripId: nextConfirmedTripId ?? null,
      candidateCountInInterval,
      autoAccepted,
      matchConfidence,
      toleranceUsedSeconds: 60,
      geoEligible: true,
      geoEligibilityReason: "inside_analytics_window",
      locationLinked: true,
      trip: {
        requestTimestamp: requestTimestampIso,
        beginTimestamp: beginTimestamp ? beginTimestamp.toISOString() : null,
        dropoffTimestamp: dropoffTimestamp ? dropoffTimestamp.toISOString() : null,
        status: getRowValueByAliases(tripEntry.row, ["status"]) ?? null,
        productName:
          getRowValueByAliases(tripEntry.row, ["product_name", "product"]) ?? null,
        distanceMiles: getNumericRowValue(tripEntry.row, [
          "trip_distance_miles",
          "distance_miles",
          "distance",
        ]),
        durationSeconds: getNumericRowValue(tripEntry.row, [
          "trip_duration_seconds",
          "duration_seconds",
          "duration",
        ]),
        currencyCode:
          getRowValueByAliases(tripEntry.row, ["currency_code", "currency"]) ?? null,
        vehicleUuid: getRowValueByAliases(tripEntry.row, ["vehicle_uuid"]) ?? null,
        licensePlate: getRowValueByAliases(tripEntry.row, ["license_plate"]) ?? null,
      },
      paymentGroup: {
        tripUuid: paymentGroup?.tripUuid ?? null,
        groupedTimestamp: paymentGroup?.timestampIso ?? null,
        currencyCode:
          getRowValueByAliases(paymentGroup?.rows?.[0] ?? null, [
            "currency_code",
            "currency",
          ]) ?? null,
        rowCount: paymentGroup?.rows?.length ?? 0,
        financialTotal:
          paymentGroup?.financialTotal == null
            ? null
            : Math.round(paymentGroup.financialTotal * 100) / 100,
        rawClassifications: paymentClassifications,
        rawCategories: paymentCategories,
      },
      analytics: {
        eventTimestamp: nearestAnalytics?.event?.eventIso ?? null,
        eventType: nearestAnalytics?.event?.raw
          ? getRowValueByAliases(nearestAnalytics.event.raw, [
              "analytics_event_type",
              "event_type",
            ])
          : null,
        latitude: nearestAnalytics?.event?.raw
          ? getNumericRowValue(nearestAnalytics.event.raw, ["latitude"])
          : null,
        longitude: nearestAnalytics?.event?.raw
          ? getNumericRowValue(nearestAnalytics.event.raw, ["longitude"])
          : null,
        speedGps: nearestAnalytics?.event?.raw
          ? getNumericRowValue(nearestAnalytics.event.raw, ["speed_gps", "speed"])
          : null,
        city: nearestAnalytics?.event?.raw
          ? getRowValueByAliases(nearestAnalytics.event.raw, ["city"])
          : null,
        driverOnline: nearestAnalytics?.event?.raw
          ? getBooleanRowValue(nearestAnalytics.event.raw, ["driver_online"])
          : null,
      },
      location: {
        lat: nearestAnalytics?.event?.raw
          ? getNumericRowValue(nearestAnalytics.event.raw, ["latitude"])
          : null,
        lng: nearestAnalytics?.event?.raw
          ? getNumericRowValue(nearestAnalytics.event.raw, ["longitude"])
          : null,
        source: "driver_app_analytics",
        resolvedAreaLabel: inferAreaLabelFromCoords(
          nearestAnalytics?.event?.raw
            ? getNumericRowValue(nearestAnalytics.event.raw, ["latitude"])
            : null,
          nearestAnalytics?.event?.raw
            ? getNumericRowValue(nearestAnalytics.event.raw, ["longitude"])
            : null
        ),
        locationConfidence:
          matchConfidence === "review" ? "low" : matchConfidence,
      },
      flags: {
        hasTrip: true,
        hasPaymentGroup: Boolean(paymentGroup),
        hasAnalytics: Boolean(nearestAnalytics),
        insideAnalyticsWindow: true,
        timestampAligned: true,
        requiresReview: matchConfidence === "review" || !autoAccepted,
      },
    };
  };

  for (const item of groupedMatches) {
    const nearest = findNearestAnalyticsEvent(
      analyticsEvents,
      item.trip.timestampMs,
      toleranceMs
    );
    if (!nearest) {
      unmatchedTripCandidates.push({
        trip: item.trip,
        reason: "no_nearby_analytics_event",
      });
      unmatchedTrips += 1;
      matchedTrips = Math.max(0, matchedTrips - 1);
      groupedMatchedPaymentKeys.delete(normalizeTimestampKey(item.paymentGroup.timestampIso));
      continue;
    }
    usedAnalyticsEventIso.add(nearest.event.eventIso);
    geoLinkedDataset.push(
      toCanonicalLinkedRecord({
        tripEntry: item.trip,
        paymentGroup: item.paymentGroup,
        nearestAnalytics: nearest,
        matchMethod: "direct-timestamp",
        sequenceSupport: false,
        previousConfirmedTripId: null,
        nextConfirmedTripId: null,
        candidateCountInInterval: 0,
        autoAccepted: true,
      })
    );
  }

  geoLinkedDataset.sort((a, b) =>
    String(a.trip.requestTimestamp).localeCompare(String(b.trip.requestTimestamp))
  );

  const confirmedForSequence = geoLinkedDataset
    .map((record) => ({
      linkedTripId: record.linkedTripId,
      tripTimestampMs: Date.parse(record.trip.requestTimestamp ?? ""),
    }))
    .filter((item) => !Number.isNaN(item.tripTimestampMs));

  const intervalMsLimit = 20 * 60 * 1000;
  const unresolvedTrips = unmatchedTripCandidates
    .map((item) => item.trip)
    .filter((trip) => trip?.timestampMs != null)
    .sort((a, b) => a.timestampMs - b.timestampMs);

  for (const trip of unresolvedTrips) {
    const previous = [...confirmedForSequence]
      .reverse()
      .find((item) => item.tripTimestampMs < trip.timestampMs);
    const next = confirmedForSequence.find(
      (item) => item.tripTimestampMs > trip.timestampMs
    );
    if (!previous || !next) {
      continue;
    }
    const intervalMs = next.tripTimestampMs - previous.tripTimestampMs;
    if (intervalMs <= 0 || intervalMs > intervalMsLimit) {
      continue;
    }

    const paymentCandidates = unmatchedPaymentGroups.filter((paymentGroup) => {
      if (usedUnmatchedPaymentUuids.has(paymentGroup.tripUuid)) {
        return false;
      }
      return (
        paymentGroup.timestampMs != null &&
        paymentGroup.timestampMs >= previous.tripTimestampMs &&
        paymentGroup.timestampMs <= next.tripTimestampMs
      );
    });
    const analyticsCandidates = analyticsEvents.filter((event) => {
      if (usedAnalyticsEventIso.has(event.eventIso)) {
        return false;
      }
      return (
        event.eventMs >= previous.tripTimestampMs &&
        event.eventMs <= next.tripTimestampMs
      );
    });

    const candidateCountInInterval =
      paymentCandidates.length + analyticsCandidates.length;
    const hasUniquePayment = paymentCandidates.length === 1;
    const hasUniqueAnalytics = analyticsCandidates.length === 1;
    const noCompetingCandidate =
      paymentCandidates.length <= 1 && analyticsCandidates.length <= 1;
    const sequenceSupport = hasUniquePayment || hasUniqueAnalytics;
    const timingFit = hasUniquePayment
      ? Math.abs((paymentCandidates[0].timestampMs ?? 0) - trip.timestampMs) <= 90_000
      : true;
    const autoAccepted =
      sequenceSupport &&
      hasUniquePayment &&
      hasUniqueAnalytics &&
      noCompetingCandidate &&
      timingFit;
    const suggestionConfidence =
      autoAccepted && timingFit ? "high" : sequenceSupport ? "medium" : "review";

    const previousRecord = geoLinkedDataset.find(
      (record) => record.linkedTripId === previous.linkedTripId
    );
    const nextRecord = geoLinkedDataset.find(
      (record) => record.linkedTripId === next.linkedTripId
    );
    const previousEarnings = Number(previousRecord?.paymentGroup?.financialTotal ?? 0);
    const nextEarnings = Number(nextRecord?.paymentGroup?.financialTotal ?? 0);
    const estimatedEarnings =
      Number.isFinite(previousEarnings) && Number.isFinite(nextEarnings)
        ? Math.round(((previousEarnings + nextEarnings) / 2) * 100) / 100
        : null;

    reviewSuggestions.push({
      linkedTripId: `${importId}:${trip.timestampIso ?? "unknown"}:sequence`,
      previousConfirmedTripId: previous.linkedTripId,
      nextConfirmedTripId: next.linkedTripId,
      reason: "Between two confirmed trips",
      hasPaymentCandidate: hasUniquePayment,
      hasLocationPath: hasUniqueAnalytics,
      candidateCountInInterval,
      paymentCandidateCount: paymentCandidates.length,
      analyticsCandidateCount: analyticsCandidates.length,
      autoAccepted,
      matchConfidence: suggestionConfidence,
      topCandidates: {
        paymentGroupTripUuid: hasUniquePayment
          ? paymentCandidates[0].tripUuid
          : null,
        paymentGroupedTimestamp: hasUniquePayment
          ? paymentCandidates[0].timestampIso
          : null,
        suggestedFinancialTotal: hasUniquePayment
          ? Math.round((paymentCandidates[0].financialTotal ?? 0) * 100) / 100
          : null,
        analyticsEventTimestamp: hasUniqueAnalytics
          ? analyticsCandidates[0].eventIso
          : null,
      },
      tripRequestTimestamp: trip.timestampIso,
      estimatedEarnings,
      previousConfirmedSummary: previousRecord
        ? {
            requestTimestamp: previousRecord.trip?.requestTimestamp ?? null,
            financialTotal: previousRecord.paymentGroup?.financialTotal ?? null,
            locationHint:
              previousRecord.location?.resolvedAreaLabel ??
              inferAreaLabelFromCoords(
                previousRecord.analytics?.latitude,
                previousRecord.analytics?.longitude
              ),
          }
        : null,
      nextConfirmedSummary: nextRecord
        ? {
            requestTimestamp: nextRecord.trip?.requestTimestamp ?? null,
            financialTotal: nextRecord.paymentGroup?.financialTotal ?? null,
            locationHint:
              nextRecord.location?.resolvedAreaLabel ??
              inferAreaLabelFromCoords(
                nextRecord.analytics?.latitude,
                nextRecord.analytics?.longitude
              ),
          }
        : null,
    });

    if (autoAccepted) {
      const nearest = {
        event: analyticsCandidates[0],
        diffMs: Math.abs(analyticsCandidates[0].eventMs - trip.timestampMs),
      };
      geoLinkedDataset.push(
        toCanonicalLinkedRecord({
          tripEntry: trip,
          paymentGroup: paymentCandidates[0],
          nearestAnalytics: nearest,
          matchMethod: "direct-timestamp+sequence",
          sequenceSupport: true,
          previousConfirmedTripId: previous.linkedTripId,
          nextConfirmedTripId: next.linkedTripId,
          candidateCountInInterval,
          autoAccepted: true,
        })
      );
      usedUnmatchedPaymentUuids.add(paymentCandidates[0].tripUuid);
      usedAnalyticsEventIso.add(analyticsCandidates[0].eventIso);
      matchedTrips += 1;
      unmatchedTrips = Math.max(0, unmatchedTrips - 1);
      unmatchedPayments = Math.max(0, unmatchedPayments - 1);
    }
  }

  const geoEligibleTrips = tripsInAnalyticsWindow.length;
  const notGeoEligibleTrips = Math.max(0, safeTripRows.length - geoEligibleTrips);
  const unmatchedTripsInWindow = unmatchedTrips;
  const unmatchedPaymentGroupsInWindow = unmatchedPayments;
  const eligibleEarningsTotal =
    Math.round(
      paymentGroupsInAnalyticsWindow.reduce(
        (sum, group) => sum + (group.financialTotal ?? 0),
        0
      ) * 100
    ) / 100;
  const linkedEarningsTotal =
    Math.round(
      geoLinkedDataset.reduce(
        (sum, record) => sum + (record.paymentGroup.financialTotal ?? 0),
        0
      ) * 100
    ) / 100;
  const earningsCoveragePercent =
    eligibleEarningsTotal > 0
      ? Math.round((linkedEarningsTotal / eligibleEarningsTotal) * 1000) / 10
      : 0;
  const earningsCoverageTier = getCoverageTier(earningsCoveragePercent);
  const { coverageSuggestions, historySuggestions } =
    splitReviewSuggestions(reviewSuggestions);
  const sequenceQuickWinsCount = coverageSuggestions.filter(
    (suggestion) => !suggestion.autoAccepted && suggestion.matchConfidence !== "review"
  ).length;

  return {
    matchingMode: "uuid",
    matchedTrips,
    unmatchedTrips,
    unmatchedPayments,
    ambiguousMatches,
    analyticsCoverageRange,
    geoLinkedTrips: geoLinkedDataset.length,
    geoEligibleTrips,
    notGeoEligibleTrips,
    groupedTripsMatchedToPayments: matchedTrips,
    unmatchedTripsInWindow,
    unmatchedPaymentGroupsInWindow,
    eligibleEarningsTotal,
    linkedEarningsTotal,
    earningsCoveragePercent,
    earningsCoverageTier,
    sequenceQuickWinsCount,
    reviewSuggestions,
    coverageSuggestions,
    historySuggestions,
    sequenceSuggestions: reviewSuggestions,
    toleranceUsedSeconds: 60,
    geoLinkedDataset,
    diagnostics: {
      tripsConsidered: safeTripRows.length,
      paymentsConsidered: safePaymentRows.length,
      validTripTimestamps: 0,
      validPaymentTimestamps: 0,
      uniqueTripTimestamps: 0,
      uniquePaymentTimestamps: 0,
      validPaymentUuidRows,
      uniquePaymentTripUuids: paymentGroups.length,
      uuidMatchedTrips: matchedTrips,
      uuidMissingTrips: 0,
      tripUuidFieldUsed: null,
      paymentUuidFieldUsed: paymentUuidField,
      tripsInAnalyticsWindow: tripsInAnalyticsWindow.length,
      paymentGroupsInAnalyticsWindow: paymentGroupsInAnalyticsWindow.length,
      groupedTripsMatchedToPayments: matchedTrips,
    },
  };
}

function persistLinkedDatasetArtifact(importId, linkedDataset, summary) {
  const artifactPath = path.join(uploadsDir, `${importId}-geo-linked.json`);
  console.log(`[IMPORT][confirm] linkedDatasetPersistStart importId=${importId} path=${artifactPath}`);
  try {
    const payload = {
      importId,
      provider: "uber",
      persistedAt: nowIso(),
      linkedRecordCount: Array.isArray(linkedDataset) ? linkedDataset.length : 0,
      summary,
      linkedRecords: Array.isArray(linkedDataset) ? linkedDataset : [],
    };
    fs.writeFileSync(artifactPath, JSON.stringify(payload, null, 2), "utf8");
    console.log(
      `[IMPORT][confirm] linkedDatasetPersistSuccess importId=${importId} linkedRecordCount=${payload.linkedRecordCount} geoLinkedDatasetSampleCount=${Array.isArray(summary?.geoLinkedDatasetSample) ? summary.geoLinkedDatasetSample.length : 0}`
    );
    return artifactPath;
  } catch (error) {
    console.error(
      `[IMPORT][confirm] linkedDatasetPersistFail importId=${importId} message=${error instanceof Error ? error.message : "unknown"}`
    );
    return null;
  }
}

function getLinkedDatasetArtifactPath(importId) {
  return path.join(uploadsDir, `${importId}-geo-linked.json`);
}

function loadLinkedDatasetArtifact(importId) {
  const artifactPath = getLinkedDatasetArtifactPath(importId);
  if (!fs.existsSync(artifactPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(artifactPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      artifactPath,
      payload: parsed,
    };
  } catch {
    return null;
  }
}

function round2(value) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.round(n * 100) / 100;
}

function parsePostcodeOutwardCode(value) {
  if (value == null) return null;
  const text = String(value).trim().toUpperCase();
  if (!text) return null;
  const direct = text.match(/\b([A-Z]{1,2}\d[A-Z\d]?)\b/);
  if (direct?.[1]) {
    return direct[1];
  }
  return null;
}

function inferPostcodeOutwardCodeFromCoords(latitude, longitude) {
  if (latitude == null || longitude == null) return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  if (lat >= 54.64 && lat <= 54.67 && lng >= -6.24 && lng <= -6.19) return "BT29";
  if (lat >= 54.60 && lat <= 54.62 && lng >= -5.88 && lng <= -5.83) return "BT3";
  if (lat >= 54.598 && lat <= 54.607 && lng >= -5.942 && lng <= -5.924) return "BT1";
  if (lat >= 54.585 && lat <= 54.603 && lng >= -5.955 && lng <= -5.925) return "BT2";
  if (lat >= 54.57 && lat <= 54.60 && lng >= -5.95 && lng <= -5.89) return "BT6";
  if (lat >= 54.59 && lat <= 54.62 && lng >= -5.89 && lng <= -5.84) return "BT4";
  if (lat >= 54.64 && lat <= 54.68 && lng >= -5.70 && lng <= -5.66) return "BT19";
  if (lat >= 54.65 && lat <= 54.68 && lng >= -5.68 && lng <= -5.63) return "BT20";
  return null;
}

function resolvePostcodeZoneForUnifiedRow(row) {
  return (
    parsePostcodeOutwardCode(row.pickupAreaLabel) ??
    parsePostcodeOutwardCode(row.requestAreaLabel) ??
    parsePostcodeOutwardCode(row.dropoffAreaLabel) ??
    inferPostcodeOutwardCodeFromCoords(row.pickupLat, row.pickupLng) ??
    inferPostcodeOutwardCodeFromCoords(row.requestLat, row.requestLng) ??
    inferPostcodeOutwardCodeFromCoords(row.dropoffLat, row.dropoffLng) ??
    "BT-UNK"
  );
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function dataStrengthLabel(mappedTripCount, observedHourCount) {
  if (!mappedTripCount || !observedHourCount) return "Not enough data";
  if (mappedTripCount >= 20 && observedHourCount >= 8) return "Strong data";
  if (mappedTripCount >= 10 && observedHourCount >= 4) return "Moderate data";
  if (mappedTripCount >= 5 && observedHourCount >= 2) return "Early signal";
  return "Not enough data";
}

function haversineDistanceMiles(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
}

function mapUberConfidenceToUnified(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "high") {
    return "verified";
  }
  if (normalized === "medium") {
    return "good";
  }
  return null;
}

function mapTimelineConfidenceToUnified(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "high") {
    return "strict";
  }
  if (normalized === "likely") {
    return "good";
  }
  return null;
}

function confidenceWeight(confidence) {
  if (confidence === "verified") return 1.0;
  if (confidence === "strict") return 1.0;
  if (confidence === "good") return 0.8;
  return 0;
}

function buildUnifiedRecordFromUber(record) {
  const confidence = mapUberConfidenceToUnified(record?.matchConfidence);
  if (!confidence) {
    return null;
  }
  const earningsAmount = Number(record?.paymentGroup?.financialTotal ?? NaN);
  const requestTimestamp = record?.trip?.requestTimestamp ?? null;
  if (!requestTimestamp || Number.isNaN(earningsAmount)) {
    return null;
  }

  const lat = Number(record?.location?.lat ?? record?.analytics?.latitude ?? NaN);
  const lng = Number(record?.location?.lng ?? record?.analytics?.longitude ?? NaN);
  return {
    uniqueTripId: record?.linkedTripId ?? `${record?.sourceImportId ?? "import"}:${requestTimestamp}`,
    requestTimestamp,
    beginTimestamp: record?.trip?.beginTimestamp ?? null,
    dropoffTimestamp: record?.trip?.dropoffTimestamp ?? null,
    durationSeconds: Number(record?.trip?.durationSeconds ?? NaN) || null,
    distanceMiles: Number(record?.trip?.distanceMiles ?? NaN) || null,
    earningsAmount: round2(earningsAmount),
    requestLat: Number.isFinite(lat) ? lat : null,
    requestLng: Number.isFinite(lng) ? lng : null,
    pickupLat: Number.isFinite(lat) ? lat : null,
    pickupLng: Number.isFinite(lng) ? lng : null,
    dropoffLat: Number.isFinite(lat) ? lat : null,
    dropoffLng: Number.isFinite(lng) ? lng : null,
    requestAreaLabel: record?.location?.resolvedAreaLabel ?? null,
    pickupAreaLabel: record?.location?.resolvedAreaLabel ?? null,
    dropoffAreaLabel: record?.location?.resolvedAreaLabel ?? null,
    locationSource: "uber_analytics",
    confidence,
    sourceWindowType: "recent_verified",
    weighting: confidenceWeight(confidence),
  };
}

function buildUnifiedRecordFromTimeline(match, importId) {
  const confidence = mapTimelineConfidenceToUnified(match?.confidence);
  if (!confidence) {
    return null;
  }
  const earningsAmount = Number(match?.linkedEarnings ?? NaN);
  const requestTimestamp = match?.tripRequestTimestamp ?? null;
  if (!requestTimestamp || Number.isNaN(earningsAmount)) {
    return null;
  }
  const startLat = Number(match?.timelineSegment?.startLat ?? NaN);
  const startLng = Number(match?.timelineSegment?.startLng ?? NaN);
  const endLat = Number(match?.timelineSegment?.endLat ?? NaN);
  const endLng = Number(match?.timelineSegment?.endLng ?? NaN);
  const startIso = match?.timelineSegment?.startTime ?? null;
  const endIso = match?.timelineSegment?.endTime ?? null;
  const durationSeconds =
    startIso && endIso
      ? Math.max(0, Math.floor((Date.parse(endIso) - Date.parse(startIso)) / 1000))
      : null;

  return {
    uniqueTripId: match?.linkedTripId ?? `${importId}:timeline:${requestTimestamp}`,
    requestTimestamp,
    beginTimestamp: startIso,
    dropoffTimestamp: endIso,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
    distanceMiles:
      Number.isFinite(startLat) &&
      Number.isFinite(startLng) &&
      Number.isFinite(endLat) &&
      Number.isFinite(endLng)
        ? round2(
            haversineDistanceMiles(startLat, startLng, endLat, endLng),
          )
        : null,
    earningsAmount: round2(earningsAmount),
    requestLat: Number.isFinite(startLat) ? startLat : null,
    requestLng: Number.isFinite(startLng) ? startLng : null,
    pickupLat: Number.isFinite(startLat) ? startLat : null,
    pickupLng: Number.isFinite(startLng) ? startLng : null,
    dropoffLat: Number.isFinite(endLat) ? endLat : null,
    dropoffLng: Number.isFinite(endLng) ? endLng : null,
    requestAreaLabel: match?.areaHint ?? null,
    pickupAreaLabel: match?.areaHint ?? null,
    dropoffAreaLabel: match?.areaHint ?? null,
    locationSource: "google_timeline",
    confidence,
    sourceWindowType: "historical_inferred",
    weighting: confidenceWeight(confidence),
  };
}

function getDayHourBucket(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return makeDateBucketKey(days[d.getUTCDay()], d.getUTCHours());
}

function buildUnifiedHeatmapBuckets(rows) {
  const exclusionReasons = {
    missing_timestamp: 0,
    malformed_bucket: 0,
    missing_postcode: 0,
    postcode_unresolved_bt_unk: 0,
    duplicate_removed: 0,
  };
  const seenTripIds = new Set();
  const map = new Map();
  for (const row of rows) {
    const uniqueTripId = String(row.uniqueTripId ?? "");
    if (uniqueTripId && seenTripIds.has(uniqueTripId)) {
      exclusionReasons.duplicate_removed += 1;
      continue;
    }
    if (uniqueTripId) {
      seenTripIds.add(uniqueTripId);
    }
    const timestampIso = row.beginTimestamp ?? row.requestTimestamp;
    if (!timestampIso) {
      exclusionReasons.missing_timestamp += 1;
      continue;
    }
    const timeBucket = getDayHourBucket(timestampIso);
    if (!timeBucket) {
      exclusionReasons.malformed_bucket += 1;
      continue;
    }
    const zone = resolvePostcodeZoneForUnifiedRow(row);
    if (!zone) {
      exclusionReasons.missing_postcode += 1;
      continue;
    }
    if (zone === "BT-UNK") {
      exclusionReasons.postcode_unresolved_bt_unk += 1;
      continue;
    }
    const key = `${zone}||${timeBucket}`;
    const entry = map.get(key) ?? {
      zone,
      timeBucket,
      weightedTripCount: 0,
      weightedFareSum: 0,
      mappedTripCount: 0,
      fareValues: [],
      fareSum: 0,
      observedDateHourKeys: new Set(),
      latSum: 0,
      lngSum: 0,
      centerCount: 0,
      recentVerifiedTripCount: 0,
      historicalInferredTripCount: 0,
    };
    entry.weightedTripCount += row.weighting ?? 0;
    entry.weightedFareSum += (row.earningsAmount ?? 0) * (row.weighting ?? 0);
    const fare = Number(row.earningsAmount ?? NaN);
    if (Number.isFinite(fare)) {
      entry.fareValues.push(fare);
      entry.fareSum += fare;
    }
    entry.mappedTripCount += 1;
    const observedDateHourKey = (() => {
      const iso = timestampIso;
      if (!iso) return null;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return null;
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");
      const hh = String(d.getUTCHours()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd} ${hh}`;
    })();
    if (observedDateHourKey) {
      entry.observedDateHourKeys.add(observedDateHourKey);
    }
    const lat = Number(row.pickupLat ?? row.requestLat ?? row.dropoffLat ?? NaN);
    const lng = Number(row.pickupLng ?? row.requestLng ?? row.dropoffLng ?? NaN);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      entry.latSum += lat;
      entry.lngSum += lng;
      entry.centerCount += 1;
    }
    if (row.sourceWindowType === "recent_verified") {
      entry.recentVerifiedTripCount += 1;
    } else if (row.sourceWindowType === "historical_inferred") {
      entry.historicalInferredTripCount += 1;
    }
    map.set(key, entry);
  }
  const buckets = Array.from(map.values())
    .map((entry) => {
      const distinctObservedDateHourCount = entry.observedDateHourKeys.size;
      const avgFare = entry.fareSum / Math.max(entry.mappedTripCount, 1);
      const medianFare = percentile(entry.fareValues, 0.5);
      const p25Fare = percentile(entry.fareValues, 0.25);
      const p75Fare = percentile(entry.fareValues, 0.75);
      const tripsPerObservedHour =
        entry.mappedTripCount / Math.max(distinctObservedDateHourCount, 1);
      const earningsPerObservedHour =
        entry.fareSum / Math.max(distinctObservedDateHourCount, 1);
      const centerLat = entry.centerCount > 0 ? entry.latSum / entry.centerCount : null;
      const centerLng = entry.centerCount > 0 ? entry.lngSum / entry.centerCount : null;
      return {
        zone: entry.zone,
        timeBucket: entry.timeBucket,
        weightedTripCount: round2(entry.weightedTripCount),
        weightedAvgFare: round2(
          entry.weightedFareSum / Math.max(entry.weightedTripCount, 1),
        ),
        mappedTripCount: entry.mappedTripCount,
        distinctObservedDateHourCount,
        recentVerifiedTripCount: entry.recentVerifiedTripCount,
        historicalInferredTripCount: entry.historicalInferredTripCount,
        averageFare: round2(avgFare),
        medianFare: round2(medianFare),
        p25Fare: round2(p25Fare),
        p75Fare: round2(p75Fare),
        tripsPerObservedHour: round2(tripsPerObservedHour),
        earningsPerObservedHour: round2(earningsPerObservedHour),
        centerLat: Number.isFinite(centerLat) ? round2(centerLat) : null,
        centerLng: Number.isFinite(centerLng) ? round2(centerLng) : null,
        dataStrength: dataStrengthLabel(
          entry.mappedTripCount,
          distinctObservedDateHourCount,
        ),
      };
    })
    .sort((a, b) => {
      if (a.timeBucket !== b.timeBucket) return a.timeBucket.localeCompare(b.timeBucket);
      return b.earningsPerObservedHour - a.earningsPerObservedHour;
    });

  const buildRollup = (items, keyFn) => {
    const rollup = new Map();
    for (const item of items) {
      const key = keyFn(item);
      const existing = rollup.get(key) ?? {
        key,
        mappedTripCount: 0,
        distinctObservedDateHourCount: 0,
        recentVerifiedTripCount: 0,
        historicalInferredTripCount: 0,
      };
      existing.mappedTripCount += Number(item.mappedTripCount ?? 0);
      existing.distinctObservedDateHourCount += Number(item.distinctObservedDateHourCount ?? 0);
      existing.recentVerifiedTripCount += Number(item.recentVerifiedTripCount ?? 0);
      existing.historicalInferredTripCount += Number(item.historicalInferredTripCount ?? 0);
      rollup.set(key, existing);
    }
    return Array.from(rollup.values()).sort((a, b) => b.mappedTripCount - a.mappedTripCount);
  };

  const totalMatchedTripsUsedByHeatmap = Array.isArray(rows) ? rows.length : 0;
  const totalTripsBucketed = buckets.reduce(
    (sum, bucket) => sum + Number(bucket.mappedTripCount ?? 0),
    0,
  );
  const totalTripsExcluded = Object.values(exclusionReasons).reduce(
    (sum, count) => sum + Number(count ?? 0),
    0,
  );

  return {
    buckets,
    audit: {
      totalMatchedTripsUsedByHeatmap,
      totalTripsBucketed,
      totalTripsExcluded,
      exclusionReasons,
      reconciles:
        totalTripsBucketed + totalTripsExcluded === totalMatchedTripsUsedByHeatmap,
      byPostcode: buildRollup(buckets, (bucket) => bucket.zone),
      byDay: buildRollup(buckets, (bucket) => String(bucket.timeBucket).split("-")[0] ?? "Sun"),
      byHour: buildRollup(buckets, (bucket) => String(bucket.timeBucket).split("-")[1] ?? "00"),
      byPostcodeDay: buildRollup(
        buckets,
        (bucket) => `${bucket.zone}|${String(bucket.timeBucket).split("-")[0] ?? "Sun"}`,
      ),
      byPostcodeHour: buildRollup(
        buckets,
        (bucket) => `${bucket.zone}|${String(bucket.timeBucket).split("-")[1] ?? "00"}`,
      ),
      byDayHour: buildRollup(
        buckets,
        (bucket) => `${String(bucket.timeBucket).split("-")[0] ?? "Sun"}|${String(bucket.timeBucket).split("-")[1] ?? "00"}`,
      ),
      bucketRows: buckets,
      topBucketsByMappedTripCount: buckets
        .slice()
        .sort((a, b) => b.mappedTripCount - a.mappedTripCount)
        .slice(0, 10),
    },
  };
}

function buildUnifiedDecisionDataset(importId, linkedRecords, timelineInferredMatches, historicalTripBackfillRecords) {
  const safeLinked = Array.isArray(linkedRecords) ? linkedRecords : [];
  const safeTimeline = Array.isArray(timelineInferredMatches)
    ? timelineInferredMatches
    : [];
  const safeHistorical = Array.isArray(historicalTripBackfillRecords)
    ? historicalTripBackfillRecords
    : [];
  const unifiedRows = [];
  for (const record of safeLinked) {
    const unified = buildUnifiedRecordFromUber(record);
    if (unified) unifiedRows.push(unified);
  }
  for (const historical of safeHistorical) {
    if (!historical || !["strict", "good"].includes(String(historical.confidence ?? ""))) {
      continue;
    }
    unifiedRows.push({
      uniqueTripId: historical.uniqueTripId,
      requestTimestamp: historical.requestTimestamp ?? null,
      beginTimestamp: historical.beginTimestamp ?? null,
      dropoffTimestamp: historical.dropoffTimestamp ?? null,
      durationSeconds: historical.durationSeconds ?? null,
      distanceMiles: historical.distanceMiles ?? null,
      earningsAmount: historical.earningsAmount ?? null,
      requestLat: historical.requestLat ?? null,
      requestLng: historical.requestLng ?? null,
      pickupLat: historical.pickupLat ?? null,
      pickupLng: historical.pickupLng ?? null,
      dropoffLat: historical.dropoffLat ?? null,
      dropoffLng: historical.dropoffLng ?? null,
      requestAreaLabel: historical.requestAreaLabel ?? null,
      pickupAreaLabel: historical.pickupAreaLabel ?? null,
      dropoffAreaLabel: historical.dropoffAreaLabel ?? null,
      locationSource: "google_timeline",
      confidence: historical.confidence,
      sourceWindowType: "historical_inferred",
      weighting: confidenceWeight(historical.confidence),
    });
  }
  for (const match of safeTimeline) {
    const unified = buildUnifiedRecordFromTimeline(match, importId);
    if (unified) unifiedRows.push(unified);
  }

  const recentVerifiedCount = unifiedRows.filter(
    (row) => row.sourceWindowType === "recent_verified",
  ).length;
  const historicalBackfillCount = unifiedRows.filter(
    (row) => row.sourceWindowType === "historical_inferred",
  ).length;
  const heatmapResult = buildUnifiedHeatmapBuckets(unifiedRows);
  const heatmapBuckets = heatmapResult.buckets;
  return {
    importId,
    generatedAt: nowIso(),
    schemaVersion: "v1",
    unifiedTripCount: unifiedRows.length,
    recentVerifiedCount,
    historicalBackfillCount,
    heatmapReady: heatmapBuckets.length > 0,
    rows: unifiedRows,
    heatmapBuckets,
    heatmapCoverageAudit: heatmapResult.audit,
    sample: unifiedRows.slice(0, 10),
  };
}

function parseLatLngFromTimelineValue(value) {
  if (value == null) return { lat: null, lng: null };
  if (typeof value === "object") {
    const lat = Number.parseFloat(String(value.latitude ?? value.lat ?? ""));
    const lng = Number.parseFloat(String(value.longitude ?? value.lng ?? ""));
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }
  const raw = String(value).trim().replace(/^geo:/i, "").replace(/Â°/g, "");
  if (!raw) return { lat: null, lng: null };
  const parts = raw.split(",").map((part) => part.trim());
  if (parts.length < 2) return { lat: null, lng: null };
  const lat = Number.parseFloat(parts[0]);
  const lng = Number.parseFloat(parts[1]);
  return {
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

function extractTimelinePathPointPositionsFromFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
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
        const timestampIso = parseDateValue(entry?.time ?? entry?.timestamp ?? entry?.eventTime)?.toISOString() ?? null;
        if (!timestampIso) continue;
        const latLng = parseLatLngFromTimelineValue(
          entry?.point ?? entry?.latLng ?? entry?.LatLng ?? entry?.location ?? entry,
        );
        if (!Number.isFinite(latLng.lat) || !Number.isFinite(latLng.lng)) continue;
        const timestampMs = Date.parse(timestampIso);
        if (!Number.isFinite(timestampMs)) continue;
        points.push({
          timestampMs,
          timestampIso,
          lat: latLng.lat,
          lng: latLng.lng,
          source: "timelinePath",
          dateBucket: getDateBucket(timestampIso),
        });
      }
    }
    return points;
  } catch {
    return [];
  }
}

function buildTimelinePointIndexFromParsed(parsed, timelinePathPoints = []) {
  const points = [];
  let rawSignalPointCount = 0;
  let timelinePathExpandedPointCount = 0;
  let timelineSegmentEndpointPointCount = 0;
  for (const point of parsed?.rawSignalPositions ?? []) {
    if (!Number.isFinite(point?.timestampMs) || point?.lat == null || point?.lng == null) {
      continue;
    }
    points.push({
      timestampMs: point.timestampMs,
      timestampIso: point.timestampIso ?? null,
      lat: point.lat,
      lng: point.lng,
      source: "rawSignal",
      dateBucket: point.dateBucket ?? getDateBucket(point.timestampIso),
    });
    rawSignalPointCount += 1;
  }
  for (const point of timelinePathPoints ?? []) {
    if (!Number.isFinite(point?.timestampMs) || !Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) {
      continue;
    }
    points.push({
      timestampMs: point.timestampMs,
      timestampIso: point.timestampIso ?? null,
      lat: Number(point.lat),
      lng: Number(point.lng),
      source: "timelinePath",
      dateBucket: point.dateBucket ?? getDateBucket(point.timestampIso),
    });
    timelinePathExpandedPointCount += 1;
  }
  for (const segment of parsed?.segments ?? []) {
    const startMs = Date.parse(segment?.startTime ?? "");
    if (Number.isFinite(startMs) && Number.isFinite(segment?.startLat) && Number.isFinite(segment?.startLng)) {
      points.push({
        timestampMs: startMs,
        timestampIso: segment.startTime,
        lat: Number(segment.startLat),
        lng: Number(segment.startLng),
        source: "timelinePath",
        dateBucket: getDateBucket(segment.startTime),
      });
      timelineSegmentEndpointPointCount += 1;
    }
    const endMs = Date.parse(segment?.endTime ?? "");
    if (Number.isFinite(endMs) && Number.isFinite(segment?.endLat) && Number.isFinite(segment?.endLng)) {
      points.push({
        timestampMs: endMs,
        timestampIso: segment.endTime,
        lat: Number(segment.endLat),
        lng: Number(segment.endLng),
        source: "timelinePath",
        dateBucket: getDateBucket(segment.endTime),
      });
      timelineSegmentEndpointPointCount += 1;
    }
  }
  points.sort((a, b) => a.timestampMs - b.timestampMs);
  const byMonth = new Map();
  for (const point of points) {
    if (!point.dateBucket) continue;
    const list = byMonth.get(point.dateBucket) ?? [];
    list.push(point);
    byMonth.set(point.dateBucket, list);
  }
  return {
    allPoints: points,
    byMonth,
    diagnostics: {
      rawSignalPointCount,
      timelinePathExpandedPointCount,
      timelineSegmentEndpointPointCount,
      combinedPointCount: points.length,
      distinctMonthBucketCount: byMonth.size,
      coverageStart: points.length > 0 ? points[0].timestampIso ?? null : null,
      coverageEnd: points.length > 0 ? points[points.length - 1].timestampIso ?? null : null,
      monthCoverage: Array.from(byMonth.keys()).sort((a, b) => a.localeCompare(b)),
    },
  };
}

function findNearestPoint(points, targetIso, windowSeconds) {
  const targetMs = Date.parse(targetIso ?? "");
  if (!Number.isFinite(targetMs)) {
    return null;
  }
  const maxDelta = windowSeconds * 1000;
  let best = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const delta = Math.abs(point.timestampMs - targetMs);
    if (delta <= maxDelta && delta < bestDelta) {
      best = point;
      bestDelta = delta;
    }
  }
  if (!best) return null;
  return {
    ...best,
    deltaSeconds: bestDelta / 1000,
  };
}

function parseTripBackboneRows(tripRows, tripHeaders) {
  const requestField = resolveFieldByAliases(tripHeaders ?? [], [
    "request_timestamp_local",
    "request_timestamp",
    "request_time_local",
  ]);
  const beginField = resolveFieldByAliases(tripHeaders ?? [], [
    "begintrip_timestamp_local",
    "begintrip_timestamp",
    "start_timestamp_local",
    "start_time",
  ]);
  const endField = resolveFieldByAliases(tripHeaders ?? [], [
    "dropoff_timestamp_local",
    "dropoff_timestamp",
    "end_timestamp_local",
    "end_time",
  ]);
  const durationField = resolveFieldByAliases(tripHeaders ?? [], [
    "trip_duration_seconds",
    "duration_seconds",
    "trip_duration",
  ]);
  const distanceField = resolveFieldByAliases(tripHeaders ?? [], [
    "trip_distance_miles",
    "distance_miles",
    "trip_distance",
  ]);
  const fareField = resolveFieldByAliases(tripHeaders ?? [], [
    "original_fare_local",
    "fare_local",
    "total_payment",
    "total_fare",
  ]);
  const statusField = resolveFieldByAliases(tripHeaders ?? [], ["status", "trip_status"]);

  const parsed = [];
  for (let i = 0; i < (tripRows ?? []).length; i += 1) {
    const row = tripRows[i];
    const requestIso = requestField ? parseDateValue(row[requestField])?.toISOString() ?? null : null;
    const beginIso = beginField ? parseDateValue(row[beginField])?.toISOString() ?? null : null;
    const endIso = endField ? parseDateValue(row[endField])?.toISOString() ?? null : null;
    if (!requestIso && !beginIso && !endIso) {
      continue;
    }
    parsed.push({
      uniqueTripId: `trip_${String(i + 1).padStart(6, "0")}`,
      requestTimestamp: requestIso,
      beginTimestamp: beginIso,
      dropoffTimestamp: endIso,
      durationSeconds: parseDurationSecondsValue(durationField ? row[durationField] : null),
      distanceMiles: parseDistanceMilesValue(distanceField ? row[distanceField] : null),
      earningsAmount: round2(Number.parseFloat(String(fareField ? row[fareField] ?? 0 : 0)) || 0),
      status: statusField ? row[statusField] ?? null : null,
      areaHint: resolveAreaHintFromTripRow(row, {
        pickupAreaField: resolveFieldByAliases(tripHeaders ?? [], ["pickup_area", "pickup_postcode", "pickup_city"]),
        dropoffAreaField: resolveFieldByAliases(tripHeaders ?? [], ["dropoff_area", "dropoff_postcode", "dropoff_city"]),
      }),
    });
  }
  return {
    rows: parsed,
    fields: {
      requestField,
      beginField,
      endField,
      durationField,
      distanceField,
      fareField,
      statusField,
    },
  };
}

function classifyHistoricalMatchConfidence(match) {
  const begin = match.beginPoint;
  const end = match.dropoffPoint;
  const request = match.requestPoint;
  const beginDelta = begin?.deltaSeconds ?? null;
  const endDelta = end?.deltaSeconds ?? null;
  const requestDelta = request?.deltaSeconds ?? null;
  if (beginDelta != null && endDelta != null && beginDelta <= 60 && endDelta <= 60 && requestDelta != null && requestDelta <= 60) {
    return "strict";
  }
  if (beginDelta != null && endDelta != null && beginDelta <= 120 && endDelta <= 120) {
    return "good";
  }
  if (requestDelta != null || beginDelta != null || endDelta != null) {
    return "review";
  }
  return "excluded";
}

function summarizeTripBackboneWindow(matches, windowSeconds) {
  const requestOnly = matches.filter((m) => m.requestPoint && !m.beginPoint && !m.dropoffPoint).length;
  const startOnly = matches.filter((m) => !m.requestPoint && m.beginPoint && !m.dropoffPoint).length;
  const endOnly = matches.filter((m) => !m.requestPoint && !m.beginPoint && m.dropoffPoint).length;
  const startEnd = matches.filter((m) => m.beginPoint && m.dropoffPoint).length;
  const allThree = matches.filter((m) => m.requestPoint && m.beginPoint && m.dropoffPoint).length;
  return {
    windowSeconds,
    totalTripsTested: matches.length,
    requestOnly,
    startOnly,
    endOnly,
    startAndEnd: startEnd,
    requestStartEnd: allThree,
  };
}

function buildTripBackboneHistoricalMatches(trips, timelinePointsIndex) {
  const windows = [60, 120];
  const byWindow = {};
  const acceptedWindow = 120;
  let acceptedRows = [];

  for (const windowSeconds of windows) {
    const rows = (trips ?? []).map((trip) => {
      const requestPoint = trip.requestTimestamp
        ? findNearestPoint(timelinePointsIndex.allPoints, trip.requestTimestamp, windowSeconds)
        : null;
      const beginPoint = trip.beginTimestamp
        ? findNearestPoint(timelinePointsIndex.allPoints, trip.beginTimestamp, windowSeconds)
        : null;
      const dropoffPoint = trip.dropoffTimestamp
        ? findNearestPoint(timelinePointsIndex.allPoints, trip.dropoffTimestamp, windowSeconds)
        : null;
      const confidence = classifyHistoricalMatchConfidence({
        requestPoint,
        beginPoint,
        dropoffPoint,
      });
      return {
        uniqueTripId: trip.uniqueTripId,
        requestTimestamp: trip.requestTimestamp,
        beginTimestamp: trip.beginTimestamp,
        dropoffTimestamp: trip.dropoffTimestamp,
        durationSeconds: trip.durationSeconds,
        distanceMiles: trip.distanceMiles,
        earningsAmount: trip.earningsAmount,
        status: trip.status,
        requestPoint,
        beginPoint,
        dropoffPoint,
        requestLat: requestPoint?.lat ?? null,
        requestLng: requestPoint?.lng ?? null,
        pickupLat: beginPoint?.lat ?? null,
        pickupLng: beginPoint?.lng ?? null,
        dropoffLat: dropoffPoint?.lat ?? null,
        dropoffLng: dropoffPoint?.lng ?? null,
        requestAreaLabel:
          requestPoint != null
            ? inferAreaLabelFromCoords(requestPoint.lat, requestPoint.lng)
            : trip.areaHint ?? null,
        pickupAreaLabel:
          beginPoint != null
            ? inferAreaLabelFromCoords(beginPoint.lat, beginPoint.lng)
            : trip.areaHint ?? null,
        dropoffAreaLabel:
          dropoffPoint != null
            ? inferAreaLabelFromCoords(dropoffPoint.lat, dropoffPoint.lng)
            : trip.areaHint ?? null,
        locationSource: "google_timeline",
        sourceWindowType: "historical_inferred",
        confidence,
        weighting: confidence === "strict" ? 1.0 : confidence === "good" ? 0.8 : 0,
        matchQualityDetails: {
          windowSeconds,
          requestDeltaSeconds: requestPoint?.deltaSeconds ?? null,
          beginDeltaSeconds: beginPoint?.deltaSeconds ?? null,
          dropoffDeltaSeconds: dropoffPoint?.deltaSeconds ?? null,
          requestSource: requestPoint?.source ?? null,
          beginSource: beginPoint?.source ?? null,
          dropoffSource: dropoffPoint?.source ?? null,
        },
      };
    });
    const countsByConfidence = {
      strict: rows.filter((r) => r.confidence === "strict").length,
      good: rows.filter((r) => r.confidence === "good").length,
      review: rows.filter((r) => r.confidence === "review").length,
      excluded: rows.filter((r) => r.confidence === "excluded").length,
    };
    byWindow[String(windowSeconds)] = {
      audit: summarizeTripBackboneWindow(rows, windowSeconds),
      countsByConfidence,
      matchedRows: rows,
    };
    if (windowSeconds === acceptedWindow) {
      acceptedRows = rows.filter((r) => r.confidence === "strict" || r.confidence === "good");
    }
  }
  return {
    byWindow,
    acceptedRows,
  };
}

function getUnifiedDecisionArtifactPath(importId) {
  return path.join(uploadsDir, `${importId}-decision-unified.json`);
}

function persistUnifiedDecisionArtifact(importId, unifiedDataset) {
  const artifactPath = getUnifiedDecisionArtifactPath(importId);
  fs.writeFileSync(artifactPath, JSON.stringify(unifiedDataset, null, 2), "utf8");
  return artifactPath;
}

function loadUnifiedDecisionArtifact(importId) {
  const artifactPath = getUnifiedDecisionArtifactPath(importId);
  if (!fs.existsSync(artifactPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    return { artifactPath, payload: parsed };
  } catch {
    return null;
  }
}

function getHeatmapCoverageArtifactPath(importId) {
  return path.join(uploadsDir, `${importId}-heatmap-coverage.json`);
}

function buildHeatmapCoverageArtifact(importId, unifiedDataset) {
  const derivedAudit = Array.isArray(unifiedDataset?.rows)
    ? buildUnifiedHeatmapBuckets(unifiedDataset.rows).audit
    : unifiedDataset?.heatmapCoverageAudit ?? null;
  const audit = derivedAudit ?? null;
  const sourceBuckets = Array.isArray(audit?.bucketRows)
    ? audit.bucketRows
    : Array.isArray(unifiedDataset?.heatmapBuckets)
      ? unifiedDataset.heatmapBuckets
      : [];
  const coverage = sourceBuckets.map((bucket) => {
    const [dayRaw = "Sun", hourRaw = "00"] = String(bucket.timeBucket ?? "Sun-00").split("-");
    return {
      postcode: String(bucket.zone ?? "BT-UNK").trim().toUpperCase(),
      day: dayRaw,
      hour: Number.parseInt(hourRaw, 10) || 0,
      timeBucket: `${dayRaw}-${String(Number.parseInt(hourRaw, 10) || 0).padStart(2, "0")}`,
      mappedTripCount: Number(bucket.mappedTripCount ?? 0),
      distinctObservedDateHourCount: Number(bucket.distinctObservedDateHourCount ?? 0),
      recentVerifiedTripCount: Number(bucket.recentVerifiedTripCount ?? 0),
      historicalInferredTripCount: Number(bucket.historicalInferredTripCount ?? 0),
      dataStrength: bucket.dataStrength ?? "Not enough data",
    };
  });
  return {
    importId,
    generatedAt: nowIso(),
    coverageCount: coverage.length,
    coverage,
    rollups: {
      byPostcode: audit?.byPostcode ?? [],
      byDay: audit?.byDay ?? [],
      byHour: audit?.byHour ?? [],
      byPostcodeDay: audit?.byPostcodeDay ?? [],
      byPostcodeHour: audit?.byPostcodeHour ?? [],
      byDayHour: audit?.byDayHour ?? [],
    },
    reconciliation: {
      totalMatchedTripsUsedByHeatmap: Number(audit?.totalMatchedTripsUsedByHeatmap ?? 0),
      totalTripsBucketed: Number(audit?.totalTripsBucketed ?? 0),
      totalTripsExcluded: Number(audit?.totalTripsExcluded ?? 0),
      exclusionReasons: audit?.exclusionReasons ?? {},
      reconciles: Boolean(audit?.reconciles),
    },
    topBucketsByMappedTripCount: audit?.topBucketsByMappedTripCount ?? [],
    samplePostcodeKeys: Array.from(new Set(coverage.map((row) => row.postcode))).slice(0, 20),
  };
}

function persistHeatmapCoverageArtifact(importId, artifact) {
  const artifactPath = getHeatmapCoverageArtifactPath(importId);
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
  return artifactPath;
}

function loadHeatmapCoverageArtifact(importId) {
  const artifactPath = getHeatmapCoverageArtifactPath(importId);
  if (!fs.existsSync(artifactPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    return { artifactPath, payload: parsed };
  } catch {
    return null;
  }
}

function ensureHeatmapCoverageArtifact(importId) {
  const existing = loadHeatmapCoverageArtifact(importId);
  const hasLegacyCoverageLabels = Array.isArray(existing?.payload?.samplePostcodeKeys)
    ? existing.payload.samplePostcodeKeys.some(
        (key) => !/^BT([0-9]{1,2}[A-Z0-9]?|-UNK)$/i.test(String(key ?? "")),
      )
    : false;
  if (existing?.payload?.reconciliation && existing?.payload?.rollups && !hasLegacyCoverageLabels) {
    return existing;
  }
  const unified = loadUnifiedDecisionArtifact(importId);
  if (!unified?.payload) {
    return existing ?? null;
  }
  const rebuilt = buildHeatmapCoverageArtifact(importId, unified.payload);
  const artifactPath = persistHeatmapCoverageArtifact(importId, rebuilt);
  return {
    artifactPath,
    payload: rebuilt,
  };
}

function findLatestTimelineInferredForImport(importId) {
  const files = fs
    .readdirSync(uploadsDir)
    .filter((name) => /^timeline_.*-inferred\.json$/i.test(name))
    .sort((a, b) => {
      const aPath = path.join(uploadsDir, a);
      const bPath = path.join(uploadsDir, b);
      return fs.statSync(bPath).mtimeMs - fs.statSync(aPath).mtimeMs;
    });
  for (const file of files) {
    const fullPath = path.join(uploadsDir, file);
    try {
      const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      if (parsed?.importId === importId) {
        return parsed;
      }
    } catch {
      // ignore malformed file
    }
  }
  return null;
}

function hydrateUnifiedSummaryFromArtifact(summary, unifiedDataset) {
  return {
    ...summary,
    unifiedDecisionDatasetSize: unifiedDataset?.unifiedTripCount ?? 0,
    unifiedRecentVerifiedRows: unifiedDataset?.recentVerifiedCount ?? 0,
    unifiedHistoricalBackfillRows: unifiedDataset?.historicalBackfillCount ?? 0,
    heatmapReady: Boolean(unifiedDataset?.heatmapReady),
    unifiedDecisionSample: Array.isArray(unifiedDataset?.sample)
      ? unifiedDataset.sample.slice(0, 5)
      : [],
  };
}

function summarizeCsvEntry(
  zip,
  entryName,
  preferredTimestampField,
  additionalTimestampAliases = []
) {
  if (!entryName) {
    return {
      found: false,
      headers: [],
      rowCount: 0,
      sampleRows: [],
      dataRows: [],
      timestampFieldUsed: null,
      dateRange: null,
    };
  }

  const entry = zip.getEntry(entryName);
  if (!entry) {
    return {
      found: false,
      headers: [],
      rowCount: 0,
      sampleRows: [],
      dataRows: [],
      timestampFieldUsed: null,
      dateRange: null,
    };
  }

  const csvText = entry.getData().toString("utf8");
  if (!csvText || csvText.trim().length === 0) {
    return {
      found: true,
      headers: [],
      rowCount: 0,
      sampleRows: [],
      dataRows: [],
      timestampFieldUsed: null,
      dateRange: null,
    };
  }
  const parsed = parseCsvText(csvText);
  const timestampFieldUsed = resolveTimestampField(
    parsed.headers,
    preferredTimestampField,
    additionalTimestampAliases
  );
  const dateRange = computeDateRange(parsed.dataRows, timestampFieldUsed);

  return {
    found: true,
    headers: parsed.headers,
    rowCount: parsed.rowCount,
    sampleRows: parsed.sampleRows,
    dataRows: parsed.dataRows,
    timestampFieldUsed,
    dateRange,
  };
}

function pickBestEntryName(entryNames, options) {
  const normalizedEntries = entryNames.map((original) => ({
    original,
    lower: original.toLowerCase(),
  }));

  const filtered = normalizedEntries.filter((entry) =>
    options.exclude.every((pattern) => !entry.lower.includes(pattern))
  );

  for (const pattern of options.prefer) {
    const hit = filtered.find((entry) => entry.lower.includes(pattern));
    if (hit) {
      return {
        selected: hit.original,
        candidates: filtered.map((entry) => entry.original),
      };
    }
  }

  for (const pattern of options.fallback) {
    const hit = filtered.find((entry) => entry.lower.includes(pattern));
    if (hit) {
      return {
        selected: hit.original,
        candidates: filtered.map((entry) => entry.original),
      };
    }
  }

  return {
    selected: null,
    candidates: filtered.map((entry) => entry.original),
  };
}

function buildHistoricalTimelineBackfillCandidates(args) {
  const {
    tripRows,
    paymentRows,
    tripHeaders,
    paymentHeaders,
    tripTimestampField,
    paymentTimestampField,
    analyticsCoverageRange,
    coveredLinkedRecords,
  } = args;

  const safeTripRows = Array.isArray(tripRows) ? tripRows : [];
  const safePaymentRows = Array.isArray(paymentRows) ? paymentRows : [];
  const tripUuidField = resolveFieldByAliases(tripHeaders ?? [], [
    "trip_uuid",
    "trip uuid",
    "uuid",
    "trip_id",
  ]);
  const paymentUuidField = resolveFieldByAliases(paymentHeaders ?? [], [
    "trip_uuid",
    "trip uuid",
    "uuid",
    "trip_id",
  ]);
  const durationField = resolveFieldByAliases(tripHeaders ?? [], [
    "trip_duration_seconds",
    "duration_seconds",
    "trip_duration",
    "duration",
    "time",
  ]);
  const distanceField = resolveFieldByAliases(tripHeaders ?? [], [
    "trip_distance_miles",
    "distance_miles",
    "trip_distance",
    "distance",
    "distance_km",
  ]);
  const tripStatusField = resolveFieldByAliases(tripHeaders ?? [], [
    "status",
    "trip_status",
    "state",
  ]);
  const pickupAreaField = resolveFieldByAliases(tripHeaders ?? [], [
    "pickup_postcode",
    "pickup_area",
    "pickup_zone",
    "pickup_city",
    "pickup_location",
    "pickup_address",
  ]);
  const dropoffAreaField = resolveFieldByAliases(tripHeaders ?? [], [
    "dropoff_postcode",
    "dropoff_area",
    "dropoff_zone",
    "dropoff_city",
    "dropoff_location",
    "dropoff_address",
  ]);
  const fieldMapping = {
    durationField,
    distanceField,
    tripStatusField,
    pickupAreaField,
    dropoffAreaField,
  };

  const paymentsGrouped = buildPaymentGroupsByTripUuid(
    safePaymentRows,
    paymentUuidField,
    paymentTimestampField
  );

  const tripsByUuid = new Map();
  let tripsWithUuid = 0;
  if (tripUuidField) {
    for (const tripRow of safeTripRows) {
      const uuid = normalizeUuid(tripRow[tripUuidField]);
      if (!uuid) {
        continue;
      }
      tripsWithUuid += 1;
      tripsByUuid.set(uuid, tripRow);
    }
  }
  const tripsByTimestampKey = new Map();
  const tripRowMeta = new WeakMap();
  let tripsWithTimestamp = 0;
  for (const tripRow of safeTripRows) {
    const tripTimestampIso = tripTimestampField
      ? parseDateValue(tripRow[tripTimestampField])?.toISOString() ?? null
      : null;
    if (tripTimestampIso) {
      tripsWithTimestamp += 1;
      const key = normalizeTimestampKey(tripTimestampIso);
      if (key) {
        const list = tripsByTimestampKey.get(key) ?? [];
        list.push(tripRow);
        tripsByTimestampKey.set(key, list);
      }
    }
    tripRowMeta.set(tripRow, {
      tripUuid: tripUuidField ? normalizeUuid(tripRow[tripUuidField]) : null,
      requestTimestampIso: tripTimestampIso,
    });
  }
  const paymentGroupsWithUuid = paymentsGrouped.filter((group) => normalizeUuid(group.tripUuid)).length;

  const coveredTripUuids = new Set();
  const coveredTripRequestKeys = new Set();
  for (const record of coveredLinkedRecords ?? []) {
    const uuid = normalizeUuid(record?.paymentGroup?.tripUuid);
    if (uuid) {
      coveredTripUuids.add(uuid);
    }
    const requestKey = normalizeTimestampKey(record?.trip?.requestTimestamp);
    if (requestKey) {
      coveredTripRequestKeys.add(requestKey);
    }
  }

  const candidates = [];
  let candidatesConsidered = 0;
  let candidatesOutsideAnalyticsWindow = 0;
  let candidatesInsideAnalyticsWindow = 0;
  let candidatesAlreadyCovered = 0;
  let candidatesWithDuration = 0;
  let candidatesWithDistance = 0;
  let candidatesWithAreaHint = 0;
  let joinedTripPaymentCandidates = 0;
  let paymentOnlyCandidates = 0;
  let tripOnlyCandidates = 0;
  const joinFailureReasons = {
    missingTripUuid: 0,
    uuidMismatchNoTrip: 0,
    timestampFallbackNoMatch: 0,
    timestampFallbackAmbiguous: 0,
  };
  const usedTripRows = new Set();

  const buildCandidateFromValues = (values) => {
    const {
      sourceType,
      tripUuid,
      timestampIso,
      estimatedEarnings,
      areaHint,
      durationSeconds,
      distanceMiles,
      tripStatus,
      alreadyCovered,
      coverageKey,
    } = values;
    if (!timestampIso) {
      return null;
    }
    const timestampMs = Date.parse(timestampIso);
    if (Number.isNaN(timestampMs)) {
      return null;
    }
    candidatesConsidered += 1;
    const insideAnalyticsWindow = isWithinRange(timestampMs, analyticsCoverageRange);
    if (!insideAnalyticsWindow) {
      candidatesOutsideAnalyticsWindow += 1;
    } else {
      candidatesInsideAnalyticsWindow += 1;
    }
    const requestKey = coverageKey ?? normalizeTimestampKey(timestampIso);
    const covered = Boolean(
      alreadyCovered ||
        (tripUuid && coveredTripUuids.has(tripUuid)) ||
        (requestKey && coveredTripRequestKeys.has(requestKey))
    );
    if (covered) {
      candidatesAlreadyCovered += 1;
      return null;
    }
    if (durationSeconds != null) {
      candidatesWithDuration += 1;
    }
    if (distanceMiles != null) {
      candidatesWithDistance += 1;
    }
    if (areaHint != null) {
      candidatesWithAreaHint += 1;
    }
    return {
      candidateId: `${tripUuid ?? "ts"}:${timestampIso}:${sourceType}`,
      tripRequestTimestamp: timestampIso,
      estimatedEarnings:
        estimatedEarnings == null ? null : Math.round(Number(estimatedEarnings) * 100) / 100,
      areaHint: areaHint ? String(areaHint) : null,
      tripUuid: tripUuid ?? null,
      durationSeconds,
      distanceMiles,
      tripStatus,
      sourceType,
      insideAnalyticsWindow,
      alreadyCovered: false,
    };
  };

  for (const paymentGroup of paymentsGrouped) {
    const tripUuid = normalizeUuid(paymentGroup.tripUuid);
    let tripRow = tripUuid ? tripsByUuid.get(tripUuid) ?? null : null;
    let joinedVia = tripRow ? "uuid" : null;
    if (!tripUuid) {
      joinFailureReasons.missingTripUuid += 1;
    } else if (!tripRow) {
      joinFailureReasons.uuidMismatchNoTrip += 1;
    }

    const paymentTsKey = normalizeTimestampKey(paymentGroup.timestampIso);
    if (!tripRow && paymentTsKey) {
      const byTs = tripsByTimestampKey.get(paymentTsKey) ?? [];
      if (byTs.length === 1) {
        tripRow = byTs[0];
        joinedVia = "timestamp_fallback";
      } else if (byTs.length > 1) {
        joinFailureReasons.timestampFallbackAmbiguous += 1;
      } else {
        joinFailureReasons.timestampFallbackNoMatch += 1;
      }
    }
    if (tripRow) {
      usedTripRows.add(tripRow);
    }
    const tripTimestampIso =
      tripRow && tripTimestampField
        ? parseDateValue(tripRow[tripTimestampField])?.toISOString() ?? null
        : null;
    const timestampIso = tripTimestampIso ?? paymentGroup.timestampIso ?? null;
    const areaHint =
      resolveAreaHintFromTripRow(tripRow, fieldMapping) ??
      mapCityNameToAreaLabel(paymentGroup.cityName);
    const durationSeconds = parseDurationSecondsValue(
      durationField
        ? tripRow?.[durationField]
        : getRowValueByAliases(tripRow, [
            "trip_duration_seconds",
            "duration_seconds",
            "trip_duration",
            "duration",
            "time",
          ]),
    );
    const distanceMiles = parseDistanceMilesValue(
      distanceField
        ? tripRow?.[distanceField]
        : getRowValueByAliases(tripRow, [
            "trip_distance_miles",
            "distance_miles",
            "trip_distance",
            "distance",
            "distance_km",
          ]),
    );
    const tripStatus =
      (tripStatusField
        ? tripRow?.[tripStatusField]
        : getRowValueByAliases(tripRow, ["status", "trip_status", "state"])) ?? null;

    const candidate = buildCandidateFromValues({
      sourceType: tripRow ? "trip+payment" : "payment-only",
      tripUuid: tripUuid ?? (tripRow ? tripRowMeta.get(tripRow)?.tripUuid ?? null : null),
      timestampIso,
      estimatedEarnings: paymentGroup.financialTotal ?? null,
      areaHint,
      durationSeconds,
      distanceMiles,
      tripStatus,
      alreadyCovered: false,
      coverageKey: normalizeTimestampKey(timestampIso),
    });
    if (!candidate) {
      continue;
    }
    if (tripRow) {
      joinedTripPaymentCandidates += 1;
    } else {
      paymentOnlyCandidates += 1;
      candidate.joinFailureReason = tripUuid
        ? (joinedVia === "timestamp_fallback" ? null : "uuid_or_timestamp_join_failed")
        : "missing_trip_uuid_and_no_timestamp_join";
    }
    if (joinedVia === "timestamp_fallback") {
      candidate.joinedVia = joinedVia;
    }
    candidates.push(candidate);
  }

  for (const tripRow of safeTripRows) {
    if (usedTripRows.has(tripRow)) {
      continue;
    }
    const tripMeta = tripRowMeta.get(tripRow) ?? {};
    const timestampIso = tripMeta.requestTimestampIso ?? null;
    const tripUuid = tripMeta.tripUuid ?? null;
    const durationSeconds = parseDurationSecondsValue(
      durationField
        ? tripRow?.[durationField]
        : getRowValueByAliases(tripRow, [
            "trip_duration_seconds",
            "duration_seconds",
            "trip_duration",
            "duration",
            "time",
          ]),
    );
    const distanceMiles = parseDistanceMilesValue(
      distanceField
        ? tripRow?.[distanceField]
        : getRowValueByAliases(tripRow, [
            "trip_distance_miles",
            "distance_miles",
            "trip_distance",
            "distance",
            "distance_km",
          ]),
    );
    const tripStatus =
      (tripStatusField
        ? tripRow?.[tripStatusField]
        : getRowValueByAliases(tripRow, ["status", "trip_status", "state"])) ?? null;
    const areaHint = resolveAreaHintFromTripRow(tripRow, fieldMapping);
    const candidate = buildCandidateFromValues({
      sourceType: "trip-only",
      tripUuid,
      timestampIso,
      estimatedEarnings: null,
      areaHint,
      durationSeconds,
      distanceMiles,
      tripStatus,
      alreadyCovered: false,
      coverageKey: normalizeTimestampKey(timestampIso),
    });
    if (!candidate) {
      continue;
    }
    candidate.joinFailureReason = "no_payment_group_for_trip";
    tripOnlyCandidates += 1;
    candidates.push(candidate);
  }

  const sampleCandidates = candidates.slice(0, 10).map((candidate) => ({
    tripUuid: candidate.tripUuid ?? null,
    timestamp: candidate.tripRequestTimestamp ?? null,
    groupedEarningsTotal: candidate.estimatedEarnings ?? null,
    durationSeconds: candidate.durationSeconds ?? null,
    distanceMiles: candidate.distanceMiles ?? null,
    tripStatus: candidate.tripStatus ?? null,
    areaHint: candidate.areaHint ?? null,
    sourceType: candidate.sourceType ?? null,
  }));

  return {
    candidates,
    stats: {
      totalTripsParsed: safeTripRows.length,
      totalPaymentGroupsParsed: paymentsGrouped.length,
      tripsWithUuid,
      tripsWithTimestamp,
      paymentGroupsWithUuid,
      joinedTripPaymentCandidates,
      paymentOnlyCandidates,
      tripOnlyCandidates,
      joinFailureReasons,
      candidatesConsidered,
      candidatesOutsideAnalyticsWindow,
      candidatesInsideAnalyticsWindow,
      candidatesEligibleForTimeline: candidates.length,
      candidatesAlreadyCovered,
      candidatesWithDuration,
      candidatesWithDistance,
      candidatesWithAreaHint,
      fieldMapping,
      tripHeadersFound: tripHeaders ?? [],
      sampleCandidates,
    },
  };
}

function buildStatusPayload(record) {
  const stageProgress = {
    created: 5,
    uploading: 20,
    uploaded: 40,
    parsing: 50,
    validating: 60,
    matching: 80,
    enriching: 90,
    completed: 100,
    failed: 100,
  };

  const stage = record.stage || "created";
  const progressPercent =
    typeof record.progressPercent === "number"
      ? record.progressPercent
      : (stageProgress[stage] ?? 0);

  const defaultSummary = {
    tripsFileFound: false,
    paymentsFileFound: false,
    analyticsFileFound: false,
    ignoredFilesCount: 0,
    tripsRowCount: 0,
    paymentsRowCount: 0,
    analyticsRowCount: 0,
    tripsDateRange: null,
    paymentsDateRange: null,
    analyticsDateRange: null,
    matchedTrips: 9500,
    unmatchedTrips: 120,
    unmatchedPayments: 45,
    ambiguousMatches: 8,
    reimbursementsDetected: 27.5,
    analyticsCoverageRange: {
      startAt: "2026-03-01T00:00:00.000Z",
      endAt: "2026-03-31T23:59:59.000Z",
    },
    geoEligibleTrips: 0,
    geoLinkedTrips: 0,
    notGeoEligibleTrips: 0,
    groupedTripsMatchedToPayments: 0,
    unmatchedTripsInWindow: 0,
    unmatchedPaymentGroupsInWindow: 0,
    eligibleEarningsTotal: 0,
    linkedEarningsTotal: 0,
    earningsCoveragePercent: 0,
    earningsCoverageTier: "Needs review",
    sequenceQuickWinsCount: 0,
    reviewSuggestions: [],
    coverageSuggestions: [],
    historySuggestions: [],
    sequenceSuggestions: [],
    geoLinkedDatasetSample: [],
    unifiedDecisionDatasetSize: 0,
    unifiedRecentVerifiedRows: 0,
    unifiedHistoricalBackfillRows: 0,
    heatmapReady: false,
    unifiedDecisionSample: [],
    locationEnrichedTrips: 3012,
  };

  const summary = {
    ...defaultSummary,
    ...(record.summary ?? {}),
  };
  if (!Array.isArray(summary.reviewSuggestions) && Array.isArray(summary.sequenceSuggestions)) {
    summary.reviewSuggestions = summary.sequenceSuggestions;
  }
  if (!Array.isArray(summary.coverageSuggestions) || !Array.isArray(summary.historySuggestions)) {
    const split = splitReviewSuggestions(summary.reviewSuggestions ?? []);
    summary.coverageSuggestions = split.coverageSuggestions;
    summary.historySuggestions = split.historySuggestions;
  }

  return {
    importId: record.importId,
    userId: "local-user",
    provider: "uber",
    sourceFileName: record.sourceFileName || "Uber Data Request 7711226E.zip",
    selectedFileName: record.sourceFileName || "Uber Data Request 7711226E.zip",
    objectKey: `local-user/imports/uber/${record.importId}/${record.sourceFileName || "Uber Data Request 7711226E.zip"}`,
    stage,
    status: stage,
    startedAt: record.startedAt || nowIso(),
    updatedAt: nowIso(),
    finishedAt: stage === "completed" ? nowIso() : null,
    progressPercent,
    stageTimings: [],
    summary,
    diagnostics: {
      rowsParsed: {
        trips: summary.tripsRowCount ?? 0,
        payments: summary.paymentsRowCount ?? 0,
        analytics: summary.analyticsRowCount ?? 0,
      },
      matchesCreated: 9500,
      analyticsCoverage: "partial",
      failureReason: null,
    },
    warnings: [],
    errors: [],
  };
}

app.get("/", (req, res) => {
  res.send("Driver Toolkit backend running");
});
app.use("/admin/signals", express.static(path.join(__dirname, "admin", "signals")));

app.use(
  "/api/imports",
  requireFeatureEnabled(
    "uploads",
    "Upload/import processing is deferred from Driver Toolkit v1 while real-time signal intelligence is prioritized.",
  ),
);
app.use(
  "/api/timeline",
  requireFeatureEnabled(
    "uploads",
    "Timeline historical upload is deferred from Driver Toolkit v1 while real-time signal intelligence is prioritized.",
  ),
);
app.use(
  "/api/storage/timeline-upload",
  requireFeatureEnabled(
    "uploads",
    "Timeline raw upload is deferred from Driver Toolkit v1 while real-time signal intelligence is prioritized.",
  ),
);
app.use(
  "/api/translink",
  requireFeatureEnabled(
    "translinkSignals",
    "Translink rail signals are currently disabled.",
  ),
);
app.use(
  "/api/smart-diary",
  requireFeatureEnabled(
    "smartDiary",
    "Smart Diary signal engine is currently disabled.",
  ),
);
app.use(
  "/api/signals",
  requireFeatureEnabled(
    "smartDiary",
    "Unified signal platform is currently disabled.",
  ),
);

app.post("/api/imports/session", (req, res) => {
  const importId = "import_" + Date.now();

  const record = {
    importId,
    stage: "created",
    progressPercent: 5,
    startedAt: nowIso(),
    sourceFileName: "Uber Data Request 7711226E.zip",
    uploaded: false,
  };

  imports.set(importId, record);

  res.json({
    importId,
    uploadUrl: `${PUBLIC_BASE_URL}/api/imports/${importId}/upload`,
    objectKey: `local-user/imports/uber/${importId}/${record.sourceFileName}`,
  });
});

app.put(
  "/api/imports/:importId/upload",
  express.raw({ type: "*/*", limit: "200mb" }),
  (req, res) => {
    const { importId } = req.params;
    const record = imports.get(importId);

    if (!record) {
      return res.status(404).json({ error: "Import session not found" });
    }

    record.uploaded = true;
    record.stage = "uploaded";
    record.progressPercent = 40;
    record.bytesReceived = req.body ? req.body.length : 0;
    const zipPath = path.join(uploadsDir, `${importId}.zip`);
    fs.writeFileSync(zipPath, req.body);
    record.uploadPath = zipPath;
    record.updatedAt = nowIso();

    imports.set(importId, record);

    res.status(200).send("OK");
  }
);

app.post("/api/imports/:importId/confirm", (req, res) => {
  const { importId } = req.params;
  const record = imports.get(importId);
  let stageReached = "start";

  if (!record) {
    return res.status(404).json({ error: "Import session not found" });
  }

  try {
    const zipPath = record.uploadPath || path.join(uploadsDir, `${importId}.zip`);
    console.log(`[IMPORT][confirm] uploadPath=${zipPath}`);
    if (!fs.existsSync(zipPath)) {
      return res.status(400).json({ error: "Uploaded ZIP not found on disk." });
    }

    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
    const entryNames = entries.map((entry) => entry.entryName);
    const names = entryNames.map((entryName) => entryName.toLowerCase());
    console.log(`[IMPORT][confirm] entries=${JSON.stringify(entryNames)}`);

    const tripsMatch = pickBestEntryName(entryNames, {
      prefer: ["driver_lifetime_trips"],
      fallback: ["driver/trips", "driver_trips", "driver trips", "trips"],
      exclude: ["rider", "account and profile", "account/profile"],
    });
    const paymentsMatch = pickBestEntryName(entryNames, {
      prefer: ["driver_payments"],
      fallback: ["driver/payment", "driver_payment"],
      exclude: [
        "payment_methods",
        "payment-methods",
        "account and profile",
        "account/profile",
        "rider",
      ],
    });
    const analyticsMatch = pickBestEntryName(entryNames, {
      prefer: ["driver_app_analytics"],
      fallback: ["driver/analytics", "driver_analytics", "driver_earnings"],
      exclude: ["rider_app_analytics", "rider", "account and profile", "account/profile"],
    });

    const tripsEntryName = tripsMatch.selected;
    const paymentsEntryName = paymentsMatch.selected;
    const analyticsEntryName = analyticsMatch.selected;

    const tripsFileFound = Boolean(tripsEntryName);
    const paymentsFileFound = Boolean(paymentsEntryName);
    const analyticsFileFound = Boolean(analyticsEntryName);

    console.log(
      `[IMPORT][confirm] candidates trips=${JSON.stringify(tripsMatch.candidates)}`
    );
    console.log(
      `[IMPORT][confirm] candidates payments=${JSON.stringify(paymentsMatch.candidates)}`
    );
    console.log(
      `[IMPORT][confirm] candidates analytics=${JSON.stringify(analyticsMatch.candidates)}`
    );
    console.log(`[IMPORT][confirm] detected trips=${tripsEntryName}`);
    console.log(`[IMPORT][confirm] detected payments=${paymentsEntryName}`);
    console.log(`[IMPORT][confirm] detected analytics=${analyticsEntryName}`);

    const selectedSet = new Set(
      [tripsEntryName, paymentsEntryName, analyticsEntryName].filter(Boolean)
    );
    const ignoredFilesCount = entryNames.filter((name) => {
      return !selectedSet.has(name);
    }).length;
    console.log(`[IMPORT][confirm] ignoredFilesCount=${ignoredFilesCount}`);
    stageReached = "detection_complete";
    console.log("[IMPORT][confirm] stage=detection_complete");

    stageReached = "csv_extract_start";
    console.log("[IMPORT][confirm] stage=csv_extract_start");
    const tripsSummary = summarizeCsvEntry(
      zip,
      tripsEntryName,
      "request_timestamp_local"
    );
    const paymentsSummary = summarizeCsvEntry(
      zip,
      paymentsEntryName,
      "local_timestamp"
    );
    const analyticsSummary = summarizeCsvEntry(
      zip,
      analyticsEntryName,
      "event_time_utc",
      ["event_time_utc", "event_time_utc_", "event_time"]
    );
    stageReached = "csv_extract_complete";
    console.log("[IMPORT][confirm] stage=csv_extract_complete");

    const matchingSummary = computeFirstPassMatchingSummary(
      importId,
      tripsSummary.dataRows,
      paymentsSummary.dataRows,
      tripsSummary.timestampFieldUsed,
      paymentsSummary.timestampFieldUsed,
      analyticsSummary.dataRows,
      analyticsSummary.timestampFieldUsed,
      tripsSummary.headers,
      paymentsSummary.headers
    );
    stageReached = "parse_complete";
    console.log("[IMPORT][confirm] stage=parse_complete");

    console.log(
      `[IMPORT][confirm] csv trips rowCount=${tripsSummary.rowCount} timestampField=${tripsSummary.timestampFieldUsed} dateRange=${JSON.stringify(tripsSummary.dateRange)}`
    );
    console.log(
      `[IMPORT][confirm] csv payments rowCount=${paymentsSummary.rowCount} timestampField=${paymentsSummary.timestampFieldUsed} dateRange=${JSON.stringify(paymentsSummary.dateRange)}`
    );
    console.log(
      `[IMPORT][confirm] csv analytics rowCount=${analyticsSummary.rowCount} timestampField=${analyticsSummary.timestampFieldUsed} dateRange=${JSON.stringify(analyticsSummary.dateRange)}`
    );
    if (analyticsSummary.timestampFieldUsed) {
      console.log(
        `[IMPORT][confirm] analytics timestamp detected=${analyticsSummary.timestampFieldUsed}`
      );
    }
    stageReached = "date_ranges_complete";
    console.log("[IMPORT][confirm] stage=date_ranges_complete");
    console.log(`[IMPORT][confirm] matching-mode=${matchingSummary.matchingMode}`);
    console.log(
      `[IMPORT][confirm] analyticsCoverageStart=${matchingSummary.analyticsCoverageRange?.startAt ?? "null"} analyticsCoverageEnd=${matchingSummary.analyticsCoverageRange?.endAt ?? "null"}`
    );
    console.log(
      `[IMPORT][confirm] tripsInAnalyticsWindow=${matchingSummary.diagnostics.tripsInAnalyticsWindow ?? 0} paymentGroupsInAnalyticsWindow=${matchingSummary.diagnostics.paymentGroupsInAnalyticsWindow ?? 0} groupedTripsMatchedToPayments=${matchingSummary.diagnostics.groupedTripsMatchedToPayments ?? 0}`
    );
    console.log(
      `[IMPORT][confirm] geoLinkedTrips=${matchingSummary.geoLinkedTrips ?? 0} nearestAnalyticsToleranceSeconds=${matchingSummary.toleranceUsedSeconds ?? 60}`
    );
    console.log(
      `[IMPORT][confirm] earningsCoveragePercent=${matchingSummary.earningsCoveragePercent ?? 0} earningsCoverageTier=${matchingSummary.earningsCoverageTier ?? "Needs review"} sequenceQuickWins=${matchingSummary.sequenceQuickWinsCount ?? 0}`
    );
    console.log(
      `[IMPORT][confirm] linkedRecordCount=${matchingSummary.geoLinkedDataset?.length ?? 0} geoLinkedDatasetSampleCount=${Math.min(5, matchingSummary.geoLinkedDataset?.length ?? 0)}`
    );
    console.log(
      `[IMPORT][confirm] matching tripsConsidered=${matchingSummary.diagnostics.tripsConsidered} paymentsConsidered=${matchingSummary.diagnostics.paymentsConsidered} tripTimestampField=${tripsSummary.timestampFieldUsed} paymentTimestampField=${paymentsSummary.timestampFieldUsed}`
    );
    console.log(
      `[IMPORT][confirm] matching uuidMatchedTrips=${matchingSummary.diagnostics.uuidMatchedTrips ?? 0} uuidMissingTrips=${matchingSummary.diagnostics.uuidMissingTrips ?? 0} tripUuidField=${matchingSummary.diagnostics.tripUuidFieldUsed ?? "null"} paymentUuidField=${matchingSummary.diagnostics.paymentUuidFieldUsed ?? "null"}`
    );
    console.log(
      `[IMPORT][confirm] matching matchedTrips=${matchingSummary.matchedTrips} unmatchedTrips=${matchingSummary.unmatchedTrips} unmatchedPayments=${matchingSummary.unmatchedPayments} ambiguousMatches=${matchingSummary.ambiguousMatches}`
    );
    stageReached = "matching_complete";
    console.log("[IMPORT][confirm] stage=matching_complete");

    record.summary = {
      ...(record.summary ?? {}),
      tripsFileFound,
      paymentsFileFound,
      analyticsFileFound,
      ignoredFilesCount,
      tripsRowCount: tripsSummary.rowCount,
      paymentsRowCount: paymentsSummary.rowCount,
      analyticsRowCount: analyticsSummary.rowCount,
      tripsDateRange: tripsSummary.dateRange,
      paymentsDateRange: paymentsSummary.dateRange,
      analyticsDateRange: analyticsSummary.dateRange,
      matchedTrips: matchingSummary.matchedTrips,
      unmatchedTrips: matchingSummary.unmatchedTrips,
      unmatchedPayments: matchingSummary.unmatchedPayments,
      ambiguousMatches: matchingSummary.ambiguousMatches,
      analyticsCoverageRange: matchingSummary.analyticsCoverageRange,
      geoLinkedTrips: matchingSummary.geoLinkedTrips,
      geoEligibleTrips: matchingSummary.geoEligibleTrips ?? 0,
      notGeoEligibleTrips: matchingSummary.notGeoEligibleTrips ?? 0,
      groupedTripsMatchedToPayments:
        matchingSummary.groupedTripsMatchedToPayments ?? 0,
      unmatchedTripsInWindow: matchingSummary.unmatchedTripsInWindow ?? 0,
      unmatchedPaymentGroupsInWindow:
        matchingSummary.unmatchedPaymentGroupsInWindow ?? 0,
      eligibleEarningsTotal: matchingSummary.eligibleEarningsTotal ?? 0,
      linkedEarningsTotal: matchingSummary.linkedEarningsTotal ?? 0,
      earningsCoveragePercent: matchingSummary.earningsCoveragePercent ?? 0,
      earningsCoverageTier: matchingSummary.earningsCoverageTier ?? "Needs review",
      sequenceQuickWinsCount: matchingSummary.sequenceQuickWinsCount ?? 0,
      reviewSuggestions: (matchingSummary.reviewSuggestions ?? []).slice(0, 25),
      coverageSuggestions: (matchingSummary.coverageSuggestions ?? []).slice(0, 25),
      historySuggestions: (matchingSummary.historySuggestions ?? []).slice(0, 25),
      sequenceSuggestions: (matchingSummary.reviewSuggestions ?? []).slice(0, 25),
      geoLinkedDatasetSample: (matchingSummary.geoLinkedDataset ?? []).slice(0, 5),
      parsedFileDetails: {
        trips: {
          selectedFileName: tripsEntryName,
          headers: tripsSummary.headers,
          timestampFieldUsed: tripsSummary.timestampFieldUsed,
          sampleRows: tripsSummary.sampleRows,
        },
        payments: {
          selectedFileName: paymentsEntryName,
          headers: paymentsSummary.headers,
          timestampFieldUsed: paymentsSummary.timestampFieldUsed,
          sampleRows: paymentsSummary.sampleRows,
        },
        analytics: {
          selectedFileName: analyticsEntryName,
          headers: analyticsSummary.headers,
          timestampFieldUsed: analyticsSummary.timestampFieldUsed,
          sampleRows: analyticsSummary.sampleRows,
        },
      },
    };
    stageReached = "summary_written";
    console.log("[IMPORT][confirm] stage=summary_written");
    console.log(
      `[IMPORT][confirm] summary=${JSON.stringify(record.summary)}`
    );

    record.linkedDatasetArtifactPath = persistLinkedDatasetArtifact(
      importId,
      matchingSummary.geoLinkedDataset ?? [],
      record.summary
    );
    const latestTimelineInferred = findLatestTimelineInferredForImport(importId);
    const unifiedDataset = buildUnifiedDecisionDataset(
      importId,
      matchingSummary.geoLinkedDataset ?? [],
      latestTimelineInferred?.inferredMatches ?? [],
      [],
    );
    record.unifiedDecisionArtifactPath = persistUnifiedDecisionArtifact(
      importId,
      unifiedDataset,
    );
    record.heatmapCoverageArtifactPath = persistHeatmapCoverageArtifact(
      importId,
      buildHeatmapCoverageArtifact(importId, unifiedDataset),
    );
    record.summary = hydrateUnifiedSummaryFromArtifact(record.summary, unifiedDataset);

    record.stage = "parsing";
    record.progressPercent = 50;
    record.updatedAt = nowIso();

    imports.set(importId, record);
    stageReached = "response_ready";
    console.log("[IMPORT][confirm] stage=response_ready");

    return res.json({
      ok: true,
      status: "parsing",
      summary: record.summary,
    });
  } catch (error) {
    record.stage = "failed";
    record.progressPercent = 100;
    record.updatedAt = nowIso();
    record.errors = [
      error instanceof Error ? error.message : "ZIP detection failed.",
    ];
    imports.set(importId, record);
    console.error(
      `[IMPORT][confirm][error] importId=${importId} stage=${stageReached} message=${error instanceof Error ? error.message : "confirm_failed"}`
    );
    console.error(
      `[IMPORT][confirm][error] stack=${error instanceof Error && error.stack ? error.stack : "no_stack"}`
    );
    return res.status(500).json({
      error: "confirm_failed",
      message: "Import confirmation failed during backend processing.",
      stage: stageReached,
    });
  }
});

app.post("/api/imports/:importId/manual-confirm", (req, res) => {
  const { importId } = req.params;
  const suggestionLinkedTripId = req.body?.suggestionLinkedTripId ?? null;
  const confirmationSource = req.body?.confirmationSource ?? "improve-coverage";

  if (!suggestionLinkedTripId) {
    return res.status(400).json({
      ok: false,
      error: "suggestion_linked_trip_id_required",
    });
  }

  const artifactResult = loadLinkedDatasetArtifact(importId);
  if (!artifactResult) {
    return res.status(404).json({
      ok: false,
      error: "linked_dataset_not_found",
      message: "No linked dataset artifact found for this import.",
    });
  }

  const record = imports.get(importId) ?? {
    importId,
    summary: artifactResult.payload?.summary ?? {},
    linkedDatasetArtifactPath: artifactResult.artifactPath,
  };
  const currentSummary = record.summary ?? artifactResult.payload?.summary ?? {};
  const reviewSuggestions = Array.isArray(currentSummary.reviewSuggestions)
    ? currentSummary.reviewSuggestions
    : Array.isArray(currentSummary.sequenceSuggestions)
      ? currentSummary.sequenceSuggestions
    : [];
  const suggestionIndex = reviewSuggestions.findIndex(
    (item) => item.linkedTripId === suggestionLinkedTripId
  );
  if (suggestionIndex === -1) {
    return res.status(404).json({
      ok: false,
      error: "suggestion_not_found",
      message: "Suggested match was not found in this import summary.",
    });
  }

  const suggestion = reviewSuggestions[suggestionIndex];
  const hasPaymentCandidate = Boolean(
    suggestion.hasPaymentCandidate || suggestion.topCandidates?.paymentGroupTripUuid
  );
  const hasLocationPath = Boolean(
    suggestion.hasLocationPath || suggestion.topCandidates?.analyticsEventTimestamp
  );
  if (!hasPaymentCandidate || !hasLocationPath) {
    return res.status(409).json({
      ok: false,
      error: "suggestion_not_geo_financial_eligible",
      message:
        "This item cannot be confirmed because it does not have both earnings and location linkage.",
    });
  }
  const linkedRecords = Array.isArray(artifactResult.payload?.linkedRecords)
    ? artifactResult.payload.linkedRecords
    : [];
  const existingIndex = linkedRecords.findIndex(
    (item) => item.linkedTripId === suggestionLinkedTripId
  );

  const manualRecord = {
    linkedTripId: suggestionLinkedTripId,
    sourceImportId: importId,
    provider: "uber",
    matchMode: "payment_group_timestamp",
    matchMethod: "manual-confirmed",
    priorMatchMethod: suggestion.autoAccepted
      ? "direct-timestamp+sequence"
      : "direct-timestamp",
    suggestionReason: suggestion.reason ?? "Between two confirmed trips",
    sequenceSupport: true,
    previousConfirmedTripId: suggestion.previousConfirmedTripId ?? null,
    nextConfirmedTripId: suggestion.nextConfirmedTripId ?? null,
    candidateCountInInterval: suggestion.candidateCountInInterval ?? 0,
    autoAccepted: false,
    matchConfidence: suggestion.matchConfidence ?? "review",
    confirmedAt: nowIso(),
    confirmationSource,
    toleranceUsedSeconds: 60,
    geoEligible: true,
    geoEligibilityReason: "inside_analytics_window",
    locationLinked: true,
    geoSource: "uber_analytics",
    trip: {
      requestTimestamp: suggestion.tripRequestTimestamp ?? null,
      beginTimestamp: null,
      dropoffTimestamp: null,
      status: null,
      productName: null,
      distanceMiles: null,
      durationSeconds: null,
      currencyCode: null,
      vehicleUuid: null,
      licensePlate: null,
    },
    paymentGroup: {
      tripUuid: suggestion.topCandidates?.paymentGroupTripUuid ?? null,
      groupedTimestamp: null,
      currencyCode: null,
      rowCount: 1,
      financialTotal:
        suggestion.topCandidates?.suggestedFinancialTotal == null
          ? null
          : Number(suggestion.topCandidates?.suggestedFinancialTotal),
      rawClassifications: [],
      rawCategories: [],
    },
    analytics: {
      eventTimestamp: suggestion.topCandidates?.analyticsEventTimestamp ?? null,
      eventType: null,
      latitude: null,
      longitude: null,
      speedGps: null,
      city: null,
      driverOnline: null,
    },
    location: {
      lat: null,
      lng: null,
      source: "driver_app_analytics",
      resolvedAreaLabel: null,
      locationConfidence:
        suggestion.matchConfidence === "high"
          ? "high"
          : suggestion.matchConfidence === "medium"
            ? "medium"
            : "low",
    },
    flags: {
      hasTrip: true,
      hasPaymentGroup: true,
      hasAnalytics: true,
      insideAnalyticsWindow: true,
      timestampAligned: true,
      requiresReview: false,
    },
  };

  if (existingIndex >= 0) {
    linkedRecords[existingIndex] = {
      ...linkedRecords[existingIndex],
      ...manualRecord,
    };
  } else {
    linkedRecords.push(manualRecord);
  }

  const updatedSuggestions = reviewSuggestions.map((item, index) =>
    index === suggestionIndex
      ? {
          ...item,
          manualConfirmed: true,
          confirmedAt: nowIso(),
          confirmationSource,
        }
      : item
  );

  const coverageBefore = Number(currentSummary.earningsCoveragePercent ?? 0);
  const nextSummary = recomputeCoverageSummary(
    {
      ...currentSummary,
      reviewSuggestions: updatedSuggestions,
      sequenceSuggestions: updatedSuggestions,
      unmatchedTripsInWindow: Math.max(
        0,
        Number(currentSummary.unmatchedTripsInWindow ?? 0) - 1
      ),
      unmatchedPaymentGroupsInWindow: Math.max(
        0,
        Number(currentSummary.unmatchedPaymentGroupsInWindow ?? 0) -
          (suggestion.topCandidates?.paymentGroupTripUuid ? 1 : 0)
      ),
      geoLinkedDatasetSample: linkedRecords.slice(0, 5),
    },
    linkedRecords
  );
  const nextSplit = splitReviewSuggestions(nextSummary.reviewSuggestions ?? []);
  nextSummary.coverageSuggestions = nextSplit.coverageSuggestions;
  nextSummary.historySuggestions = nextSplit.historySuggestions;
  nextSummary.sequenceSuggestions = nextSummary.reviewSuggestions;
  const coverageAfter = Number(nextSummary.earningsCoveragePercent ?? 0);
  const coverageChanged = coverageAfter > coverageBefore;

  const payload = {
    ...(artifactResult.payload ?? {}),
    persistedAt: nowIso(),
    summary: nextSummary,
    linkedRecordCount: linkedRecords.length,
    linkedRecords,
  };
  fs.writeFileSync(
    artifactResult.artifactPath,
    JSON.stringify(payload, null, 2),
    "utf8"
  );
  const latestTimelineInferred = findLatestTimelineInferredForImport(importId);
  const unifiedDataset = buildUnifiedDecisionDataset(
    importId,
    linkedRecords,
    latestTimelineInferred?.inferredMatches ?? [],
    [],
  );
  record.unifiedDecisionArtifactPath = persistUnifiedDecisionArtifact(
    importId,
    unifiedDataset,
  );
  record.heatmapCoverageArtifactPath = persistHeatmapCoverageArtifact(
    importId,
    buildHeatmapCoverageArtifact(importId, unifiedDataset),
  );
  const nextSummaryWithUnified = hydrateUnifiedSummaryFromArtifact(nextSummary, unifiedDataset);

  record.summary = nextSummaryWithUnified;
  record.linkedDatasetArtifactPath = artifactResult.artifactPath;
  record.updatedAt = nowIso();
  imports.set(importId, record);

  return res.json({
    ok: true,
    importId,
    coverageBefore,
    coverageAfter,
    coverageChanged,
    hasPaymentCandidate,
    hasLocationPath,
    confirmationMessage: coverageChanged
      ? `Coverage improved: ${coverageBefore.toFixed(1)}% -> ${coverageAfter.toFixed(1)}%`
      : "Coverage unchanged after confirmation.",
    confirmationNote: null,
    summary: nextSummaryWithUnified,
    confirmedRecord: manualRecord,
  });
});

app.get("/api/imports/:importId/status", (req, res) => {
  const { importId } = req.params;
  const record = imports.get(importId);

  if (!record) {
    return res.status(404).json({ error: "Import session not found" });
  }

  if (record.stage === "parsing") {
    record.stage = "matching";
    record.progressPercent = 80;
  } else if (record.stage === "matching") {
    record.stage = "enriching";
    record.progressPercent = 90;
  } else if (record.stage === "enriching") {
    record.stage = "completed";
    record.progressPercent = 100;
  }

  record.updatedAt = nowIso();
  imports.set(importId, record);

  res.json(buildStatusPayload(record));
});

app.get("/api/imports/latest/unified-decision-dataset", (req, res) => {
  const latestCompleted = Array.from(imports.values())
    .filter((item) => item.stage === "completed")
    .sort((a, b) => Date.parse(b.updatedAt ?? b.startedAt ?? nowIso()) - Date.parse(a.updatedAt ?? a.startedAt ?? nowIso()))[0];
  if (!latestCompleted) {
    return res.status(404).json({ error: "No completed import found." });
  }
  const unified = loadUnifiedDecisionArtifact(latestCompleted.importId);
  if (!unified) {
    return res.status(404).json({ error: "Unified decision dataset not found." });
  }
  return res.json(unified.payload);
});

app.get("/api/imports/:importId/unified-decision-dataset", (req, res) => {
  const { importId } = req.params;
  const unified = loadUnifiedDecisionArtifact(importId);
  if (!unified) {
    return res.status(404).json({ error: "Unified decision dataset not found." });
  }
  return res.json(unified.payload);
});

app.get("/api/imports/latest/heatmap-coverage", (req, res) => {
  const latestCompleted = Array.from(imports.values())
    .filter((item) => item.stage === "completed")
    .sort(
      (a, b) =>
        Date.parse(b.updatedAt ?? b.startedAt ?? nowIso()) -
        Date.parse(a.updatedAt ?? a.startedAt ?? nowIso()),
    )[0];
  if (!latestCompleted) {
    return res.status(404).json({ error: "No completed import found." });
  }
  const coverage = ensureHeatmapCoverageArtifact(latestCompleted.importId);
  if (!coverage) {
    return res.status(404).json({ error: "Heatmap coverage artifact not found." });
  }
  return res.json(coverage.payload);
});

app.get("/api/imports/:importId/heatmap-coverage", (req, res) => {
  const { importId } = req.params;
  const coverage = ensureHeatmapCoverageArtifact(importId);
  if (!coverage) {
    return res.status(404).json({ error: "Heatmap coverage artifact not found." });
  }
  return res.json(coverage.payload);
});

app.post("/api/timeline/upload-session", (req, res) => {
  const timelineImportId = `timeline_${Date.now()}`;
  const sourceFileName = req.body?.sourceFileName ?? "timeline.json";
  const safeName = sanitizeStorageSegment(sourceFileName || "timeline.json");
  const fileKey = `timeline/${timelineImportId}/${safeName || "timeline.json"}`;
  const uploadToken = `upload_${timelineImportId}_${Date.now()}`;
  const record = {
    timelineImportId,
    importId: req.body?.importId ?? null,
    sourceFileName,
    fileKey,
    uploadToken,
    stage: "created",
    startedAt: nowIso(),
    progressPercent: 5,
    processed: false,
    summary: null,
  };
  timelineImports.set(timelineImportId, record);
  res.json({
    timelineImportId,
    uploadUrl: `${PUBLIC_BASE_URL}/api/storage/timeline-upload/${uploadToken}`,
    fileKey,
  });
});

// Backward compatibility alias for older clients.
app.post("/api/timeline/session", (req, res) => {
  const timelineImportId = `timeline_${Date.now()}`;
  const sourceFileName = req.body?.sourceFileName ?? "timeline.json";
  const safeName = sanitizeStorageSegment(sourceFileName || "timeline.json");
  const fileKey = `timeline/${timelineImportId}/${safeName || "timeline.json"}`;
  const uploadToken = `upload_${timelineImportId}_${Date.now()}`;
  const record = {
    timelineImportId,
    importId: req.body?.importId ?? null,
    sourceFileName,
    fileKey,
    uploadToken,
    stage: "created",
    startedAt: nowIso(),
    progressPercent: 5,
    processed: false,
    summary: null,
  };
  timelineImports.set(timelineImportId, record);
  res.json({
    timelineImportId,
    uploadUrl: `${PUBLIC_BASE_URL}/api/storage/timeline-upload/${uploadToken}`,
    fileKey,
    processUrl: `${PUBLIC_BASE_URL}/api/timeline/${timelineImportId}/process`,
    statusUrl: `${PUBLIC_BASE_URL}/api/timeline/${timelineImportId}/status`,
  });
});

app.put("/api/storage/timeline-upload/:uploadToken", async (req, res) => {
  const { uploadToken } = req.params;
  console.log(`[TIMELINE][upload] route-hit token=${uploadToken}`);

  const record = Array.from(timelineImports.values()).find(
    (item) => item.uploadToken === uploadToken,
  );
  if (!record) {
    return res.status(404).json({ error: "Timeline upload session not found" });
  }

  const storagePath = resolveStoragePathForFileKey(record.fileKey);
  if (!storagePath) {
    return res.status(400).json({ error: "Invalid timeline storage key" });
  }

  try {
    fs.mkdirSync(path.dirname(storagePath), { recursive: true });
    let bytes = 0;
    let nextProgressLogAt = 5 * 1024 * 1024;
    req.on("error", (error) => {
      console.log(
        `[TIMELINE][upload] request-error token=${uploadToken} bytes=${bytes} error=${error instanceof Error ? error.message : "unknown"}`,
      );
    });
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes >= nextProgressLogAt) {
        console.log(`[TIMELINE][upload] bytes-received=${bytes} token=${uploadToken}`);
        nextProgressLogAt += 5 * 1024 * 1024;
      }
    });
    req.on("end", () => {
      console.log(`[TIMELINE][upload] request-end bytes=${bytes} token=${uploadToken}`);
    });
    req.on("close", () => {
      console.log(`[TIMELINE][upload] request-close bytes=${bytes} token=${uploadToken}`);
    });
    req.on("aborted", () => {
      console.log(`[TIMELINE][upload] request-aborted bytes=${bytes} token=${uploadToken}`);
    });
    console.log(`[TIMELINE][upload] streaming-start token=${uploadToken}`);
    const writeStream = fs.createWriteStream(storagePath);
    writeStream.on("finish", () => {
      console.log(`[TIMELINE][upload] write-finish bytes=${bytes} token=${uploadToken}`);
    });
    writeStream.on("close", () => {
      console.log(`[TIMELINE][upload] write-close bytes=${bytes} token=${uploadToken}`);
    });
    writeStream.on("error", (error) => {
      console.log(
        `[TIMELINE][upload] write-error token=${uploadToken} bytes=${bytes} error=${error instanceof Error ? error.message : "unknown"}`,
      );
    });
    await pipeline(req, writeStream);
    console.log(`[TIMELINE][upload] streaming-complete bytes=${bytes}`);
    console.log(`[TIMELINE][upload] storedPath=${storagePath}`);

    record.uploadPath = storagePath;
    record.stage = "uploaded";
    record.progressPercent = 35;
    record.updatedAt = nowIso();
    timelineImports.set(record.timelineImportId, record);
    return res.status(200).send("OK");
  } catch (error) {
    console.log(
      `[TIMELINE][upload] streaming-fail token=${uploadToken} error=${error instanceof Error ? error.message : "unknown"}`,
    );
    return res.status(500).json({ error: "Timeline upload failed" });
  }
});

app.post("/api/timeline/:timelineImportId/process", async (req, res) => {
  const { timelineImportId } = req.params;
  const internalRun = String(req.query?.internal ?? "") === "1";
  const record = timelineImports.get(timelineImportId);
  if (!record) {
    return res.status(404).json({ error: "Timeline import session not found" });
  }
  const uploadPath = record.uploadPath ?? resolveStoragePathForFileKey(record.fileKey);
  if (!uploadPath || !fs.existsSync(uploadPath)) {
    return res.status(400).json({ error: "Timeline file missing on server." });
  }

  if (!internalRun) {
    if (
      ["processing", "parsing", "indexing", "building_candidates", "correlating", "finalizing"].includes(
        record.stage,
      )
    ) {
      return res.status(202).json(buildTimelineStatusPayload(record));
    }
    if (record.stage === "completed") {
      return res.status(200).json(buildTimelineStatusPayload(record));
    }

    record.importId = req.body?.importId ?? record.importId ?? null;
    record.stage = "processing";
    record.progressPercent = 40;
    record.updatedAt = nowIso();
    record.error = null;
    timelineImports.set(timelineImportId, record);
    const statusPath = path.join(uploadsDir, `${timelineImportId}-status.json`);
    fs.writeFileSync(
      statusPath,
      JSON.stringify(buildTimelineStatusPayload(record), null, 2),
      "utf8",
    );

    Promise.resolve()
      .then(() =>
        fetch(`http://127.0.0.1:${PORT}/api/timeline/${encodeURIComponent(timelineImportId)}/process?internal=1`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            importId: record.importId ?? null,
          }),
        }),
      )
      .catch((error) => {
        console.log(
          `[TIMELINE][process] background-trigger-fail id=${timelineImportId} error=${error instanceof Error ? error.message : "unknown"}`,
        );
      });

    return res.status(202).json(buildTimelineStatusPayload(record));
  }

  try {
    const fileStats = fs.statSync(uploadPath);
    console.log(`[TIMELINE][process] filePath=${uploadPath}`);
    console.log(`[TIMELINE][process] fileSizeBytes=${fileStats.size}`);
    console.log(
      `[TIMELINE][version] ${SERVER_VERSION}=true timelineImportId=${timelineImportId}`,
    );
    record.stage = "parsing";
    record.progressPercent = 48;
    record.updatedAt = nowIso();
    timelineImports.set(timelineImportId, record);

    const parsed = await parseTimelineFileChunked(uploadPath, timelineImportId);
    console.log(
      `[TIMELINE][process] inspection rootType=${parsed.diagnostics.rootType} format=${parsed.diagnostics.formatDetected} branch=${parsed.diagnostics.parserBranchSelected}`
    );
    console.log(
      `[TIMELINE][process] inspection topLevelKeys=${JSON.stringify(parsed.diagnostics.topLevelKeys ?? [])}`
    );
    console.log(
      `[TIMELINE][process] inspection candidateCounts=${JSON.stringify(parsed.diagnostics.candidateCounts ?? {})}`
    );
    console.log(
      `[TIMELINE][process] inspection sampleShapes=${JSON.stringify((parsed.diagnostics.sampleShapes ?? []).slice(0, 3))}`
    );
    console.log(
      `[TIMELINE][process] semanticSegments.timelinePath count=${parsed.diagnostics.semanticSubtypeCounts?.timelinePath ?? 0}`
    );
    console.log(
      `[TIMELINE][process] semanticSegments.activity count=${parsed.diagnostics.semanticSubtypeCounts?.activity ?? 0}`
    );
    console.log(
      `[TIMELINE][process] semanticSegments.visit count=${parsed.diagnostics.semanticSubtypeCounts?.visit ?? 0}`
    );
    console.log(
      `[TIMELINE][process] emitted timelinePath segments=${parsed.diagnostics.emittedBySubtype?.timelinePath ?? 0}`
    );
    console.log(
      `[TIMELINE][process] emitted activity segments=${parsed.diagnostics.emittedBySubtype?.activity ?? 0}`
    );
    console.log(
      `[TIMELINE][process] emitted visit segments=${parsed.diagnostics.emittedBySubtype?.visit ?? 0}`
    );
    console.log(
      `[TIMELINE][process] inspection emittedSegments=${parsed.diagnostics.emittedSegments ?? 0} parseErrors=${parsed.diagnostics.parseErrors ?? 0} zeroSegmentReason=${parsed.diagnostics.zeroSegmentReason ?? "n/a"}`
    );
    console.log(
      `[TIMELINE][process] rawSignals.topLevelKeysCounts=${JSON.stringify(parsed.diagnostics.rawSignalsDiagnostics?.topLevelKeysCounts ?? {})}`,
    );
    console.log(
      `[TIMELINE][process] rawSignals.positionEntriesSeen=${parsed.diagnostics.rawSignalsDiagnostics?.positionEntriesSeen ?? 0} extractedPointCount=${parsed.diagnostics.rawSignalsDiagnostics?.extractedPointCount ?? 0}`,
    );
    console.log(
      `[TIMELINE][process] rawSignals.samplePositionKeys=${JSON.stringify((parsed.diagnostics.rawSignalsDiagnostics?.samplePositionKeys ?? []).slice(0, 3))}`,
    );

    const debugPath = path.join(uploadsDir, `${timelineImportId}-debug.json`);
    const debugArtifact = {
      timelineImportId,
      importId: req.body?.importId ?? record.importId ?? null,
      filePath: uploadPath,
      fileSizeBytes: fileStats.size,
      rootType: parsed.diagnostics.rootType ?? "unknown",
      formatDetected: parsed.diagnostics.formatDetected ?? "unknown",
      parserBranchSelected: parsed.diagnostics.parserBranchSelected ?? "unknown",
      topLevelKeys: parsed.diagnostics.topLevelKeys ?? [],
      candidateCounts: parsed.diagnostics.candidateCounts ?? {},
      sampleShapes: (parsed.diagnostics.sampleShapes ?? []).slice(0, 3),
      emittedSegments: parsed.diagnostics.emittedSegments ?? 0,
      semanticSubtypeCounts: parsed.diagnostics.semanticSubtypeCounts ?? {},
      emittedBySubtype: parsed.diagnostics.emittedBySubtype ?? {},
      skippedBySubtype: parsed.diagnostics.skippedBySubtype ?? {},
      skippedReasonCounts: parsed.diagnostics.skippedReasonCounts ?? {},
      zeroSegmentReason: parsed.diagnostics.zeroSegmentReason ?? null,
      parsedObjects: parsed.diagnostics.parsedObjects ?? 0,
      parseErrors: parsed.diagnostics.parseErrors ?? 0,
      diagnostics: parsed.diagnostics,
      createdAt: nowIso(),
    };
    fs.writeFileSync(debugPath, JSON.stringify(debugArtifact, null, 2), "utf8");

    record.stage = "indexing";
    record.progressPercent = 62;
    record.updatedAt = nowIso();
    timelineImports.set(timelineImportId, record);

    const index = buildTimelineIndex(parsed.segments);
    const rawSignalIndex = buildRawSignalIndex(parsed.rawSignalPositions ?? []);
    const rawSignalPointsIndexed = Array.from(rawSignalIndex.values()).reduce(
      (acc, points) => acc + (Array.isArray(points) ? points.length : 0),
      0,
    );
    const rawSignalIndexedSample = [];
    for (const points of rawSignalIndex.values()) {
      for (const point of points) {
        if (rawSignalIndexedSample.length >= 10) {
          break;
        }
        rawSignalIndexedSample.push({
          timestamp: point.timestampIso ?? null,
          lat: point.lat ?? null,
          lng: point.lng ?? null,
          monthBucket: point.dateBucket ?? null,
        });
      }
      if (rawSignalIndexedSample.length >= 10) {
        break;
      }
    }
    console.log(
      `[TIMELINE][process] rawSignalsIndexed=${rawSignalPointsIndexed} buckets=${rawSignalIndex.size}`,
    );
    console.log(
      `[TIMELINE][process] rawSignalsIndexedSample=${JSON.stringify(rawSignalIndexedSample)}`,
    );
    const importId =
      req.body?.importId ??
      record.importId ??
      null;

    record.stage = "building_candidates";
    record.progressPercent = 74;
    record.updatedAt = nowIso();
    timelineImports.set(timelineImportId, record);

    const importRecord = importId ? imports.get(importId) : null;
    const zipPath = importRecord?.uploadPath ?? (importId ? path.join(uploadsDir, `${importId}.zip`) : null);
    let historicalBackfillRows = [];
    let historicalCandidateStats = {
      totalTripsParsed: 0,
      requestOnly60s: 0,
      startOnly60s: 0,
      endOnly60s: 0,
      startAndEnd60s: 0,
      requestStartEnd60s: 0,
      requestOnly120s: 0,
      startOnly120s: 0,
      endOnly120s: 0,
      startAndEnd120s: 0,
      requestStartEnd120s: 0,
      strictCount120s: 0,
      goodCount120s: 0,
      reviewCount120s: 0,
      excludedCount120s: 0,
      matchedHistoricalTripRows: 0,
      rawSignalPointsIndexed,
      timelinePointCount: index.size,
      note:
        "Trip-first historical matching now uses driver_lifetime_trips as canonical backbone and no longer relies on payment-only/trip-only split.",
    };
    if (zipPath && fs.existsSync(zipPath)) {
      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
      const entryNames = entries.map((entry) => entry.entryName);
      const tripsMatch = pickBestEntryName(entryNames, {
        prefer: ["driver_lifetime_trips"],
        fallback: ["driver/trips", "driver_trips", "driver trips", "trips"],
        exclude: ["rider", "eats", "ubereats", "receipt", "ratings", "payment_methods"],
      });
      const tripsSummary = summarizeCsvEntry(
        zip,
        tripsMatch.selected,
        "request_timestamp_local",
        ["request_timestamp", "request time", "request datetime"],
      );
      const tripBackbone = parseTripBackboneRows(tripsSummary.dataRows, tripsSummary.headers);
      const timelinePathExpandedPoints = extractTimelinePathPointPositionsFromFile(uploadPath);
      const timelinePointIndex = buildTimelinePointIndexFromParsed(parsed, timelinePathExpandedPoints);
      const tripMatching = buildTripBackboneHistoricalMatches(tripBackbone.rows, timelinePointIndex);
      historicalBackfillRows = tripMatching.acceptedRows;

      const w60 = tripMatching.byWindow["60"];
      const w120 = tripMatching.byWindow["120"];
      historicalCandidateStats = {
        ...historicalCandidateStats,
        totalTripsParsed: tripBackbone.rows.length,
        requestOnly60s: w60?.audit?.requestOnly ?? 0,
        startOnly60s: w60?.audit?.startOnly ?? 0,
        endOnly60s: w60?.audit?.endOnly ?? 0,
        startAndEnd60s: w60?.audit?.startAndEnd ?? 0,
        requestStartEnd60s: w60?.audit?.requestStartEnd ?? 0,
        requestOnly120s: w120?.audit?.requestOnly ?? 0,
        startOnly120s: w120?.audit?.startOnly ?? 0,
        endOnly120s: w120?.audit?.endOnly ?? 0,
        startAndEnd120s: w120?.audit?.startAndEnd ?? 0,
        requestStartEnd120s: w120?.audit?.requestStartEnd ?? 0,
        strictCount120s: w120?.countsByConfidence?.strict ?? 0,
        goodCount120s: w120?.countsByConfidence?.good ?? 0,
        reviewCount120s: w120?.countsByConfidence?.review ?? 0,
        excludedCount120s: w120?.countsByConfidence?.excluded ?? 0,
        matchedHistoricalTripRows: historicalBackfillRows.length,
        tripFieldMapping: tripBackbone.fields,
        timelinePointCount: timelinePointIndex.allPoints.length,
        rawSignalPointCount: timelinePointIndex.diagnostics?.rawSignalPointCount ?? 0,
        timelinePathExpandedPointCount: timelinePointIndex.diagnostics?.timelinePathExpandedPointCount ?? 0,
        timelineSegmentEndpointPointCount: timelinePointIndex.diagnostics?.timelineSegmentEndpointPointCount ?? 0,
        combinedPointCount: timelinePointIndex.diagnostics?.combinedPointCount ?? 0,
        pointCoverageStart: timelinePointIndex.diagnostics?.coverageStart ?? null,
        pointCoverageEnd: timelinePointIndex.diagnostics?.coverageEnd ?? null,
        pointCoverageDistinctMonthCount: timelinePointIndex.diagnostics?.distinctMonthBucketCount ?? 0,
      };
      console.log(
        `[TIMELINE][process] tripBackbone fields=${JSON.stringify(tripBackbone.fields)}`,
      );
      console.log(
        `[TIMELINE][process] tripBackbone 60s=${JSON.stringify(w60?.audit ?? {})}`,
      );
      console.log(
        `[TIMELINE][process] tripBackbone 120s=${JSON.stringify(w120?.audit ?? {})}`,
      );
      console.log(
        `[TIMELINE][process] tripBackbone confidence120=${JSON.stringify(w120?.countsByConfidence ?? {})}`,
      );
      console.log(
        `[TIMELINE][process] matchedHistoricalTripRows=${historicalBackfillRows.length}`,
      );
      console.log(
        `[TIMELINE][process] points rawSignals=${timelinePointIndex.diagnostics?.rawSignalPointCount ?? 0} timelinePathExpanded=${timelinePointIndex.diagnostics?.timelinePathExpandedPointCount ?? 0} segmentEndpoints=${timelinePointIndex.diagnostics?.timelineSegmentEndpointPointCount ?? 0} combined=${timelinePointIndex.diagnostics?.combinedPointCount ?? 0}`,
      );
      console.log(
        `[TIMELINE][process] points coverageStart=${timelinePointIndex.diagnostics?.coverageStart ?? "n/a"} coverageEnd=${timelinePointIndex.diagnostics?.coverageEnd ?? "n/a"} distinctMonths=${timelinePointIndex.diagnostics?.distinctMonthBucketCount ?? 0}`,
      );
    }

    record.stage = "correlating";
    record.progressPercent = 88;
    record.updatedAt = nowIso();
    timelineImports.set(timelineImportId, record);

    const inferred = historicalBackfillRows.map((row) => ({
      linkedTripId: row.uniqueTripId,
      source: "google_timeline_inferred",
      confidence: row.confidence === "strict" ? "high" : "likely",
      reason: "Trip-first historical match from driver_lifetime_trips to Google timeline points",
      tripRequestTimestamp: row.requestTimestamp,
      areaHint: row.pickupAreaLabel ?? row.requestAreaLabel ?? row.dropoffAreaLabel ?? null,
      linkedEarnings: row.earningsAmount ?? null,
      timelineSegment: {
        segmentType: "point-match",
        startTime: row.beginTimestamp,
        endTime: row.dropoffTimestamp,
        startLat: row.pickupLat,
        startLng: row.pickupLng,
        endLat: row.dropoffLat,
        endLng: row.dropoffLng,
        semanticType: "trip_backbone_direct",
      },
      scoring: {
        timestampProximityMs: Math.round(
          Math.max(
            row.matchQualityDetails?.beginDeltaSeconds ?? 0,
            row.matchQualityDetails?.dropoffDeltaSeconds ?? 0,
          ) * 1000,
        ),
        durationSeconds: row.durationSeconds ?? 0,
        score: row.confidence === "strict" ? 9 : 6,
      },
    }));
    const inferredSummary = buildTimelineInferenceSummary(inferred);
    console.log(
      `[TIMELINE][process] inferredCount=${inferredSummary.inferredCount} confidenceCounts=${JSON.stringify(inferredSummary.byConfidence)}`,
    );
    console.log(
      `[TIMELINE][process] candidateStats=${JSON.stringify(historicalCandidateStats)}`,
    );
    console.log(
      `[TIMELINE][process] inferredByMonth=${JSON.stringify(inferredSummary.byMonth.slice(0, 12))}`,
    );

    record.stage = "finalizing";
    record.progressPercent = 95;
    record.updatedAt = nowIso();
    timelineImports.set(timelineImportId, record);

    const artifactOut = {
      timelineImportId,
      importId: importId ?? null,
      fileKey: record.fileKey ?? null,
      processedAt: nowIso(),
      parserDiagnostics: parsed.diagnostics,
      segmentsCount: parsed.segments.length,
      inferredMatchesCount: inferred.length,
      historicalCandidateStats,
      inferredSummary,
      inferredSample: inferred.slice(0, 10),
    };
    const outPath = path.join(uploadsDir, `${timelineImportId}-processed.json`);
    const inferredPath = path.join(uploadsDir, `${timelineImportId}-inferred.json`);
    const statusPath = path.join(uploadsDir, `${timelineImportId}-status.json`);
    fs.writeFileSync(outPath, JSON.stringify(artifactOut, null, 2), "utf8");
    fs.writeFileSync(
      inferredPath,
      JSON.stringify(
        {
          timelineImportId,
          importId: importId ?? null,
          persistedAt: nowIso(),
          inferredCount: inferred.length,
          inferredMatches: inferred,
        },
        null,
        2,
      ),
      "utf8",
    );

    record.stage = "completed";
    record.progressPercent = 100;
    record.processed = true;
    record.summary = artifactOut;
    record.artifactPath = outPath;
    record.debugArtifactPath = path.join(uploadsDir, `${timelineImportId}-debug.json`);
    record.inferredArtifactPath = inferredPath;
    record.updatedAt = nowIso();
    timelineImports.set(timelineImportId, record);
    fs.writeFileSync(
      statusPath,
      JSON.stringify(buildTimelineStatusPayload(record), null, 2),
      "utf8",
    );

    console.log(
      `[TIMELINE][finalize] building unified dataset importId=${importId ?? "none"} timelineImportId=${timelineImportId}`,
    );
    console.log(
      `[TIMELINE][finalize] getDateBucket typeof=${typeof getDateBucket} getDayHourBucket typeof=${typeof getDayHourBucket}`,
    );

    if (importId) {
      let importRecord = imports.get(importId) ?? null;
      const importRecordFoundInitial = Boolean(importRecord);
      let fallbackHydrationAttempted = false;
      if (!importRecord) {
        fallbackHydrationAttempted = true;
        const uploadPathFallback = path.join(uploadsDir, `${importId}.zip`);
        const linkedArtifact = loadLinkedDatasetArtifact(importId);
        importRecord = {
          importId,
          sourceFileName: linkedArtifact?.payload?.sourceFileName ?? `${importId}.zip`,
          uploadPath: fs.existsSync(uploadPathFallback) ? uploadPathFallback : null,
          status: "completed",
          stage: "completed",
          progressPercent: 100,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          summary: linkedArtifact?.payload?.summary ?? {},
        };
        imports.set(importId, importRecord);
      }
      console.log(
        `[TIMELINE][finalize] importId=${importId} importRecordFound=${importRecordFoundInitial} fallbackHydrationAttempted=${fallbackHydrationAttempted}`,
      );

      importRecord.summary = {
        ...(importRecord.summary ?? {}),
        timelineBackfill: {
          timelineImportId,
          segmentsCount: parsed.segments.length,
          inferredMatchesCount: inferred.length,
          parserMode: parsed.diagnostics.mode,
        },
        historicalTripBackfillAudit: {
          window60s: {
            requestOnly: historicalCandidateStats.requestOnly60s ?? 0,
            startOnly: historicalCandidateStats.startOnly60s ?? 0,
            endOnly: historicalCandidateStats.endOnly60s ?? 0,
            startAndEnd: historicalCandidateStats.startAndEnd60s ?? 0,
            requestStartEnd: historicalCandidateStats.requestStartEnd60s ?? 0,
          },
          window120s: {
            requestOnly: historicalCandidateStats.requestOnly120s ?? 0,
            startOnly: historicalCandidateStats.startOnly120s ?? 0,
            endOnly: historicalCandidateStats.endOnly120s ?? 0,
            startAndEnd: historicalCandidateStats.startAndEnd120s ?? 0,
            requestStartEnd: historicalCandidateStats.requestStartEnd120s ?? 0,
          },
          confidence120s: {
            strict: historicalCandidateStats.strictCount120s ?? 0,
            good: historicalCandidateStats.goodCount120s ?? 0,
            review: historicalCandidateStats.reviewCount120s ?? 0,
            excluded: historicalCandidateStats.excludedCount120s ?? 0,
          },
          matchedHistoricalTripRows: historicalCandidateStats.matchedHistoricalTripRows ?? 0,
          totalTripsParsed: historicalCandidateStats.totalTripsParsed ?? 0,
        },
        timelineInferredMatchesSample: inferred.slice(0, 5),
      };
      const linkedArtifact = loadLinkedDatasetArtifact(importId);
      const unifiedDataset = buildUnifiedDecisionDataset(
        importId,
        linkedArtifact?.payload?.linkedRecords ?? [],
        [],
        historicalBackfillRows,
      );
      const unifiedArtifactPath = persistUnifiedDecisionArtifact(
        importId,
        unifiedDataset,
      );
      importRecord.heatmapCoverageArtifactPath = persistHeatmapCoverageArtifact(
        importId,
        buildHeatmapCoverageArtifact(importId, unifiedDataset),
      );
      importRecord.unifiedDecisionArtifactPath = unifiedArtifactPath;
      importRecord.summary = hydrateUnifiedSummaryFromArtifact(
        importRecord.summary,
        unifiedDataset,
      );
      const heatmapBucketCount = unifiedDataset?.heatmapBuckets?.length ?? 0;
      console.log(
        `[TIMELINE][finalize] unifiedArtifactWritten=${unifiedArtifactPath} heatmapBucketCount=${heatmapBucketCount}`,
      );
      importRecord.updatedAt = nowIso();
      imports.set(importId, importRecord);
    } else {
      console.log(
        `[TIMELINE][finalize] skipped unified dataset build reason=missing_import_id importId=${importId ?? "none"}`,
      );
    }

    return res.json({
      ok: true,
      status: "completed",
      timelineImportId,
      fileKey: record.fileKey ?? null,
      stage: record.stage,
      progressPercent: record.progressPercent,
      segmentCount: artifactOut.segmentsCount,
      inferredCount: artifactOut.inferredMatchesCount,
      parserMode: artifactOut.parserDiagnostics?.mode ?? null,
      summary: artifactOut,
    });
  } catch (error) {
    console.log(
      `[TIMELINE][finalize] fail reason=${error instanceof Error ? error.message : "unknown"}`,
    );
    record.stage = "failed";
    record.progressPercent = 100;
    record.updatedAt = nowIso();
    record.error = error instanceof Error ? error.message : "Timeline processing failed";
    timelineImports.set(timelineImportId, record);
    const statusPath = path.join(uploadsDir, `${timelineImportId}-status.json`);
    fs.writeFileSync(
      statusPath,
      JSON.stringify(buildTimelineStatusPayload(record), null, 2),
      "utf8",
    );
    return res.status(500).json({
      ok: false,
      error: record.error,
    });
  }
});

app.get("/api/timeline/:timelineImportId/status", (req, res) => {
  const { timelineImportId } = req.params;
  const record = timelineImports.get(timelineImportId);
  if (!record) {
    return res.status(404).json({ error: "Timeline import session not found" });
  }
  return res.json(buildTimelineStatusPayload(record));
});

app.get("/api/timeline/:timelineImportId/review", (req, res) => {
  const { timelineImportId } = req.params;
  const record = timelineImports.get(timelineImportId);
  if (!record) {
    return res.status(404).json({ error: "Timeline import session not found" });
  }
  const inferredSummary = record.summary?.inferredSummary ?? {
    inferredCount: 0,
    byConfidence: { high: 0, likely: 0, review: 0, weak: 0 },
    byMonth: [],
    sampleInferred: [],
  };
  return res.json({
    timelineImportId,
    stage: record.stage,
    segmentCount: record.summary?.segmentsCount ?? 0,
    inferredCount: record.summary?.inferredMatchesCount ?? 0,
    parserMode: record.summary?.parserDiagnostics?.mode ?? null,
    emittedBySubtype: record.summary?.parserDiagnostics?.emittedBySubtype ?? null,
    candidatesConsidered: record.summary?.historicalCandidateStats?.candidatesConsidered ?? 0,
    candidatesOutsideAnalyticsWindow:
      record.summary?.historicalCandidateStats?.candidatesOutsideAnalyticsWindow ?? 0,
    candidatesAlreadyCovered:
      record.summary?.historicalCandidateStats?.candidatesAlreadyCovered ?? 0,
    candidatesMatchedByTimeline:
      record.summary?.historicalCandidateStats?.candidatesMatchedByTimeline ?? 0,
    timelineCandidatesFound:
      record.summary?.historicalCandidateStats?.timelineCandidatesFound ?? 0,
    usableHistoricalMatches:
      record.summary?.historicalCandidateStats?.usableHistoricalMatches ?? 0,
    candidatesInsideAnalyticsWindow:
      record.summary?.historicalCandidateStats?.candidatesInsideAnalyticsWindow ?? 0,
    candidatesEligibleForTimeline:
      record.summary?.historicalCandidateStats?.candidatesEligibleForTimeline ?? 0,
    promotedHighCount:
      record.summary?.historicalCandidateStats?.promotedHighCount ?? 0,
    promotedLikelyCount:
      record.summary?.historicalCandidateStats?.promotedLikelyCount ?? 0,
    keptReviewCount:
      record.summary?.historicalCandidateStats?.keptReviewCount ?? 0,
    duplicatesRejected:
      record.summary?.historicalCandidateStats?.duplicatesRejected ?? 0,
    poorDistanceFitRejected:
      record.summary?.historicalCandidateStats?.poorDistanceFitRejected ?? 0,
    poorDurationFitRejected:
      record.summary?.historicalCandidateStats?.poorDurationFitRejected ?? 0,
    nonUniqueRejected:
      record.summary?.historicalCandidateStats?.nonUniqueRejected ?? 0,
    scoreHistogram:
      record.summary?.historicalCandidateStats?.scoreHistogram ?? null,
    promotionBlockers:
      record.summary?.historicalCandidateStats?.promotionBlockers ?? null,
    scoringPathDiagnostics:
      record.summary?.historicalCandidateStats?.scoringPathDiagnostics ?? null,
    scoredSampleMatches:
      record.summary?.historicalCandidateStats?.scoredSampleMatches ?? [],
    candidatesWithDuration:
      record.summary?.historicalCandidateStats?.candidatesWithDuration ?? 0,
    candidatesWithDistance:
      record.summary?.historicalCandidateStats?.candidatesWithDistance ?? 0,
    candidatesWithAreaHint:
      record.summary?.historicalCandidateStats?.candidatesWithAreaHint ?? 0,
    totalTripsParsed:
      record.summary?.historicalCandidateStats?.totalTripsParsed ?? 0,
    totalPaymentGroupsParsed:
      record.summary?.historicalCandidateStats?.totalPaymentGroupsParsed ?? 0,
    tripsWithUuid:
      record.summary?.historicalCandidateStats?.tripsWithUuid ?? 0,
    paymentGroupsWithUuid:
      record.summary?.historicalCandidateStats?.paymentGroupsWithUuid ?? 0,
    joinedTripPaymentCandidates:
      record.summary?.historicalCandidateStats?.joinedTripPaymentCandidates ?? 0,
    paymentOnlyCandidates:
      record.summary?.historicalCandidateStats?.paymentOnlyCandidates ?? 0,
    tripOnlyCandidates:
      record.summary?.historicalCandidateStats?.tripOnlyCandidates ?? 0,
    joinFailureReasons:
      record.summary?.historicalCandidateStats?.joinFailureReasons ?? {},
    sampleCandidates:
      record.summary?.historicalCandidateStats?.sampleCandidates ?? [],
    matchesWithRawSignalSupport:
      record.summary?.historicalCandidateStats?.matchesWithRawSignalSupport ?? 0,
    matchesWithAreaScoreNonZero:
      record.summary?.historicalCandidateStats?.matchesWithAreaScoreNonZero ?? 0,
    matchesWithDurationScoreNonZero:
      record.summary?.historicalCandidateStats?.matchesWithDurationScoreNonZero ?? 0,
    matchesWithDistanceScoreNonZero:
      record.summary?.historicalCandidateStats?.matchesWithDistanceScoreNonZero ?? 0,
    rawSignalPointsIndexed:
      record.summary?.historicalCandidateStats?.rawSignalPointsIndexed ?? 0,
    rawSignalIndexedSample:
      record.summary?.historicalCandidateStats?.rawSignalIndexedSample ?? [],
    rawSignalSupportInsight:
      record.summary?.historicalCandidateStats?.rawSignalSupportInsight ?? null,
    confidenceCounts: inferredSummary.byConfidence,
    inferredByMonth: inferredSummary.byMonth,
    sampleInferred: inferredSummary.sampleInferred,
    errorMessage: record.error ?? null,
    updatedAt: record.updatedAt ?? nowIso(),
  });
});

app.get("/api/translink/hubs", async (_req, res) => {
  try {
    const hubs = await translinkRail.getHubs();
    return res.json({
      ok: true,
      provider: "translink",
      hubs,
      transportScope: "ni_rail_three_hubs_only",
      env: {
        tokenConfigured: translinkRail.env.TRANSLINK_API_TOKEN,
        stopFinderUrl: translinkRail.env.TRANSLINK_STOP_FINDER_URL,
        departureMonitorUrl: translinkRail.env.TRANSLINK_DEPARTURE_MONITOR_URL,
        addInfoUrl: translinkRail.env.TRANSLINK_ADD_INFO_URL,
      },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to load tracked hubs.",
    });
  }
});

app.get("/api/translink/hub/:hubKey/next-events", async (req, res) => {
  try {
    const result = await translinkRail.getNextEventsForHub(req.params.hubKey);
    if (!result) {
      return res.status(404).json({ ok: false, error: "Hub not found." });
    }
    return res.json({
      ok: true,
      hubKey: result.hubKey,
      hubName: result.hubName,
      stopId: result.stopId,
      source: result.source,
      availability: result.availability,
      nextHourExpectedArrivalsCount: result.nextHourExpectedArrivalsCount,
      nextThree: result.nextThree,
      nextEvents: result.nextEvents,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to load hub next events.",
    });
  }
});

app.get("/api/translink/hub/:hubKey/disruptions", async (req, res) => {
  try {
    const result = await translinkRail.getDisruptionsForHub(req.params.hubKey);
    if (!result) {
      return res.status(404).json({ ok: false, error: "Hub not found." });
    }
    return res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to load disruptions.",
    });
  }
});

app.get("/api/translink/hub/:hubKey/baseline", async (req, res) => {
  try {
    const result = translinkRail.getBaselineForHub(req.params.hubKey);
    if (!result) {
      return res.status(404).json({ ok: false, error: "Hub not found." });
    }
    return res.json({
      ok: true,
      ...result,
      baselineMode: "rolling_ewma_per_weekday_hour",
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to load baseline.",
    });
  }
});

app.get("/api/translink/hub/:hubKey/smart-diary-signal", async (req, res) => {
  try {
    const latitude = req.query.lat ? Number(req.query.lat) : null;
    const longitude = req.query.lng ? Number(req.query.lng) : null;
    const result = await translinkRail.getSmartDiarySignalForHub(req.params.hubKey, {
      latitude,
      longitude,
    });
    if (!result) {
      return res.status(404).json({ ok: false, error: "Hub not found." });
    }
    return res.json({
      ok: true,
      ...result,
      popupAlertPayload: result.alertItems.map((alert) => ({
        hubName: alert.hubName,
        time: alert.timeLabel,
        destination: alert.destination,
        disruptionText: alert.disruptionText,
      })),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load smart diary signal.",
    });
  }
});

app.get("/api/smart-diary/locations", (req, res) => {
  try {
    const activeIds = new Set(
      smartDiaryEngine.getActiveLocations().map((location) => location.id),
    );
    return res.json({
      ok: true,
      scope: "mvp_belfast_locations_only",
      locations: smartDiaryEngine.getLocations().map((location) => ({
        ...location,
        active: activeIds.has(location.id),
      })),
      pollingScheduleMinutes: smartDiaryEngine.pollConfig,
      noPerDriverExternalApiCalls: true,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load smart diary locations.",
    });
  }
});

app.post("/api/smart-diary/driver-context", (req, res) => {
  try {
    const updatedContext = smartDiaryEngine.upsertDriverContext(req.body ?? {});
    const active = smartDiaryEngine.recomputeActiveLocations();
    return res.json({
      ok: true,
      context: updatedContext,
      active,
      notes: {
        externalCallsAreCentralized: true,
        clientReadsBackendOnly: true,
      },
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to update driver context.",
    });
  }
});

app.get("/api/smart-diary/active-locations", (req, res) => {
  try {
    const activeLocations = smartDiaryEngine.getActiveLocations();
    return res.json({
      ok: true,
      activeLocationsCount: activeLocations.length,
      activeLocations,
      sourceEnabled: smartDiaryEngine.getSourceEnabled(),
      cachedAt: smartDiaryEngine.getCacheSnapshot().updatedAt ?? null,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load active locations.",
    });
  }
});

app.post("/api/smart-diary/poll-now", async (_req, res) => {
  try {
    const result = await smartDiaryEngine.pollAllActiveSources();
    return res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to poll smart diary sources.",
    });
  }
});

app.get("/api/smart-diary/location/:locationId/signals", (req, res) => {
  try {
    const signals = smartDiaryEngine.getLocationSignals(req.params.locationId);
    if (!signals) {
      return res.status(404).json({
        ok: false,
        error: "Location has no cached signals yet.",
      });
    }
    return res.json({
      ok: true,
      locationId: req.params.locationId,
      signals,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load location signals.",
    });
  }
});

app.get("/api/smart-diary/feed", async (req, res) => {
  try {
    const payload = await signalPlatform.buildDiaryPayload({
      driverId: req.query.driverId,
      lat: req.query.lat,
      lng: req.query.lng,
      radiusMiles: req.query.radiusMiles,
      postcode: req.query.postcode,
      regionKey: req.query.regionKey,
      country: req.query.country,
      city: req.query.city,
      date: req.query.date,
      favVenue: req.query.favVenue,
      favPlace: req.query.favPlace,
      favPostcode: req.query.favPostcode,
      favOutward: req.query.favOutward,
      favBroadCity: req.query.favBroadCity,
      favAllowBroadCity: req.query.favAllowBroadCity,
      favPoint: req.query.favPoint,
    });
    const cacheVersion = signalPlatform.getCacheVersion?.() ?? "unknown";
    const meta = payload?.meta && typeof payload.meta === "object" ? payload.meta : {};
    return res.json({
      ok: true,
      serverVersion: SERVER_VERSION,
      backendMarker: SIGNAL_BACKEND_MARKER,
      legacyRouteAlias: "/api/smart-diary/feed",
      ...payload,
      meta: {
        ...meta,
        cacheKey: meta.cacheKey ?? "uncached-live",
        cacheVersion: meta.cacheVersion ?? cacheVersion,
        cacheSource: meta.cacheSource ?? "live",
        favouritesSignatureUsedInCacheKey:
          meta.favouritesSignatureUsedInCacheKey ?? "none",
        cacheWrittenAfterFinalFilter:
          typeof meta.cacheWrittenAfterFinalFilter === "boolean"
            ? meta.cacheWrittenAfterFinalFilter
            : meta.cacheSource === "diary-cache"
              ? true
              : false,
        backendMarker: SIGNAL_BACKEND_MARKER,
        backendPid: process.pid,
        backendStartedAt: SERVER_STARTED_AT,
        backendServerVersion: SERVER_VERSION,
        backendCacheVersion: cacheVersion,
      },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to build smart diary feed.",
    });
  }
});

app.get("/api/signals/home", async (req, res) => {
  try {
    const payload = await signalPlatform.buildHomePayload({
      driverId: req.query.driverId,
      lat: req.query.lat,
      lng: req.query.lng,
      radiusMiles: req.query.radiusMiles,
      postcode: req.query.postcode,
      regionKey: req.query.regionKey,
      country: req.query.country,
      city: req.query.city,
      favVenue: req.query.favVenue,
      favPlace: req.query.favPlace,
      favPostcode: req.query.favPostcode,
      favOutward: req.query.favOutward,
      favBroadCity: req.query.favBroadCity,
      favAllowBroadCity: req.query.favAllowBroadCity,
      favPoint: req.query.favPoint,
    });
    return res.json({
      ok: true,
      serverVersion: SERVER_VERSION,
      backendMarker: SIGNAL_BACKEND_MARKER,
      ...payload,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to build home signals.",
    });
  }
});

app.get("/api/signals/diary", async (req, res) => {
  const startedAtMs = Date.now();
  try {
    const payload = await signalPlatform.buildDiaryPayload({
      driverId: req.query.driverId,
      lat: req.query.lat,
      lng: req.query.lng,
      radiusMiles: req.query.radiusMiles,
      postcode: req.query.postcode,
      regionKey: req.query.regionKey,
      country: req.query.country,
      city: req.query.city,
      date: req.query.date,
      favVenue: req.query.favVenue,
      favPlace: req.query.favPlace,
      favPostcode: req.query.favPostcode,
      favOutward: req.query.favOutward,
      favBroadCity: req.query.favBroadCity,
      favAllowBroadCity: req.query.favAllowBroadCity,
      favPoint: req.query.favPoint,
    });
    const cacheVersion = signalPlatform.getCacheVersion?.() ?? "unknown";
    const meta = payload?.meta && typeof payload.meta === "object" ? payload.meta : {};
    const ensuredMeta = {
      ...meta,
      cacheKey: meta.cacheKey ?? "uncached-live",
      cacheVersion: meta.cacheVersion ?? cacheVersion,
      cacheSource: meta.cacheSource ?? "live",
      favouritesSignatureUsedInCacheKey:
        meta.favouritesSignatureUsedInCacheKey ?? "none",
      cacheWrittenAfterFinalFilter:
        typeof meta.cacheWrittenAfterFinalFilter === "boolean"
          ? meta.cacheWrittenAfterFinalFilter
          : meta.cacheSource === "diary-cache"
            ? true
            : false,
      backendMarker: SIGNAL_BACKEND_MARKER,
      backendPid: process.pid,
      backendStartedAt: SERVER_STARTED_AT,
      backendServerVersion: SERVER_VERSION,
      backendCacheVersion: cacheVersion,
    };
    const durationMs = Date.now() - startedAtMs;
    const itemCount = Array.isArray(payload.items) ? payload.items.length : 0;
    console.log(
      `[DIARY][load] complete durationMs=${durationMs} totalCount=${itemCount} backendMarker=${SIGNAL_BACKEND_MARKER} cacheSource=${String(
        ensuredMeta.cacheSource,
      )} cacheVersion=${String(ensuredMeta.cacheVersion)} cacheKey=${String(
        ensuredMeta.cacheKey,
      )}`,
    );
    return res.json({
      ok: true,
      serverVersion: SERVER_VERSION,
      backendMarker: SIGNAL_BACKEND_MARKER,
      ...payload,
      meta: ensuredMeta,
    });
  } catch (error) {
    const durationMs = Date.now() - startedAtMs;
    console.log(
      `[DIARY][load] fail durationMs=${durationMs} error=${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to build diary signals.",
    });
  }
});

app.get("/api/signals/proximity", async (req, res) => {
  try {
    const payload = await signalPlatform.buildProximityPayload({
      driverId: req.query.driverId,
      lat: req.query.lat,
      lng: req.query.lng,
      radiusMiles: req.query.radiusMiles,
      postcode: req.query.postcode,
      regionKey: req.query.regionKey,
      country: req.query.country,
      city: req.query.city,
      favVenue: req.query.favVenue,
      favPlace: req.query.favPlace,
      favPostcode: req.query.favPostcode,
      favOutward: req.query.favOutward,
      favBroadCity: req.query.favBroadCity,
      favAllowBroadCity: req.query.favAllowBroadCity,
      favPoint: req.query.favPoint,
    });
    return res.json({
      ok: true,
      serverVersion: SERVER_VERSION,
      backendMarker: SIGNAL_BACKEND_MARKER,
      ...payload,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to build proximity signals.",
    });
  }
});

app.get("/api/signals/health", (_req, res) => {
  const providerRegistry = signalPlatform.getProviderRegistry();
  const cacheStats = signalPlatform.getCacheStats?.() ?? {
    normalizedEntries: null,
    diaryEntries: null,
    cacheVersion: signalPlatform.getCacheVersion?.() ?? "unknown",
  };
  const adminProviders = signalAdminConfig.get().providers ?? {};
  const isProviderEnabled = (provider) => {
    const configured = adminProviders?.[provider.providerKey]?.enabled;
    if (typeof configured === "boolean") {
      return configured;
    }
    return provider.enabled === true;
  };
  const activeProviders = providerRegistry
    .filter((provider) => isProviderEnabled(provider))
    .map((provider) => provider.providerKey);
  return res.json({
    ok: true,
    generatedAt: nowIso(),
    serverVersion: SERVER_VERSION,
    backendMarker: SIGNAL_BACKEND_MARKER,
    pid: process.pid,
    startedAt: SERVER_STARTED_AT,
    cacheVersion: signalPlatform.getCacheVersion?.() ?? "unknown",
    cacheStats,
    activeProviders,
    providerHealth: providerRegistry.map((provider) => ({
      providerKey: provider.providerKey,
      enabled: isProviderEnabled(provider),
      status: isProviderEnabled(provider) ? "available" : "disabled",
    })),
  });
});

app.get("/api/admin/signals/providers", (_req, res) => {
  const adminProviders = signalAdminConfig.get().providers ?? {};
  const isProviderEnabled = (provider) => {
    const configured = adminProviders?.[provider.providerKey]?.enabled;
    if (typeof configured === "boolean") {
      return configured;
    }
    return provider.enabled === true;
  };
  return res.json({
    ok: true,
    providers: signalPlatform.getProviderRegistry().map((provider) => ({
      ...provider,
      enabled: isProviderEnabled(provider),
    })),
  });
});

app.get("/api/admin/signals/rollout-rules", (_req, res) => {
  return res.json({
    ok: true,
    rolloutRules: signalPlatform.getRolloutRules(),
  });
});

app.get("/api/admin/signals/tracked-places", (_req, res) => {
  return res.json({
    ok: true,
    trackedPlaces: signalPlatform.getTrackedPlaces(),
    enabledTrackedHubKeys: signalAdminConfig.get().translink?.trackedHubKeys ?? [],
    translinkThresholds: signalAdminConfig.get().translink,
  });
});

app.get("/api/admin/signals/feature-flags", (_req, res) => {
  return res.json({
    ok: true,
    featureFlags: PRODUCT_FEATURE_FLAGS,
  });
});

app.get("/api/admin/signals/config", (_req, res) => {
  return res.json({
    ok: true,
    config: signalAdminConfig.get(),
  });
});

app.post("/api/admin/signals/config", (req, res) => {
  try {
    const next = signalAdminConfig.update(req.body ?? {});
    return res.json({
      ok: true,
      config: next,
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to update signal admin config.",
    });
  }
});

app.get("/api/health", (_req, res) => {
  return res.json({
    ok: true,
    pid: process.pid,
    uptimeSeconds: Math.floor(process.uptime()),
    startedAt: SERVER_STARTED_AT,
    serverVersion: SERVER_VERSION,
  });
});

app.get("/api/earnings/health", (_req, res) => {
  return res.json({
    ok: true,
    route: EARNINGS_OCR_ROUTE,
    backendMarker: SIGNAL_BACKEND_MARKER,
    earningsOcrMarker: EARNINGS_OCR_MARKER,
    earningsBatchMarker: EARNINGS_BATCH_MARKER,
    serverVersion: SERVER_VERSION,
    startedAt: SERVER_STARTED_AT,
    pid: process.pid,
  });
});

app.post("/api/earnings/import-batches", (req, res) => {
  try {
    const entryTs = nowIso();
    const remoteAddress =
      req.ip ??
      req.socket?.remoteAddress ??
      req.connection?.remoteAddress ??
      "unknown";
    const requestIdFromHeader =
      typeof req.get("X-Earnings-Batch-Request-Id") === "string"
        ? String(req.get("X-Earnings-Batch-Request-Id")).trim()
        : "";
    const requestIdFromBody =
      typeof req.body?.requestId === "string" ? String(req.body.requestId).trim() : "";
    const requestId = requestIdFromHeader || requestIdFromBody || `batch_create_${Date.now()}`;
    const headersSummary = {
      host: req.get("host") ?? null,
      contentType: req.get("content-type") ?? null,
      contentLength: req.get("content-length") ?? null,
      userAgent: req.get("user-agent") ?? null,
      accept: req.get("accept") ?? null,
    };
    const bodyKeys =
      req.body && typeof req.body === "object" ? Object.keys(req.body).join("|") : "none";
    console.log(
      `[EARNINGS][batch-route] requestId=${requestId} stage=create-batch-entry ts=${entryTs} method=${req.method} url=${req.originalUrl} remote=${remoteAddress} headers=${JSON.stringify(
        headersSummary,
      )} bodyKeys=${bodyKeys}`,
    );
    console.log(
      `[EARNINGS][batch-route] requestId=${requestId} stage=create-batch-body-parsed contentType=${
        headersSummary.contentType ?? "none"
      } contentLength=${headersSummary.contentLength ?? "none"} bodyType=${typeof req.body}`,
    );
    const batch = earningsImportBatchManager.createBatch();
    console.log(
      `[EARNINGS][batch-route] requestId=${requestId} stage=create-batch-respond ts=${nowIso()} batchId=${batch.batchId}`,
    );
    return res.json({
      ok: true,
      requestId,
      ...batch,
      backendMarker: SIGNAL_BACKEND_MARKER,
      serverVersion: SERVER_VERSION,
      earningsBatchMarker: EARNINGS_BATCH_MARKER,
    });
  } catch (error) {
    console.log(
      `[EARNINGS][batch-route] stage=create-batch-error ts=${nowIso()} error=${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to create earnings import batch.",
    });
  }
});

app.get("/api/earnings/import-batches/debug-create", (req, res) => {
  try {
    const requestId = String(req.query.requestId ?? `debug_get_${Date.now()}`).trim();
    console.log(
      `[EARNINGS][batch-route] requestId=${requestId} stage=debug-create-hit ts=${nowIso()} method=${req.method} url=${req.originalUrl} remote=${
        req.ip ?? req.socket?.remoteAddress ?? "unknown"
      }`,
    );
    const batch = earningsImportBatchManager.createBatch();
    console.log(
      `[EARNINGS][batch-route] requestId=${requestId} stage=debug-create-respond ts=${nowIso()} batchId=${batch.batchId}`,
    );
    return res.json({
      ok: true,
      requestId,
      debug: true,
      route: "/api/earnings/import-batches/debug-create",
      ...batch,
      backendMarker: SIGNAL_BACKEND_MARKER,
      earningsBatchMarker: EARNINGS_BATCH_MARKER,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to debug-create earnings import batch.",
    });
  }
});

app.post(
  "/api/earnings/import-batches/debug-plain",
  express.text({ type: "*/*", limit: "32kb" }),
  (req, res) => {
    try {
      const requestIdFromHeader =
        typeof req.get("X-Earnings-Batch-Request-Id") === "string"
          ? String(req.get("X-Earnings-Batch-Request-Id")).trim()
          : "";
      const requestIdFromQuery = String(req.query.requestId ?? "").trim();
      const rawBody = typeof req.body === "string" ? req.body : "";
      let requestIdFromBody = "";
      if (rawBody) {
        try {
          const parsed = JSON.parse(rawBody);
          if (typeof parsed?.requestId === "string") {
            requestIdFromBody = String(parsed.requestId).trim();
          }
        } catch {
          requestIdFromBody = "";
        }
      }
      const requestId =
        requestIdFromHeader || requestIdFromBody || requestIdFromQuery || `debug_post_${Date.now()}`;
      console.log(
        `[EARNINGS][batch-route] requestId=${requestId} stage=debug-plain-hit ts=${nowIso()} method=${req.method} url=${req.originalUrl} remote=${
          req.ip ?? req.socket?.remoteAddress ?? "unknown"
        } contentType=${req.get("content-type") ?? "none"} contentLength=${
          req.get("content-length") ?? "none"
        } rawBytes=${Buffer.byteLength(rawBody ?? "", "utf8")}`,
      );
      const batch = earningsImportBatchManager.createBatch();
      console.log(
        `[EARNINGS][batch-route] requestId=${requestId} stage=debug-plain-respond ts=${nowIso()} batchId=${batch.batchId}`,
      );
      return res.json({
        ok: true,
        requestId,
        debug: true,
        route: "/api/earnings/import-batches/debug-plain",
        rawBodyLength: Buffer.byteLength(rawBody ?? "", "utf8"),
        ...batch,
        backendMarker: SIGNAL_BACKEND_MARKER,
        earningsBatchMarker: EARNINGS_BATCH_MARKER,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Failed to debug-plain earnings import batch.",
      });
    }
  },
);

app.post(
  "/api/earnings/import-batches/:batchId/files",
  earningsBatchUpload.array("files", 200),
  (req, res) => {
    try {
      const requestIdFromHeader =
        typeof req.get("X-Earnings-Batch-Request-Id") === "string"
          ? String(req.get("X-Earnings-Batch-Request-Id")).trim()
          : "";
      const requestId = requestIdFromHeader || `batch_upload_${Date.now()}`;
      const uploadFiles = Array.isArray(req.files) ? req.files : [];
      console.log(
        `[EARNINGS][batch-route] requestId=${requestId} stage=file-upload-hit batchId=${req.params.batchId} fileCount=${uploadFiles.length} files=${uploadFiles
          .map((file) => String(file.originalname ?? "unknown"))
          .join("|")}`,
      );
      if (uploadFiles.length === 0) {
        return res.status(400).json({
          ok: false,
          error: "No files uploaded for this batch.",
        });
      }
      const result = earningsImportBatchManager.addFiles({
        batchId: req.params.batchId,
        platform: req.body?.platform ?? "uber",
        files: uploadFiles,
      });
      console.log(
        `[EARNINGS][batch-route] requestId=${requestId} stage=file-upload-respond batchId=${req.params.batchId} uploadedCount=${result.files.length}`,
      );
      return res.json({
        ok: true,
        requestId,
        ...result,
        backendMarker: SIGNAL_BACKEND_MARKER,
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : "Failed to upload files to earnings import batch.",
      });
    }
  },
);

app.post("/api/earnings/import-batches/:batchId/commit", (req, res) => {
  try {
    const requestIdFromHeader =
      typeof req.get("X-Earnings-Batch-Request-Id") === "string"
        ? String(req.get("X-Earnings-Batch-Request-Id")).trim()
        : "";
    const requestIdFromBody =
      typeof req.body?.requestId === "string" ? String(req.body.requestId).trim() : "";
    const requestId =
      requestIdFromHeader ||
      requestIdFromBody ||
      `batch_commit_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    console.log(
      `[EARNINGS][batch-route] requestId=${requestId} stage=commit-hit batchId=${req.params.batchId}`,
    );
    const result = earningsImportBatchManager.commitBatch({
      batchId: req.params.batchId,
      requestId,
    });
    console.log(
      `[EARNINGS][batch-route] requestId=${requestId} stage=commit-respond batchId=${req.params.batchId} queuedCount=${result.queuedCount}`,
    );
    return res.json({
      ok: true,
      requestId,
      ...result,
      backendMarker: SIGNAL_BACKEND_MARKER,
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to commit earnings import batch.",
    });
  }
});

app.get("/api/earnings/import-batches/:batchId", (req, res) => {
  try {
    const batch = earningsImportBatchManager.getBatch(req.params.batchId);
    return res.json({
      ok: true,
      ...batch,
      backendMarker: SIGNAL_BACKEND_MARKER,
      serverVersion: SERVER_VERSION,
    });
  } catch (error) {
    return res.status(404).json({
      ok: false,
      error: error instanceof Error ? error.message : "Earnings import batch not found.",
    });
  }
});

app.get("/api/earnings/import-batches/:batchId/files", (req, res) => {
  try {
    const files = earningsImportBatchManager.listBatchFiles(req.params.batchId);
    return res.json({
      ok: true,
      batchId: req.params.batchId,
      files,
      backendMarker: SIGNAL_BACKEND_MARKER,
    });
  } catch (error) {
    return res.status(404).json({
      ok: false,
      error: error instanceof Error ? error.message : "Earnings import batch not found.",
    });
  }
});

app.post(EARNINGS_OCR_ROUTE, earningsUpload.array("screenshots", 10), async (req, res) => {
  const routeStartedAtMs = Date.now();
  const routeStartedAtIso = nowIso();
  try {
    const requestIdFromHeader =
      typeof req.get("X-Earnings-Ocr-Request-Id") === "string"
        ? String(req.get("X-Earnings-Ocr-Request-Id")).trim()
        : "";
    const requestIdFromBody =
      typeof req.body?.requestId === "string" ? String(req.body.requestId).trim() : "";
    const requestId = requestIdFromHeader || requestIdFromBody || `ocr_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    const contentLengthHeader = req.get("content-length") ?? "unknown";
    const uploadFiles = Array.isArray(req.files) ? req.files : [];
    const screenshotDiagnostics = uploadFiles.map((entry, index) => {
      return {
        index,
        fieldName: String(entry?.fieldname ?? "unknown"),
        fileName: String(entry?.originalname ?? `file_${index}`),
        mimeType: String(entry?.mimetype ?? "unknown"),
        payloadBytes: Number(entry?.size ?? 0),
      };
    });
    console.log(
      `[EARNINGS][route] requestId=${requestId} hit ts=${routeStartedAtIso} method=POST route=${EARNINGS_OCR_ROUTE} contentLength=${contentLengthHeader} files=${uploadFiles.length} marker=${EARNINGS_OCR_MARKER} uploads=${JSON.stringify(
        screenshotDiagnostics,
      )}`,
    );
    if (uploadFiles.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No screenshot files provided.",
        requestId,
        route: EARNINGS_OCR_ROUTE,
        backendMarker: SIGNAL_BACKEND_MARKER,
        earningsOcrMarker: EARNINGS_OCR_MARKER,
      });
    }
    const screenshots = uploadFiles.map((file) => ({
      fileName: String(file.originalname ?? "unknown_file"),
      mimeType: String(file.mimetype ?? req.body?.mimeType ?? "image/jpeg"),
      platformHint: req.body?.platform ?? req.body?.platformHint ?? "uber",
      binaryBuffer: Buffer.isBuffer(file.buffer) ? file.buffer : null,
    }));
    const result = await earningsOcrService.parseScreenshots({
      requestId,
      debugMode: req.body?.debugMode ?? null,
      screenshots,
    });
    const fileCount = Array.isArray(result?.files) ? result.files.length : 0;
    const durationMs = Date.now() - routeStartedAtMs;
    console.log(
      `[EARNINGS][route] requestId=${requestId} respond ts=${nowIso()} route=${EARNINGS_OCR_ROUTE} files=${fileCount} marker=${EARNINGS_OCR_MARKER} durationMs=${durationMs}`,
    );
    return res.json({
      ...result,
      requestId,
      routeDurationMs: durationMs,
      route: EARNINGS_OCR_ROUTE,
      backendMarker: SIGNAL_BACKEND_MARKER,
      earningsOcrMarker: EARNINGS_OCR_MARKER,
      serverVersion: SERVER_VERSION,
    });
  } catch (error) {
    const requestIdFromHeader =
      typeof req.get("X-Earnings-Ocr-Request-Id") === "string"
        ? String(req.get("X-Earnings-Ocr-Request-Id")).trim()
        : "";
    const requestIdFromBody =
      typeof req.body?.requestId === "string" ? String(req.body.requestId).trim() : "";
    const requestId = requestIdFromHeader || requestIdFromBody || "unknown";
    console.log(
      `[EARNINGS][route] requestId=${requestId} error ts=${nowIso()} route=${EARNINGS_OCR_ROUTE} marker=${EARNINGS_OCR_MARKER} durationMs=${
        Date.now() - routeStartedAtMs
      } error=${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to parse earnings screenshots.",
      requestId,
      route: EARNINGS_OCR_ROUTE,
      backendMarker: SIGNAL_BACKEND_MARKER,
      earningsOcrMarker: EARNINGS_OCR_MARKER,
    });
  }
});

app.post("/api/earnings/ping-upload", (req, res) => {
  const startedAtMs = Date.now();
  const requestIdFromHeader =
    typeof req.get("X-Earnings-Ocr-Request-Id") === "string"
      ? String(req.get("X-Earnings-Ocr-Request-Id")).trim()
      : "";
  const requestIdFromBody =
    typeof req.body?.requestId === "string" ? String(req.body.requestId).trim() : "";
  const requestId = requestIdFromHeader || requestIdFromBody || `ocr_ping_${Date.now()}`;
  const probe = String(req.body?.probe ?? "none");
  console.log(
    `[EARNINGS][ping] requestId=${requestId} hit ts=${nowIso()} route=/api/earnings/ping-upload probe=${probe} contentLength=${
      req.get("content-length") ?? "unknown"
    }`,
  );
  return res.json({
    ok: true,
    requestId,
    route: "/api/earnings/ping-upload",
    backendMarker: SIGNAL_BACKEND_MARKER,
    earningsOcrMarker: EARNINGS_OCR_MARKER,
    receivedBytes: 0,
    probe,
    respondedAt: nowIso(),
    durationMs: Date.now() - startedAtMs,
  });
});

app.post("/api/expenses/parse-receipt", async (req, res) => {
  try {
    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({
        ok: false,
        error: "Missing receipt payload.",
      });
    }
    const result = await receiptOcrService.parseReceipt(req.body);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to parse receipt.",
    });
  }
});

console.log(
  `[SERVER][startup] host=${HOST} port=${PORT} publicBaseUrl=${PUBLIC_BASE_URL} sampleLanUrl=${
    SAMPLE_LAN_IPV4 ? `http://${SAMPLE_LAN_IPV4}:${PORT}` : "unavailable"
  } healthUrl=${PUBLIC_BASE_URL}/api/signals/health earningsHealthUrl=${PUBLIC_BASE_URL}/api/earnings/health earningsRoute=${EARNINGS_OCR_ROUTE} version=${SERVER_VERSION} marker=${SIGNAL_BACKEND_MARKER}`,
);
const server = app.listen(PORT, HOST, () => {
  const cacheReset = signalPlatform.clearCaches?.() ?? {
    normalizedEntriesCleared: 0,
    diaryEntriesCleared: 0,
  };
  console.log(
    `[SERVER][listening] host=${HOST} port=${PORT} url=${PUBLIC_BASE_URL} sampleLanUrl=${
      SAMPLE_LAN_IPV4 ? `http://${SAMPLE_LAN_IPV4}:${PORT}` : "unavailable"
    } healthUrl=${PUBLIC_BASE_URL}/api/signals/health pid=${process.pid} startedAt=${SERVER_STARTED_AT} version=${SERVER_VERSION} marker=${SIGNAL_BACKEND_MARKER} cacheVersion=${
      signalPlatform.getCacheVersion?.() ?? "unknown"
    } cacheReset=${JSON.stringify(cacheReset)}`,
  );
  smartDiaryEngine.startPolling();
  console.log("[SMART_DIARY][polling] started");
  earningsImportBatchManager.startWorker();
});
server.on("error", (error) => {
  console.error(
    `[SERVER][listenError] message=${error instanceof Error ? error.message : "unknown"}`,
  );
});
server.on("close", () => {
  earningsImportBatchManager.stopWorker();
  console.log("[SERVER][close]");
});
