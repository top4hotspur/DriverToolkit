export type CloudUploadStatus = "local-only" | "queued" | "uploaded" | "failed";

export interface ReceiptFileMetadata {
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
  type: "fuel" | "other";
  amount: number;
  occurredOn: string;
  note: string | null;
  receiptFileId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PresignedUploadIntent {
  objectKey: string;
  contentType: string;
  expiresInSeconds: number;
  method: "PUT";
  presignedUrl: string;
}
