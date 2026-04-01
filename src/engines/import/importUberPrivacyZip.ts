import { initDatabase } from "../../db/schema";
import { ImportResult } from "../../domain/importTypes";
import { detectProviderFromZip } from "./detectProvider";
import { ImportFileDescriptor, parseUberExport } from "./adapters";
import { persistImport } from "./importPersistence";
import { normalizeUberTrips } from "./normalizeUberTrip";

export async function importUberPrivacyZip(file: ImportFileDescriptor): Promise<ImportResult> {
  const importedAt = new Date().toISOString();

  try {
    await initDatabase();

    const detection = detectProviderFromZip({
      fileName: file.fileName,
      fileType: file.extension,
      candidateCsvNames: [],
    });

    if (detection.provider !== "uber") {
      return {
        ok: false,
        provider: detection.provider,
        sourceFileName: file.fileName,
        tripCount: 0,
        rawRowCount: 0,
        normalizedRowCount: 0,
        importedAt: null,
        dataStartAt: null,
        dataEndAt: null,
        warnings: [],
        errors: ["Unsupported file: expected Uber privacy ZIP export."],
      };
    }

    const parsed = await parseUberExport(file);

    const importId = `import_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const normalized = normalizeUberTrips({
      importId,
      provider: "uber",
      currency: parsed.currency,
      trips: parsed.intermediateTrips,
    });

    const sortedDates = parsed.intermediateTrips
      .map((trip) => trip.startedAt)
      .filter(Boolean)
      .sort();

    const dataStartAt = sortedDates[0] ?? null;
    const dataEndAt = sortedDates[sortedDates.length - 1] ?? null;

    const persisted = await persistImport({
      importId,
      userId: "local-user",
      provider: "uber",
      sourceFileName: file.fileName,
      fileName: file.fileName,
      fileType: "zip",
      fileHash: null,
      fileSignature: buildFileSignature(file),
      parseStatus: "parsed",
      parseNotes: parsed.warnings.length > 0 ? parsed.warnings.join(" | ") : null,
      importedAt,
      dataStartAt,
      dataEndAt,
      sourceTrips: parsed.intermediateTrips,
      normalized,
    });

    return {
      ok: true,
      provider: "uber",
      sourceFileName: file.fileName,
      tripCount: parsed.intermediateTrips.length,
      rawRowCount: persisted.rawRowCount,
      normalizedRowCount: persisted.normalizedRowCount,
      importedAt,
      dataStartAt,
      dataEndAt,
      warnings: [
        ...parsed.warnings,
        `Detected CSV files: ${parsed.sourceCsvNames.join(", ")}`,
        `Mapped columns: ${parsed.assumedColumns.join(", ")}`,
      ],
      errors: [],
    };
  } catch (error) {
    return {
      ok: false,
      provider: "uber",
      sourceFileName: file.fileName,
      tripCount: 0,
      rawRowCount: 0,
      normalizedRowCount: 0,
      importedAt: null,
      dataStartAt: null,
      dataEndAt: null,
      warnings: [],
      errors: [error instanceof Error ? error.message : "Import failed unexpectedly."],
    };
  }
}

function buildFileSignature(file: ImportFileDescriptor): string {
  const prefix = file.contentsBase64.slice(0, 32);
  return `${file.fileName}:${file.byteLength}:${prefix}`;
}
