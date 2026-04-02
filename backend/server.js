const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;
const HOST = "0.0.0.0";
const PUBLIC_BASE_URL = "http://192.168.0.191:3000";
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const imports = new Map();

function nowIso() {
  return new Date().toISOString();
}

function normalizeHeader(header) {
  return String(header ?? "")
    .trim()
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
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

function resolveTimestampField(headers, preferredField) {
  const normalizedToRaw = new Map(
    headers.map((header) => [normalizeHeader(header), header])
  );

  const preferredNormalized = normalizeHeader(preferredField);
  if (normalizedToRaw.has(preferredNormalized)) {
    return normalizedToRaw.get(preferredNormalized);
  }

  return null;
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

function computeFirstPassMatchingSummary(
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
    },
  };
}

function summarizeCsvEntry(zip, entryName, preferredTimestampField) {
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
    preferredTimestampField
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
    locationEnrichedTrips: 3012,
  };

  const summary = {
    ...defaultSummary,
    ...(record.summary ?? {}),
  };

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
      "event_time_utc"
    );
    stageReached = "csv_extract_complete";
    console.log("[IMPORT][confirm] stage=csv_extract_complete");

    const matchingSummary = computeFirstPassMatchingSummary(
      tripsSummary.dataRows,
      paymentsSummary.dataRows,
      tripsSummary.timestampFieldUsed,
      paymentsSummary.timestampFieldUsed
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
    stageReached = "date_ranges_complete";
    console.log("[IMPORT][confirm] stage=date_ranges_complete");
    console.log(
      `[IMPORT][confirm] matching tripsConsidered=${matchingSummary.diagnostics.tripsConsidered} paymentsConsidered=${matchingSummary.diagnostics.paymentsConsidered} tripTimestampField=${tripsSummary.timestampFieldUsed} paymentTimestampField=${paymentsSummary.timestampFieldUsed}`
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

app.listen(PORT, HOST, () => {
  console.log(`Driver Toolkit backend running at ${PUBLIC_BASE_URL}`);
});
