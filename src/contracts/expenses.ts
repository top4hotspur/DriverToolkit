export type ExpenseType = "fuel" | "parking" | "cleaning" | "food" | "toll" | "other";

export type ExpensePaymentMethod = "cash" | "card" | "other";

export type ReceiptRequiredStatus = "attached" | "none" | "add_later";

export type ReceiptSourceType = "camera" | "file-upload";

export type LocalSyncStatus = "saved-local" | "syncing" | "synced" | "needs-retry";

export type UploadStatus = "queued" | "uploading" | "uploaded" | "failed";

export type SyncStatus = "pending" | "syncing" | "synced" | "failed";

export interface ExpenseInput {
  type: ExpenseType;
  paymentMethod: ExpensePaymentMethod;
  amountGbp: number;
  expenseDate: string;
  note?: string | null;
  receiptRequiredStatus: ReceiptRequiredStatus;
  receiptSourceType?: ReceiptSourceType | null;
  localReceiptUri?: string | null;
  mimeType?: string | null;
  originalFileName?: string | null;
  fileSizeBytes?: number | null;
  fuelLitres?: number | null;
  fuelPricePerLitre?: number | null;
  fuelTotal?: number | null;
  confirmedFuelPricePerLitre?: number | null;
}

export interface ExpenseRecord {
  id: string;
  userId: string;
  type: ExpenseType;
  paymentMethod: ExpensePaymentMethod;
  amountGbp: number;
  expenseDate: string;
  note: string | null;
  receiptRequiredStatus: ReceiptRequiredStatus;
  receiptFileId: string | null;
  fuelLitres: number | null;
  fuelPricePerLitre: number | null;
  fuelTotal: number | null;
  createdAt: string;
  updatedAt: string;
  localSyncStatus: LocalSyncStatus;
  cloudSyncedAt: string | null;
  localReceiptUri: string | null;
}

export interface ReceiptFileMetadata {
  fileId: string;
  expenseId: string;
  localUri: string;
  mimeType: string | null;
  originalFilename: string | null;
  fileSizeBytes: number | null;
  storageProvider: "s3" | "local-only";
  cloudObjectKey: string | null;
  uploadStatus: UploadStatus;
  uploadedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncJobRecord {
  id: string;
  entityType: "expense" | "receipt_file" | "privacy_import_file";
  entityId: string;
  syncStatus: SyncStatus;
  lastError: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseSaveResult {
  ok: boolean;
  expenseId: string;
  localSyncStatus: LocalSyncStatus;
  fuelPriceUpdated: boolean;
  warning?: string;
}
