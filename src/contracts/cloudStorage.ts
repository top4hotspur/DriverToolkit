import { ExpenseRecord, SyncJobRecord } from "./expenses";

export type CloudUploadStatus = "local-only" | "queued" | "uploading" | "uploaded" | "failed";

export interface CloudReceiptFileMetadata {
  receiptFileId: string;
  expenseId: string | null;
  localUri: string;
  mimeType: string | null;
  originalFileName: string | null;
  fileSizeBytes: number | null;
  objectKey: string | null;
  bucket: string | null;
  region: string | null;
  uploadStatus: CloudUploadStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PrivacyImportFileMetadata {
  importFileId: string;
  provider: "uber" | "bolt" | "lyft";
  sourceFileName: string;
  localUri: string | null;
  fileSizeBytes: number | null;
  objectKey: string | null;
  bucket: string | null;
  region: string | null;
  uploadStatus: CloudUploadStatus;
  importedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseCloudRecord {
  expenseId: string;
  userId: string;
  category: ExpenseRecord["category"];
  expenseType: ExpenseRecord["expenseType"];
  amountGbp: number;
  expenseDate: string;
  paymentMethod: ExpenseRecord["paymentMethod"];
  note: string | null;
  receiptRequiredStatus: ExpenseRecord["receiptRequiredStatus"];
  receiptFileId: string | null;
  fuelLitres: number | null;
  fuelPricePerLitre: number | null;
  fuelTotal: number | null;
  localSyncStatus: ExpenseRecord["localSyncStatus"];
  cloudSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseSyncEnvelope {
  expense: ExpenseRecord;
  receiptFile: CloudReceiptFileMetadata | null;
  syncJob: SyncJobRecord | null;
}

export interface DynamoExpenseMetadataRecord {
  pk: string; // USER#{userId}
  sk: string; // EXPENSE#{expenseId}
  entityType: "expense";
  payload: ExpenseCloudRecord;
  updatedAt: string;
}

export interface DynamoReceiptMetadataRecord {
  pk: string; // USER#{userId}
  sk: string; // RECEIPT#{fileId}
  entityType: "receipt_file";
  payload: CloudReceiptFileMetadata;
  updatedAt: string;
}

export interface DynamoSyncJobRecord {
  pk: string; // USER#{userId}
  sk: string; // SYNC#{entityType}#{entityId}
  entityType: "sync_job";
  payload: SyncJobRecord;
  updatedAt: string;
}

export interface PresignedUploadIntent {
  objectKey: string;
  contentType: string;
  expiresInSeconds: number;
  method: "PUT";
  presignedUrl: string;
}

export interface ExpensePresignRequest {
  userId: string;
  expenseId: string;
  fileType: string;
}

export interface ExpensePresignResponse extends PresignedUploadIntent {}

export interface ExpenseSaveApiRequest {
  expenseId: string;
  userId: string;
  amount: number;
  category: ExpenseRecord["category"];
  type: ExpenseRecord["expenseType"];
  date: string;
  paymentMethod: ExpenseRecord["paymentMethod"];
  note: string | null;
  receiptRequiredStatus: ExpenseRecord["receiptRequiredStatus"];
  receiptS3Key: string | null;
  fuelLitres: number | null;
  fuelPricePerLitre: number | null;
  fuelTotal: number | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: ExpenseRecord["localSyncStatus"];
  receiptFileMetadata?: {
    fileId: string;
    mimeType: string | null;
    originalFilename: string | null;
    fileSizeBytes: number | null;
  } | null;
}

export interface CloudSyncConfig {
  apiBaseUrl: string;
  region: string;
  receiptsBucket: string;
  importsBucket: string;
}

export type BackendImportStage =
  | "created"
  | "uploading"
  | "uploaded"
  | "parsing"
  | "validating"
  | "matching"
  | "enriching"
  | "completed"
  | "failed";

export interface ImportStageTiming {
  stage: BackendImportStage;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface BackendImportSummary {
  tripsFileFound: boolean;
  paymentsFileFound: boolean;
  analyticsFileFound: boolean;
  ignoredFilesCount: number;
  tripsDateRange: { startAt: string | null; endAt: string | null };
  paymentsDateRange: { startAt: string | null; endAt: string | null };
  analyticsDateRange: { startAt: string | null; endAt: string | null } | null;
  matchedTrips: number;
  unmatchedTrips: number;
  unmatchedPayments: number;
  ambiguousMatches: number;
  reimbursementsDetected: number;
  analyticsCoverageRange: { startAt: string | null; endAt: string | null } | null;
  locationEnrichedTrips: number;
}

export interface BackendImportDiagnostics {
  rowsParsed: {
    trips: number;
    payments: number;
    analytics: number;
  };
  matchesCreated: number;
  analyticsCoverage: "none" | "partial" | "full";
  failureReason: string | null;
}

export interface CreateImportSessionRequest {
  userId: string;
  provider: "uber";
  sourceFileName: string;
  mimeType?: string;
}

export interface CreateImportSessionResponse {
  importId: string;
  objectKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
  stage: BackendImportStage;
}

export interface ConfirmImportUploadRequest {
  userId: string;
  importId: string;
}

export interface ImportStatusResponse {
  importId: string;
  userId: string;
  provider: "uber";
  sourceFileName: string;
  selectedFileName?: string;
  objectKey: string;
  stage: BackendImportStage;
  status?: BackendImportStage;
  startedAt: string;
  updatedAt?: string;
  finishedAt: string | null;
  progressPercent: number;
  stageTimings: ImportStageTiming[];
  summary: BackendImportSummary | null;
  diagnostics: BackendImportDiagnostics | null;
  warnings: string[];
  errors: string[];
}
