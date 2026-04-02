import { PresignedUploadIntent } from "../../contracts/cloudStorage";

export interface CloudSyncConfig {
  apiBaseUrl: string;
  region: string;
  receiptsBucket: string;
  importsBucket: string;
}

// Scaffold-first: local save remains source of truth, cloud sync is best-effort.
export function getCloudSyncConfig(): CloudSyncConfig | null {
  const apiBaseUrl = getImportApiBaseUrl();
  if (!apiBaseUrl) {
    return null;
  }

  return {
    apiBaseUrl,
    region: process.env.EXPO_PUBLIC_AWS_REGION ?? "eu-west-1",
    receiptsBucket: process.env.EXPO_PUBLIC_AWS_RECEIPTS_BUCKET ?? "driver-toolkit-receipts",
    importsBucket:
      process.env.EXPO_PUBLIC_AWS_IMPORTS_BUCKET ??
      process.env.EXPO_PUBLIC_AWS_RECEIPTS_BUCKET ??
      "driver-toolkit-imports",
  };
}

export function getImportApiBaseUrl(): string | null {
  const raw =
    process.env.EXPO_PUBLIC_IMPORT_API_BASE_URL ??
    process.env.EXPO_PUBLIC_CLOUD_SYNC_BASE_URL ??
    process.env.EXPO_PUBLIC_API_BASE_URL ??
    null;
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  return raw.replace(/\/+$/, "");
}

export function getMissingImportConfigKeys(): string[] {
  const missing: string[] = [];
  const hasImportBase = Boolean(
    (process.env.EXPO_PUBLIC_IMPORT_API_BASE_URL ?? "").trim() ||
      (process.env.EXPO_PUBLIC_CLOUD_SYNC_BASE_URL ?? "").trim() ||
      (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").trim(),
  );
  if (!hasImportBase) {
    missing.push(
      "EXPO_PUBLIC_IMPORT_API_BASE_URL (or EXPO_PUBLIC_CLOUD_SYNC_BASE_URL / EXPO_PUBLIC_API_BASE_URL)",
    );
  }
  return missing;
}

export async function buildReceiptUploadIntent(args: {
  userId: string;
  receiptFileId: string;
  mimeType: string;
  originalFileName: string;
}): Promise<PresignedUploadIntent> {
  const config = getCloudSyncConfig();
  const objectKey = `receipts/${args.userId}/${args.receiptFileId}-${sanitize(args.originalFileName)}`;

  if (config) {
    const response = await fetch(`${config.apiBaseUrl}/presign/receipt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        objectKey,
        contentType: args.mimeType,
      }),
    });

    if (response.ok) {
      const payload = await response.json() as { presignedUrl: string; expiresInSeconds?: number };
      return {
        objectKey,
        contentType: args.mimeType,
        expiresInSeconds: payload.expiresInSeconds ?? 900,
        method: "PUT",
        presignedUrl: payload.presignedUrl,
      };
    }
  }

  return {
    objectKey,
    contentType: args.mimeType,
    expiresInSeconds: 900,
    method: "PUT",
    presignedUrl: `https://example-presigned-upload.invalid/${objectKey}`,
  };
}

export async function buildPrivacyZipUploadIntent(args: {
  userId: string;
  provider: "uber" | "bolt" | "lyft";
  importFileId: string;
  fileName: string;
}): Promise<PresignedUploadIntent> {
  const config = getCloudSyncConfig();
  const objectKey = `privacy-exports/${args.userId}/${args.provider}/${args.importFileId}-${sanitize(args.fileName)}`;

  if (config) {
    const response = await fetch(`${config.apiBaseUrl}/presign/privacy-export`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        objectKey,
        contentType: "application/zip",
      }),
    });

    if (response.ok) {
      const payload = await response.json() as { presignedUrl: string; expiresInSeconds?: number };
      return {
        objectKey,
        contentType: "application/zip",
        expiresInSeconds: payload.expiresInSeconds ?? 900,
        method: "PUT",
        presignedUrl: payload.presignedUrl,
      };
    }
  }

  return {
    objectKey,
    contentType: "application/zip",
    expiresInSeconds: 900,
    method: "PUT",
    presignedUrl: `https://example-presigned-upload.invalid/${objectKey}`,
  };
}

function sanitize(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
