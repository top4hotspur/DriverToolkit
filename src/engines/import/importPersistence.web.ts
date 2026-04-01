import { LatestImportSummary } from "./importPersistence";

export async function persistImport(): Promise<never> {
  throw new Error("Local import persistence is not available on web.");
}

export async function getLatestImportSummary(): Promise<LatestImportSummary | null> {
  return null;
}
