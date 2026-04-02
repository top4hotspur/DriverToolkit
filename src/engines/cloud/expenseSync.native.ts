import { buildReceiptUploadIntent, getCloudSyncConfig } from "./storageScaffold";

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
    type: string;
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
  return getCloudSyncConfig() !== null;
}

export async function uploadReceiptToCloud(args: {
  userId: string;
  file: ReceiptUploadPayload;
}): Promise<CloudSyncResult> {
  const config = getCloudSyncConfig();
  if (!config) {
    return {
      ok: false,
      error: "Cloud sync endpoint is not configured.",
    };
  }

  try {
    const intent = await buildReceiptUploadIntent({
      userId: args.userId,
      receiptFileId: args.file.receiptFileId,
      mimeType: args.file.mimeType ?? "application/octet-stream",
      originalFileName: args.file.originalFileName ?? `${args.file.receiptFileId}.bin`,
    });

    const fileResponse = await fetch(args.file.localUri);
    const blob = await fileResponse.blob();
    const uploadResponse = await fetch(intent.presignedUrl, {
      method: "PUT",
      headers: {
        "Content-Type": intent.contentType,
      },
      body: blob,
    });

    if (!uploadResponse.ok) {
      return {
        ok: false,
        error: `Receipt upload failed (${uploadResponse.status}).`,
      };
    }

    return {
      ok: true,
      objectKey: intent.objectKey,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Receipt upload failed.",
    };
  }
}

export async function syncExpenseMetadataToCloud(payload: CloudExpenseSyncPayload): Promise<CloudSyncResult> {
  const config = getCloudSyncConfig();
  if (!config) {
    return {
      ok: false,
      error: "Cloud sync endpoint is not configured.",
    };
  }

  try {
    const response = await fetch(`${config.apiBaseUrl}/metadata/expenses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `Metadata sync failed (${response.status}).`,
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Metadata sync failed.",
    };
  }
}

