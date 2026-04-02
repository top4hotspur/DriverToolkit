import {
  ExpensePresignResponse,
  ExpenseSaveApiRequest,
  PresignedUploadIntent,
} from "../../contracts/cloudStorage";
import { getCloudSyncConfig } from "./storageScaffold";

export interface ReceiptUploadPayload {
  expenseId: string;
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
    const intent = await requestExpensePresign({
      apiBaseUrl: config.apiBaseUrl,
      userId: args.userId,
      expenseId: args.file.expenseId,
      fileType: args.file.mimeType ?? "application/octet-stream",
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
    const requestPayload: ExpenseSaveApiRequest = {
      expenseId: payload.expense.expenseId,
      userId: payload.expense.userId,
      amount: payload.expense.amountGbp,
      category: payload.expense.category as ExpenseSaveApiRequest["category"],
      type: payload.expense.expenseType as ExpenseSaveApiRequest["type"],
      date: payload.expense.expenseDate,
      paymentMethod: payload.expense.paymentMethod as ExpenseSaveApiRequest["paymentMethod"],
      note: payload.expense.note,
      receiptRequiredStatus: payload.expense.receiptRequiredStatus as ExpenseSaveApiRequest["receiptRequiredStatus"],
      receiptS3Key: payload.receipt?.cloudObjectKey ?? null,
      fuelLitres: payload.expense.fuelLitres,
      fuelPricePerLitre: payload.expense.fuelPricePerLitre,
      fuelTotal: payload.expense.fuelTotal,
      createdAt: payload.expense.createdAt,
      updatedAt: payload.expense.updatedAt,
      syncStatus: "synced",
      receiptFileMetadata: payload.receipt
        ? {
            fileId: payload.receipt.fileId,
            mimeType: payload.receipt.mimeType,
            originalFilename: payload.receipt.originalFilename,
            fileSizeBytes: payload.receipt.fileSizeBytes,
          }
        : null,
    };

    const response = await fetch(`${config.apiBaseUrl}/api/expenses/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestPayload),
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

async function requestExpensePresign(args: {
  apiBaseUrl: string;
  userId: string;
  expenseId: string;
  fileType: string;
}): Promise<PresignedUploadIntent> {
  const response = await fetch(`${args.apiBaseUrl}/api/expenses/presign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId: args.userId,
      expenseId: args.expenseId,
      fileType: args.fileType,
    }),
  });

  if (!response.ok) {
    throw new Error(`Presign request failed (${response.status}).`);
  }

  const payload = (await response.json()) as ExpensePresignResponse;
  return {
    objectKey: payload.objectKey,
    contentType: payload.contentType,
    expiresInSeconds: payload.expiresInSeconds,
    method: "PUT",
    presignedUrl: payload.presignedUrl,
  };
}
