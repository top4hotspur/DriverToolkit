import { ImportStatusResponse } from "../contracts/cloudStorage";

let latestCompletedImportStatus: ImportStatusResponse | null = null;

export async function saveLatestCompletedImportStatus(
  status: ImportStatusResponse,
): Promise<void> {
  latestCompletedImportStatus = status;
}

export async function getLatestCompletedImportStatus(): Promise<ImportStatusResponse | null> {
  return latestCompletedImportStatus;
}

