export interface ReceiptUploadPayload {
  receiptFileId: string;
  localUri: string;
  mimeType: string | null;
  originalFileName: string | null;
}

export interface CloudExpenseSyncPayload {
  expense: {
    expenseId: string;
    userId: string;
    category: string;
    expenseType: string;
    paymentMethod: string;
    amountGbp: number;
    expenseDate: string;
    note: string | null;
    receiptRequiredStatus: string;
    receiptFileId: string | null;
    fuelLitres: number | null;
    fuelPricePerLitre: number | null;
    fuelTotal: number | null;
    createdAt: string;
    updatedAt: string;
  };
  receipt: {
    fileId: string;
    mimeType: string | null;
    originalFilename: string | null;
    fileSizeBytes: number | null;
    storageProvider: "s3";
    cloudObjectKey: string | null;
    uploadStatus: string;
    uploadedAt: string | null;
  } | null;
}

export interface CloudSyncResult {
  ok: boolean;
  objectKey?: string;
  error?: string;
}

export function canSyncToCloud(): boolean {
  return false;
}

export async function uploadReceiptToCloud(_: { userId: string; file: ReceiptUploadPayload }): Promise<CloudSyncResult> {
  return {
    ok: false,
    error: "Cloud sync not configured for this environment.",
  };
}

export async function syncExpenseMetadataToCloud(_: CloudExpenseSyncPayload): Promise<CloudSyncResult> {
  return {
    ok: false,
    error: "Cloud sync not configured for this environment.",
  };
}

