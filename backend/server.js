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
    tripsDateRange: {
      startAt: "2024-05-10T23:42:58.000Z",
      endAt: "2026-03-31T23:59:59.000Z",
    },
    paymentsDateRange: {
      startAt: "2024-05-10T23:42:58.000Z",
      endAt: "2026-03-31T23:59:59.000Z",
    },
    analyticsDateRange: {
      startAt: "2026-03-01T00:00:00.000Z",
      endAt: "2026-03-31T23:59:59.000Z",
    },
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
        trips: 10669,
        payments: 32145,
        analytics: 263943,
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

    const tripsEntryName = entryNames.find((entryName) =>
      entryName.toLowerCase().includes("trips")
    ) ?? null;
    const paymentsEntryName = entryNames.find((entryName) =>
      entryName.toLowerCase().includes("payment")
    ) ?? null;
    const analyticsEntryName = entryNames.find((entryName) => {
      const lower = entryName.toLowerCase();
      return lower.includes("analytics") || lower.includes("earnings");
    }) ?? null;

    const tripsFileFound = names.some((name) => name.includes("trips"));
    const paymentsFileFound = names.some((name) => name.includes("payment"));
    const analyticsFileFound = names.some(
      (name) => name.includes("analytics") || name.includes("earnings")
    );
    console.log(`[IMPORT][confirm] detected trips=${tripsEntryName}`);
    console.log(`[IMPORT][confirm] detected payments=${paymentsEntryName}`);
    console.log(`[IMPORT][confirm] detected analytics=${analyticsEntryName}`);

    const ignoredFilesCount = names.filter((name) => {
      const isTrips = name.includes("trips");
      const isPayments = name.includes("payment");
      const isAnalytics = name.includes("analytics") || name.includes("earnings");
      return !isTrips && !isPayments && !isAnalytics;
    }).length;
    console.log(`[IMPORT][confirm] ignoredFilesCount=${ignoredFilesCount}`);

    record.summary = {
      ...(record.summary ?? {}),
      tripsFileFound,
      paymentsFileFound,
      analyticsFileFound,
      ignoredFilesCount,
    };
    console.log(
      `[IMPORT][confirm] summary=${JSON.stringify(record.summary)}`
    );

    record.stage = "parsing";
    record.progressPercent = 50;
    record.updatedAt = nowIso();

    imports.set(importId, record);

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
    return res.status(500).json({
      ok: false,
      status: "failed",
      error: error instanceof Error ? error.message : "ZIP detection failed.",
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
