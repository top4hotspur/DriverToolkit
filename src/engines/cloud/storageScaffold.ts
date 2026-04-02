import { PresignedUploadIntent } from "../../contracts/cloudStorage";

export interface CloudSyncConfig {
  apiBaseUrl: string;
  region: string;
  receiptsBucket: string;
  importsBucket: string;
}

// Scaffold-first: local save remains source of truth, cloud sync is best-effort.
export function getCloudSyncConfig(): CloudSyncConfig | null {
  const apiBaseUrl = process.env.EXPO_PUBLIC_CLOUD_SYNC_BASE_URL;
  const region = process.env.EXPO_PUBLIC_AWS_REGION;
  const receiptsBucket = process.env.EXPO_PUBLIC_AWS_RECEIPTS_BUCKET;
  const importsBucket = process.env.EXPO_PUBLIC_AWS_IMPORTS_BUCKET;

  if (!apiBaseUrl || !region || !receiptsBucket) {
    return null;
  }

  return {
    apiBaseUrl,
    region,
    receiptsBucket,
    importsBucket: importsBucket ?? receiptsBucket,
  };
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
