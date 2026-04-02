import { PresignedUploadIntent } from "../../contracts/cloudStorage";
import Constants from "expo-constants";

export interface CloudSyncConfig {
  apiBaseUrl: string;
  region: string;
  receiptsBucket: string;
  importsBucket: string;
}

export type ImportApiBaseSource =
  | "env:EXPO_PUBLIC_IMPORT_API_BASE_URL"
  | "env:EXPO_PUBLIC_CLOUD_SYNC_BASE_URL"
  | "env:EXPO_PUBLIC_API_BASE_URL"
  | "expo.extra.importApiBaseUrl"
  | "expo.extra.apiBaseUrl"
  | "none";

export interface ImportApiBaseResolution {
  baseUrl: string | null;
  source: ImportApiBaseSource;
  valid: boolean;
  seen: {
    envImportApiBaseUrl: boolean;
    envCloudSyncBaseUrl: boolean;
    envApiBaseUrl: boolean;
    expoExtraImportApiBaseUrl: boolean;
    expoExtraApiBaseUrl: boolean;
  };
}

// Scaffold-first: local save remains source of truth, cloud sync is best-effort.
export function getCloudSyncConfig(): CloudSyncConfig | null {
  const resolution = resolveImportApiBaseUrl();
  const apiBaseUrl = resolution.baseUrl;
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
  return resolveImportApiBaseUrl().baseUrl;
}

export function getImportApiBaseResolution(): ImportApiBaseResolution {
  return resolveImportApiBaseUrl();
}

function resolveImportApiBaseUrl(): ImportApiBaseResolution {
  const expoExtra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const envImport = process.env.EXPO_PUBLIC_IMPORT_API_BASE_URL ?? null;
  const envCloudSync = process.env.EXPO_PUBLIC_CLOUD_SYNC_BASE_URL ?? null;
  const envApi = process.env.EXPO_PUBLIC_API_BASE_URL ?? null;
  const extraImport = typeof expoExtra.importApiBaseUrl === "string" ? expoExtra.importApiBaseUrl : null;
  const extraApi = typeof expoExtra.apiBaseUrl === "string" ? expoExtra.apiBaseUrl : null;

  const ordered: Array<{ value: string | null; source: ImportApiBaseSource }> = [
    { value: envImport, source: "env:EXPO_PUBLIC_IMPORT_API_BASE_URL" },
    { value: envCloudSync, source: "env:EXPO_PUBLIC_CLOUD_SYNC_BASE_URL" },
    { value: envApi, source: "env:EXPO_PUBLIC_API_BASE_URL" },
    { value: extraImport, source: "expo.extra.importApiBaseUrl" },
    { value: extraApi, source: "expo.extra.apiBaseUrl" },
  ];

  for (const candidate of ordered) {
    const normalized = normalizeBaseUrl(candidate.value);
    if (normalized) {
      return {
        baseUrl: normalized,
        source: candidate.source,
        valid: true,
        seen: {
          envImportApiBaseUrl: Boolean(normalizeBaseUrl(envImport)),
          envCloudSyncBaseUrl: Boolean(normalizeBaseUrl(envCloudSync)),
          envApiBaseUrl: Boolean(normalizeBaseUrl(envApi)),
          expoExtraImportApiBaseUrl: Boolean(normalizeBaseUrl(extraImport)),
          expoExtraApiBaseUrl: Boolean(normalizeBaseUrl(extraApi)),
        },
      };
    }
  }

  return {
    baseUrl: null,
    source: "none",
    valid: false,
    seen: {
      envImportApiBaseUrl: false,
      envCloudSyncBaseUrl: false,
      envApiBaseUrl: false,
      expoExtraImportApiBaseUrl: false,
      expoExtraApiBaseUrl: false,
    },
  };
}

function normalizeBaseUrl(raw: string | null): string | null {
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function getMissingImportConfigKeys(): string[] {
  const missing: string[] = [];
  const resolution = resolveImportApiBaseUrl();
  if (!resolution.valid) {
    missing.push(
      "EXPO_PUBLIC_IMPORT_API_BASE_URL (or EXPO_PUBLIC_CLOUD_SYNC_BASE_URL / EXPO_PUBLIC_API_BASE_URL / expo.extra.importApiBaseUrl / expo.extra.apiBaseUrl)",
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
