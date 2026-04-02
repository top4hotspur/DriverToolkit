import {
  ConfirmImportUploadRequest,
  CreateImportSessionResponse,
  ImportStatusResponse,
} from "../../contracts/cloudStorage";
import { getImportApiBaseUrl, getMissingImportConfigKeys } from "./storageScaffold";

export type ImportSyncResult<T> = {
  ok: boolean;
  value?: T;
  error?: string;
};

export async function createImportSession(args: {
  userId: string;
  sourceFileName: string;
  mimeType: string;
}): Promise<ImportSyncResult<CreateImportSessionResponse>> {
  const apiBaseUrl = getImportApiBaseUrl();
  if (!apiBaseUrl) {
    const missing = getMissingImportConfigKeys();
    return {
      ok: false,
      error: `Cloud import endpoint is not configured. Missing: ${missing.join(", ")}.`,
    };
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/imports/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: args.userId,
        provider: "uber",
        sourceFileName: args.sourceFileName,
        mimeType: args.mimeType,
      }),
    });
    if (!response.ok) {
      return {
        ok: false,
        error: `Create import session route unavailable (${response.status}) at ${apiBaseUrl}/api/imports/session.`,
      };
    }
    return { ok: true, value: (await response.json()) as CreateImportSessionResponse };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to create import session.",
    };
  }
}

export async function uploadZipToS3(args: {
  uploadUrl: string;
  localUri: string;
  mimeType: string;
}): Promise<ImportSyncResult<true>> {
  try {
    const fileResponse = await fetch(args.localUri);
    const blob = await fileResponse.blob();
    const putResponse = await fetch(args.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": args.mimeType,
      },
      body: blob,
    });
    if (!putResponse.ok) {
      return { ok: false, error: `S3 upload failed (${putResponse.status}).` };
    }
    return { ok: true, value: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "ZIP upload failed.",
    };
  }
}

export async function confirmImportUpload(args: ConfirmImportUploadRequest): Promise<ImportSyncResult<true>> {
  const apiBaseUrl = getImportApiBaseUrl();
  if (!apiBaseUrl) {
    const missing = getMissingImportConfigKeys();
    return { ok: false, error: `Cloud import endpoint is not configured. Missing: ${missing.join(", ")}.` };
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/imports/${encodeURIComponent(args.importId)}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!response.ok) {
      return {
        ok: false,
        error: `Confirm upload route unavailable (${response.status}) at ${apiBaseUrl}/api/imports/${args.importId}/confirm.`,
      };
    }
    return { ok: true, value: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to confirm import upload.",
    };
  }
}

export async function getImportStatus(args: {
  userId: string;
  importId: string;
}): Promise<ImportSyncResult<ImportStatusResponse>> {
  const apiBaseUrl = getImportApiBaseUrl();
  if (!apiBaseUrl) {
    const missing = getMissingImportConfigKeys();
    return { ok: false, error: `Cloud import endpoint is not configured. Missing: ${missing.join(", ")}.` };
  }

  try {
    const response = await fetch(
      `${apiBaseUrl}/api/imports/${encodeURIComponent(args.importId)}/status?userId=${encodeURIComponent(args.userId)}`,
    );
    if (!response.ok) {
      return {
        ok: false,
        error: `Status route unavailable (${response.status}) at ${apiBaseUrl}/api/imports/${args.importId}/status.`,
      };
    }
    return { ok: true, value: (await response.json()) as ImportStatusResponse };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to fetch import status.",
    };
  }
}
