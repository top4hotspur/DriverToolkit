import { ImportFileDescriptor } from "./adapters";
import { ImportResult } from "../../domain/importTypes";

export async function importUberPrivacyZip(file: ImportFileDescriptor): Promise<ImportResult> {
  return {
    ok: false,
    provider: null,
    sourceFileName: file.fileName,
    tripCount: 0,
    rawRowCount: 0,
    normalizedRowCount: 0,
    importedAt: null,
    dataStartAt: null,
    dataEndAt: null,
    warnings: [],
    errors: ["Local ZIP import is not available on web."],
  };
}
