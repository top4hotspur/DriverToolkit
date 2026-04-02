import { ProviderCode } from "./types";

export interface IntermediateTripRecord {
  externalTripId: string;
  providerName: ProviderCode;
  startedAt: string;
  endedAt: string;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  pickupArea: string | null;
  dropoffArea: string | null;
  durationMinutes: number;
  distanceMiles: number;
  fareGross: number;
  surgeAmount: number;
  tolls: number;
  waits: number;
  tips: number;
  earningsTotal: number;
  status: string;
  metadata: Record<string, string | number | boolean | null>;
}

export type ImportErrorCode =
  | "invalid-zip"
  | "unsupported-file"
  | "provider-not-detected"
  | "missing-required-data"
  | "missing-required-columns"
  | "parse-failure"
  | "persistence-failure";

export interface ImportMessage {
  code: ImportErrorCode | "warning";
  message: string;
}

export interface ProviderDetectionResult {
  provider: ProviderCode | null;
  fileType: "zip" | "csv";
  candidateCsvNames: string[];
  requiredDataFound: boolean;
}

export interface ImportResult {
  ok: boolean;
  provider: ProviderCode | null;
  sourceFileName: string;
  tripCount: number;
  rawRowCount: number;
  normalizedRowCount: number;
  importedAt: string | null;
  dataStartAt: string | null;
  dataEndAt: string | null;
  warnings: string[];
  errors: string[];
  uberImportSummary?: {
    discovery: {
      tripsFileFound: boolean;
      paymentsFileFound: boolean;
      analyticsFileFound: boolean;
      ignoredFilesCount: number;
    };
    matchedTrips: number;
    unmatchedTrips: number;
    unmatchedPaymentGroups: number;
    ambiguousMatches: number;
    reimbursementsDetected: number;
    analyticsCoverageRange: {
      startAt: string | null;
      endAt: string | null;
    } | null;
    locationEnrichedTrips: number;
  };
}

export interface UploadStatusViewModel {
  phase: "idle" | "selected" | "importing" | "success" | "error";
  title: string;
  description: string;
  selectedFileName: string | null;
  result: ImportResult | null;
}
