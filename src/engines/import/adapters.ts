import { IntermediateTripRecord, ProviderDetectionResult } from "../../domain/importTypes";
import { UberTripPaymentMatchArtifacts } from "../../contracts/uberMatching";
import { ProviderCode } from "../../domain/types";
import { detectProviderFromZip } from "./detectProvider";
import { parseUberPrivacyZip } from "./parseUberExport";
import { buildUberTripPaymentArtifactsFromZip } from "./uberTripPaymentMatching";

export interface ImportFileDescriptor {
  fileName: string;
  mimeType: string;
  extension: "zip" | "csv";
  byteLength: number;
  contentsBase64: string;
}

export interface ParsedImportBundle {
  provider: ProviderCode;
  currency: string;
  detection: ProviderDetectionResult;
  sourceCsvNames: string[];
  assumedColumns: string[];
  intermediateTrips: IntermediateTripRecord[];
  warnings: string[];
}

export interface ProviderImportAdapter {
  provider: ProviderCode;
  detect(file: ImportFileDescriptor): Promise<ProviderDetectionResult>;
  parse(file: ImportFileDescriptor): Promise<ParsedImportBundle>;
}

export interface ImportEngine {
  detectProvider(file: ImportFileDescriptor): Promise<ProviderDetectionResult>;
  parseAndNormalize(file: ImportFileDescriptor): Promise<ParsedImportBundle>;
}

export async function parseUberExport(file: ImportFileDescriptor): Promise<ParsedImportBundle> {
  return parseUberPrivacyZip(file);
}

export async function buildUberTripPaymentMatchingArtifacts(
  file: ImportFileDescriptor,
): Promise<UberTripPaymentMatchArtifacts> {
  return buildUberTripPaymentArtifactsFromZip(file);
}

export async function parseBoltExport(_file: ImportFileDescriptor): Promise<ParsedImportBundle> {
  return Promise.reject(new Error("Bolt import parsing is not implemented in this pass."));
}

export async function parseLyftExport(_file: ImportFileDescriptor): Promise<ParsedImportBundle> {
  return Promise.reject(new Error("Lyft import parsing is not implemented in this pass."));
}

export const uberAdapter: ProviderImportAdapter = {
  provider: "uber",
  async detect(file) {
    return detectProviderFromZip({
      fileName: file.fileName,
      fileType: file.extension,
      candidateCsvNames: [],
    });
  },
  parse: parseUberExport,
};
