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

export interface CloudSyncConfig {
  apiBaseUrl: string;
  region: string;
  receiptsBucket: string;
  importsBucket: string;
}
