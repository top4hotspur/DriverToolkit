import { ProviderCode, TripNormalizedRow, TripRawRow } from "../../domain/types";

export interface ImportFileDescriptor {
  fileName: string;
  mimeType: string;
  extension: "zip" | "csv";
  byteLength: number;
  contents: string | Uint8Array;
}

export interface ParsedImportBundle {
  provider: ProviderCode;
  rawRows: Omit<TripRawRow, "id" | "createdAt">[];
  normalizedTrips: Omit<TripNormalizedRow, "id" | "createdAt">[];
  warnings: string[];
}

export interface ProviderImportAdapter {
  provider: ProviderCode;
  detect(file: ImportFileDescriptor): boolean;
  parse(file: ImportFileDescriptor): Promise<ParsedImportBundle>;
}

export interface ImportEngine {
  detectProvider(file: ImportFileDescriptor): ProviderCode | null;
  parseAndNormalize(file: ImportFileDescriptor): Promise<ParsedImportBundle>;
}

export async function parseUberExport(file: ImportFileDescriptor): Promise<ParsedImportBundle> {
  return Promise.reject(new Error(`parseUberExport not yet wired for ${file.fileName}`));
}

export async function parseBoltExport(file: ImportFileDescriptor): Promise<ParsedImportBundle> {
  return Promise.reject(new Error(`parseBoltExport not yet wired for ${file.fileName}`));
}

export async function parseLyftExport(file: ImportFileDescriptor): Promise<ParsedImportBundle> {
  return Promise.reject(new Error(`parseLyftExport not yet wired for ${file.fileName}`));
}
