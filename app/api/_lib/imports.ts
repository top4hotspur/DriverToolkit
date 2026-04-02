import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  BackendImportDiagnostics,
  BackendImportStage,
  BackendImportSummary,
  ImportStageTiming,
  ImportStatusResponse,
} from "../../../src/contracts/cloudStorage";
import { buildUberTripPaymentArtifactsFromZip } from "../../../src/engines/import/uberTripPaymentMatching";
import { ImportFileDescriptor } from "../../../src/engines/import/adapters";
import {
  buildUberImportObjectKey,
  getDynamoClient,
  getImportsBucket,
  getImportsTableName,
  getS3Client,
} from "./aws";

const ddbDoc = DynamoDBDocumentClient.from(getDynamoClient(), {
  marshallOptions: { removeUndefinedValues: true },
});

const PRESIGN_EXPIRY_SECONDS = 900;

type ImportRecord = {
  userId: string;
  importId: string;
  provider: "uber";
  sourceFileName: string;
  objectKey: string;
  bucket: string;
  stage: BackendImportStage;
  startedAt: string;
  finishedAt: string | null;
  progressPercent: number;
  stageTimings: ImportStageTiming[];
  summary: BackendImportSummary | null;
  diagnostics: BackendImportDiagnostics | null;
  warnings: string[];
  errors: string[];
  createdAt: string;
  updatedAt: string;
};

export async function createUberImportSession(args: {
  userId: string;
  sourceFileName: string;
  mimeType?: string;
}): Promise<{ importId: string; objectKey: string; uploadUrl: string; expiresInSeconds: number; stage: BackendImportStage }> {
  const importId = crypto.randomUUID();
  const bucket = getImportsBucket();
  const objectKey = buildUberImportObjectKey({
    userId: args.userId,
    importId,
    sourceFileName: args.sourceFileName,
  });
  const now = new Date().toISOString();
  const stageTimings = [createStageTiming("created", now)];

  const record: ImportRecord = {
    userId: args.userId,
    importId,
    provider: "uber",
    sourceFileName: args.sourceFileName,
    objectKey,
    bucket,
    stage: "created",
    startedAt: now,
    finishedAt: null,
    progressPercent: 0,
    stageTimings,
    summary: null,
    diagnostics: null,
    warnings: [],
    errors: [],
    createdAt: now,
    updatedAt: now,
  };

  await ddbDoc.send(
    new PutCommand({
      TableName: getImportsTableName(),
      Item: record,
    }),
  );

  const uploadUrl = await getSignedUrl(
    getS3Client(),
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: args.mimeType ?? "application/zip",
    }),
    { expiresIn: PRESIGN_EXPIRY_SECONDS },
  );

  return {
    importId,
    objectKey,
    uploadUrl,
    expiresInSeconds: PRESIGN_EXPIRY_SECONDS,
    stage: "created",
  };
}

export async function getImportStatus(args: { userId: string; importId: string }): Promise<ImportStatusResponse | null> {
  const record = await getImportRecord(args);
  if (!record) {
    return null;
  }
  return toStatusResponse(record);
}

export async function markImportUploading(args: { userId: string; importId: string }): Promise<void> {
  await updateImportStage({
    ...args,
    stage: "uploading",
    progressPercent: 5,
  });
}

export async function markImportUploaded(args: { userId: string; importId: string }): Promise<void> {
  await updateImportStage({
    ...args,
    stage: "uploaded",
    progressPercent: 15,
  });
}

export async function processUberImport(args: { userId: string; importId: string }): Promise<void> {
  const record = await getImportRecord(args);
  if (!record) {
    return;
  }

  try {
    await updateImportStage({ ...args, stage: "parsing", progressPercent: 30 });
    const zipBuffer = await downloadZip(record.bucket, record.objectKey);
    const descriptor: ImportFileDescriptor = {
      fileName: record.sourceFileName,
      extension: "zip",
      mimeType: "application/zip",
      byteLength: zipBuffer.length,
      contentsBase64: zipBuffer.toString("base64"),
    };

    await updateImportStage({ ...args, stage: "validating", progressPercent: 45 });
    const artifacts = await buildUberTripPaymentArtifactsFromZip(descriptor);

    await updateImportStage({ ...args, stage: "matching", progressPercent: 70 });
    await updateImportStage({ ...args, stage: "enriching", progressPercent: 85 });

    const summary = buildSummaryFromArtifacts(artifacts);
    const diagnostics: BackendImportDiagnostics = {
      rowsParsed: {
        trips: artifacts.tripCandidates.length,
        payments: artifacts.paymentGroups.reduce((sum, group) => sum + group.rawRows.length, 0),
        analytics: artifacts.analyticsInference.length,
      },
      matchesCreated: artifacts.matchedTrips.length,
      analyticsCoverage:
        artifacts.validation.overlap.tripsAnalyticsOverlap === false
          ? "none"
          : artifacts.validation.warnings.some((warning) => warning.toLowerCase().includes("partial"))
            ? "partial"
            : "full",
      failureReason: null,
    };

    const finishedAt = new Date().toISOString();
    const finalTimings = closeAndAppendStageTiming(record.stageTimings, "completed", finishedAt);
    await ddbDoc.send(
      new UpdateCommand({
        TableName: getImportsTableName(),
        Key: { userId: args.userId, importId: args.importId },
        UpdateExpression:
          "SET #stage = :stage, progressPercent = :progressPercent, finishedAt = :finishedAt, summary = :summary, diagnostics = :diagnostics, warnings = :warnings, errors = :errors, stageTimings = :stageTimings, updatedAt = :updatedAt",
        ExpressionAttributeNames: {
          "#stage": "stage",
        },
        ExpressionAttributeValues: {
          ":stage": "completed",
          ":progressPercent": 100,
          ":finishedAt": finishedAt,
          ":summary": summary,
          ":diagnostics": diagnostics,
          ":warnings": artifacts.validation.warnings,
          ":errors": artifacts.validation.userFacingError ? [artifacts.validation.userFacingError] : [],
          ":stageTimings": finalTimings,
          ":updatedAt": finishedAt,
        },
      }),
    );
  } catch (error) {
    const failedAt = new Date().toISOString();
    await failImport({
      ...args,
      failureReason: error instanceof Error ? error.message : "Import processing failed.",
      failedAt,
    });
  }
}

async function failImport(args: {
  userId: string;
  importId: string;
  failureReason: string;
  failedAt: string;
}): Promise<void> {
  const record = await getImportRecord(args);
  const nextTimings = closeAndAppendStageTiming(record?.stageTimings ?? [], "failed", args.failedAt);
  await ddbDoc.send(
    new UpdateCommand({
      TableName: getImportsTableName(),
      Key: { userId: args.userId, importId: args.importId },
      UpdateExpression:
        "SET #stage = :stage, progressPercent = :progressPercent, finishedAt = :finishedAt, diagnostics = :diagnostics, errors = :errors, stageTimings = :stageTimings, updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#stage": "stage",
      },
      ExpressionAttributeValues: {
        ":stage": "failed",
        ":progressPercent": 100,
        ":finishedAt": args.failedAt,
        ":diagnostics": {
          rowsParsed: { trips: 0, payments: 0, analytics: 0 },
          matchesCreated: 0,
          analyticsCoverage: "none",
          failureReason: args.failureReason,
        } satisfies BackendImportDiagnostics,
        ":errors": [args.failureReason],
        ":stageTimings": nextTimings,
        ":updatedAt": args.failedAt,
      },
    }),
  );
}

async function getImportRecord(args: { userId: string; importId: string }): Promise<ImportRecord | null> {
  const result = await ddbDoc.send(
    new GetCommand({
      TableName: getImportsTableName(),
      Key: { userId: args.userId, importId: args.importId },
    }),
  );
  return (result.Item as ImportRecord | undefined) ?? null;
}

async function updateImportStage(args: {
  userId: string;
  importId: string;
  stage: BackendImportStage;
  progressPercent: number;
}): Promise<void> {
  const existing = await getImportRecord(args);
  const now = new Date().toISOString();
  const nextTimings = closeAndAppendStageTiming(existing?.stageTimings ?? [], args.stage, now);
  await ddbDoc.send(
    new UpdateCommand({
      TableName: getImportsTableName(),
      Key: { userId: args.userId, importId: args.importId },
      UpdateExpression:
        "SET #stage = :stage, progressPercent = :progressPercent, stageTimings = :stageTimings, updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#stage": "stage",
      },
      ExpressionAttributeValues: {
        ":stage": args.stage,
        ":progressPercent": args.progressPercent,
        ":stageTimings": nextTimings,
        ":updatedAt": now,
      },
    }),
  );
}

async function downloadZip(bucket: string, key: string): Promise<Buffer> {
  const response = await getS3Client().send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
  const body = response.Body;
  if (!body) {
    throw new Error("Uploaded ZIP could not be read from S3.");
  }
  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function createStageTiming(stage: BackendImportStage, startedAt: string): ImportStageTiming {
  return {
    stage,
    startedAt,
    finishedAt: null,
    durationMs: null,
  };
}

function closeAndAppendStageTiming(
  existing: ImportStageTiming[],
  nextStage: BackendImportStage,
  nowIso: string,
): ImportStageTiming[] {
  const next = [...existing];
  const last = next[next.length - 1];
  if (last && !last.finishedAt) {
    last.finishedAt = nowIso;
    last.durationMs = Math.max(0, Date.parse(nowIso) - Date.parse(last.startedAt));
  }
  if (!last || last.stage !== nextStage) {
    next.push(createStageTiming(nextStage, nowIso));
  }
  return next;
}

function buildSummaryFromArtifacts(
  artifacts: Awaited<ReturnType<typeof buildUberTripPaymentArtifactsFromZip>>,
): BackendImportSummary {
  const reimbursementsDetected = artifacts.paymentGroups.reduce(
    (sum, group) => sum + group.totals.reimbursementTotal + group.totals.adjustmentTotal,
    0,
  );
  return {
    tripsFileFound: artifacts.discovery.tripsFileFound,
    paymentsFileFound: artifacts.discovery.paymentsFileFound,
    analyticsFileFound: artifacts.discovery.analyticsFileFound,
    ignoredFilesCount: artifacts.discovery.ignoredFilesCount,
    tripsDateRange: artifacts.validation.trips.range,
    paymentsDateRange: artifacts.validation.payments.range,
    analyticsDateRange: artifacts.validation.analytics?.range ?? null,
    matchedTrips: artifacts.matchedTrips.length,
    unmatchedTrips: artifacts.unmatchedTrips.length,
    unmatchedPayments: artifacts.unmatchedPaymentGroups.length,
    ambiguousMatches: artifacts.ambiguousMatches.length,
    reimbursementsDetected,
    analyticsCoverageRange: artifacts.validation.analytics?.range ?? null,
    locationEnrichedTrips: artifacts.analyticsInference.filter(
      (item) => item.inferredStart !== null || item.inferredEnd !== null,
    ).length,
  };
}

function toStatusResponse(record: ImportRecord): ImportStatusResponse {
  return {
    importId: record.importId,
    userId: record.userId,
    provider: record.provider,
    sourceFileName: record.sourceFileName,
    objectKey: record.objectKey,
    stage: record.stage,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    progressPercent: record.progressPercent,
    stageTimings: record.stageTimings,
    summary: record.summary,
    diagnostics: record.diagnostics,
    warnings: record.warnings,
    errors: record.errors,
  };
}
