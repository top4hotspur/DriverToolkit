const fs = require("fs");
const path = require("path");

function createEarningsImportBatchManager(args) {
  const uploadsDir = String(args?.uploadsDir ?? "");
  const earningsOcrService = args?.earningsOcrService;
  const batchesDir = path.join(uploadsDir, "earnings-batches");
  if (!fs.existsSync(batchesDir)) {
    fs.mkdirSync(batchesDir, { recursive: true });
  }

  const batches = new Map();
  const queue = [];
  let queueTimer = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function toSafeSegment(value) {
    return String(value ?? "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120);
  }

  function makeId(prefix) {
    return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000000)
      .toString()
      .padStart(6, "0")}`;
  }

  function ensureBatch(batchId) {
    const batch = batches.get(batchId);
    if (!batch) {
      throw new Error("Batch not found.");
    }
    return batch;
  }

  function serializeBatch(batch) {
    return {
      batchId: batch.batchId,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      files: Array.from(batch.files.values()).map((entry) => ({
        fileId: entry.fileId,
        fileName: entry.fileName,
        mimeType: entry.mimeType,
        bytes: entry.bytes,
        status: entry.status,
        parseMethod: entry.parseMethod ?? null,
        rowsCreated: entry.rowsCreated ?? 0,
        detectedPeriodStart: entry.detectedPeriodStart ?? null,
        detectedPeriodEnd: entry.detectedPeriodEnd ?? null,
        detectedTotal: entry.detectedTotal ?? null,
        batchConfidence: entry.batchConfidence ?? null,
        failureReason: entry.failureReason ?? null,
        highlightReason: entry.highlightReason ?? null,
        parseError: entry.parseError ?? null,
        requestId: entry.requestId ?? null,
        platform: entry.platform ?? null,
        storedPath: entry.storedPath ?? null,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
    };
  }

  function persistBatchSnapshot(batch) {
    try {
      const snapshotPath = path.join(batch.batchDir, "batch.json");
      fs.writeFileSync(snapshotPath, JSON.stringify(serializeBatch(batch), null, 2), "utf8");
    } catch (error) {
      console.log(
        `[EARNINGS][batch] snapshot-fail batchId=${batch.batchId} error=${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  }

  function summarizeBatch(batch) {
    const files = Array.from(batch.files.values());
    const counts = {
      totalFiles: files.length,
      uploadedCount: files.filter((entry) => entry.status === "uploaded").length,
      queuedCount: files.filter((entry) => entry.status === "queued").length,
      processingCount: files.filter((entry) => entry.status === "processing").length,
      parsedCount: files.filter((entry) => entry.status === "parsed").length,
      needsReviewCount: files.filter((entry) => entry.status === "needs_review").length,
      failedCount: files.filter((entry) => entry.status === "failed").length,
    };
    return {
      batchId: batch.batchId,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      status: deriveBatchStatus(counts),
      ...counts,
    };
  }

  function deriveBatchStatus(counts) {
    if (counts.processingCount > 0) return "processing";
    if (counts.queuedCount > 0) return "queued";
    if (counts.uploadedCount > 0 && counts.parsedCount === 0 && counts.failedCount === 0) {
      return "uploaded";
    }
    if (counts.totalFiles > 0 && counts.parsedCount + counts.needsReviewCount + counts.failedCount === counts.totalFiles) {
      return "completed";
    }
    return "created";
  }

  function listBatchFiles(batchId) {
    const batch = ensureBatch(batchId);
    return Array.from(batch.files.values())
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((entry) => ({
        fileId: entry.fileId,
        batchId: batch.batchId,
        fileName: entry.fileName,
        mimeType: entry.mimeType,
        bytes: entry.bytes,
        status: entry.status,
        parseMethod: entry.parseMethod ?? null,
        rowsCreated: entry.rowsCreated ?? 0,
        detectedPeriodStart: entry.detectedPeriodStart ?? null,
        detectedPeriodEnd: entry.detectedPeriodEnd ?? null,
        detectedTotal: entry.detectedTotal ?? null,
        batchConfidence: entry.batchConfidence ?? null,
        failureReason: entry.failureReason ?? null,
        highlightReason: entry.highlightReason ?? null,
        parseError: entry.parseError ?? null,
        requestId: entry.requestId ?? null,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      }));
  }

  function createBatch() {
    const batchId = makeId("earnings_batch");
    const createdAt = nowIso();
    const batchDir = path.join(batchesDir, toSafeSegment(batchId));
    fs.mkdirSync(batchDir, { recursive: true });
    const batch = {
      batchId,
      createdAt,
      updatedAt: createdAt,
      batchDir,
      files: new Map(),
    };
    batches.set(batchId, batch);
    persistBatchSnapshot(batch);
    console.log(`[EARNINGS][batch] create batchId=${batchId} createdAt=${createdAt}`);
    return summarizeBatch(batch);
  }

  function addFiles(argsForFiles) {
    const batch = ensureBatch(argsForFiles.batchId);
    const files = Array.isArray(argsForFiles.files) ? argsForFiles.files : [];
    const platform = String(argsForFiles.platform ?? "uber").toLowerCase();
    const added = [];
    for (const uploadFile of files) {
      const fileId = makeId("earnings_file");
      const safeName = toSafeSegment(uploadFile.originalname || uploadFile.filename || `${fileId}.jpg`) || `${fileId}.jpg`;
      const storedPath = path.join(batch.batchDir, `${fileId}_${safeName}`);
      const bytes = Number(uploadFile.size ?? 0);
      fs.writeFileSync(storedPath, uploadFile.buffer);
      const timestamp = nowIso();
      const record = {
        fileId,
        fileName: uploadFile.originalname || safeName,
        mimeType: uploadFile.mimetype || "image/jpeg",
        bytes,
        status: "uploaded",
        parseMethod: null,
        rowsCreated: 0,
        detectedPeriodStart: null,
        detectedPeriodEnd: null,
        detectedTotal: null,
        batchConfidence: null,
        failureReason: null,
        highlightReason: null,
        parseError: null,
        requestId: null,
        platform,
        storedPath,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      batch.files.set(fileId, record);
      added.push({
        fileId,
        batchId: batch.batchId,
        fileName: record.fileName,
        status: record.status,
      });
      console.log(
        `[EARNINGS][batch] upload batchId=${batch.batchId} fileId=${fileId} fileName=${record.fileName} mimeType=${record.mimeType} bytes=${bytes} status=${record.status}`,
      );
    }
    batch.updatedAt = nowIso();
    persistBatchSnapshot(batch);
    return {
      batch: summarizeBatch(batch),
      files: added,
    };
  }

  function commitBatch(argsForCommit) {
    const batch = ensureBatch(argsForCommit.batchId);
    const requestId = String(argsForCommit.requestId ?? makeId("batch_commit"));
    let queuedCount = 0;
    for (const file of batch.files.values()) {
      if (file.status === "uploaded" || file.status === "failed") {
        file.status = "queued";
        file.failureReason = null;
        file.requestId = requestId;
        file.updatedAt = nowIso();
        queue.push({
          batchId: batch.batchId,
          fileId: file.fileId,
          requestId,
        });
        queuedCount += 1;
      }
    }
    batch.updatedAt = nowIso();
    persistBatchSnapshot(batch);
    startWorker();
    console.log(
      `[EARNINGS][batch] commit batchId=${batch.batchId} requestId=${requestId} queued=${queuedCount}`,
    );
    return {
      batch: summarizeBatch(batch),
      queuedCount,
    };
  }

  async function processNextQueueItem() {
    const next = queue.shift();
    if (!next) {
      return;
    }
    const batch = batches.get(next.batchId);
    if (!batch) {
      return;
    }
    const file = batch.files.get(next.fileId);
    if (!file) {
      return;
    }
    if (file.status !== "queued") {
      return;
    }
    const startedAtMs = Date.now();
    file.status = "processing";
    file.updatedAt = nowIso();
    batch.updatedAt = nowIso();
    persistBatchSnapshot(batch);
    console.log(
      `[EARNINGS][batch-worker] start batchId=${batch.batchId} fileId=${file.fileId} requestId=${next.requestId} fileName=${file.fileName}`,
    );
    try {
      const buffer = fs.readFileSync(file.storedPath);
      const parseResult = await earningsOcrService.parseScreenshots({
        requestId: next.requestId,
        screenshots: [
          {
            fileName: file.fileName,
            mimeType: file.mimeType,
            platformHint: file.platform,
            binaryBuffer: buffer,
          },
        ],
      });
      const parsedFile = Array.isArray(parseResult?.files) ? parseResult.files[0] : null;
      if (!parsedFile) {
        throw new Error("missing_parse_result");
      }
      const lowConfidence = Number(parsedFile.lowConfidenceRowCount ?? 0);
      const parseError = parsedFile.parseError ? String(parsedFile.parseError) : null;
      const rowsCreated = Number(parsedFile.rowsExtractedCount ?? 0);
      const highlightReason =
        parsedFile.detectedPeriodStart &&
        parsedFile.detectedPeriodEnd &&
        parsedFile.detectedTotal != null &&
        rowsCreated <= 1
          ? "weekly_chart_single_row"
          : null;

      file.parseMethod = parsedFile.parseMethod ?? null;
      file.rowsCreated = rowsCreated;
      file.detectedPeriodStart = parsedFile.detectedPeriodStart ?? null;
      file.detectedPeriodEnd = parsedFile.detectedPeriodEnd ?? null;
      file.detectedTotal =
        Number.isFinite(Number(parsedFile.detectedTotal)) ? Number(parsedFile.detectedTotal) : null;
      file.batchConfidence = parsedFile.batchConfidence ?? null;
      file.parseError = parseError;
      file.highlightReason = highlightReason;
      file.failureReason = null;
      file.status =
        parseError || lowConfidence > 0 || parsedFile.batchConfidence === "low"
          ? "needs_review"
          : "parsed";
      file.updatedAt = nowIso();
      batch.updatedAt = nowIso();
      persistBatchSnapshot(batch);
      console.log(
        `[EARNINGS][batch-worker] complete batchId=${batch.batchId} fileId=${file.fileId} requestId=${next.requestId} status=${file.status} parseMethod=${
          file.parseMethod ?? "n/a"
        } rowsCreated=${file.rowsCreated} durationMs=${Date.now() - startedAtMs}`,
      );
    } catch (error) {
      file.status = "failed";
      file.failureReason = error instanceof Error ? error.message : "processing_failed";
      file.updatedAt = nowIso();
      batch.updatedAt = nowIso();
      persistBatchSnapshot(batch);
      console.log(
        `[EARNINGS][batch-worker] fail batchId=${batch.batchId} fileId=${file.fileId} requestId=${next.requestId} error=${file.failureReason} durationMs=${
          Date.now() - startedAtMs
        }`,
      );
    }
  }

  function startWorker() {
    if (queueTimer) {
      return;
    }
    queueTimer = setInterval(() => {
      void processNextQueueItem();
    }, 300);
    console.log("[EARNINGS][batch-worker] started");
  }

  function stopWorker() {
    if (!queueTimer) {
      return;
    }
    clearInterval(queueTimer);
    queueTimer = null;
    console.log("[EARNINGS][batch-worker] stopped");
  }

  function getBatch(batchId) {
    const batch = ensureBatch(batchId);
    return summarizeBatch(batch);
  }

  return {
    startWorker,
    stopWorker,
    createBatch,
    addFiles,
    commitBatch,
    getBatch,
    listBatchFiles,
  };
}

module.exports = {
  createEarningsImportBatchManager,
};
