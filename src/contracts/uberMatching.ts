export type UberEvidenceConfidenceBand = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export interface UberDatasetRange {
  startAt: string | null;
  endAt: string | null;
}

export interface UberDatasetComponentValidation {
  fileName: string;
  rowCount: number;
  currencyCodes: string[];
  range: UberDatasetRange;
  missingRequiredColumns: string[];
}

export interface UberMatchingValidationResult {
  ok: boolean;
  userFacingError: string | null;
  userFacingIssueType:
    | "none"
    | "missing-file"
    | "file-unreadable"
    | "no-valid-payment-timestamps"
    | "no-valid-trip-timestamps"
    | "missing-required-columns"
    | "no-overlap";
  trips: UberDatasetComponentValidation;
  payments: UberDatasetComponentValidation;
  analytics: UberDatasetComponentValidation | null;
  overlap: {
    tripsPaymentsOverlap: boolean;
    tripsAnalyticsOverlap: boolean | null;
    paymentsAnalyticsOverlap: boolean | null;
  };
  warnings: string[];
  diagnostics: {
    discoveredFiles: {
      tripsFileName: string;
      paymentsFileName: string;
      analyticsFileName: string | null;
      allCsvFileNames: string[];
    };
    trips: {
      detectedHeaders: string[];
      sampleRows: Array<Record<string, string>>;
      timestampFieldUsed: string | null;
      validTimestampCount: number;
      validAfterFilteringCount: number;
      sampleParsedRequestTimestamps: string[];
    };
    payments: {
      detectedHeaders: string[];
      sampleRows: Array<Record<string, string>>;
      timestampFieldUsed: string | null;
      tripUuidFieldUsed: string | null;
      amountFieldUsed: string | null;
      validTimestampCount: number;
      validTripUuidCount: number;
      validAfterFilteringCount: number;
      groupsCreatedCount: number;
      sampleParsedPaymentTimestamps: string[];
    };
    analytics: {
      detectedHeaders: string[];
      sampleRows: Array<Record<string, string>>;
      timestampFieldUsed: string | null;
      validTimestampCount: number;
    } | null;
  };
}

export interface UberPaymentClassificationTotals {
  fareIncomeTotal: number;
  tipTotal: number;
  commissionTotal: number;
  taxTotal: number;
  insuranceMiscDeductionTotal: number;
  airportFeeTotal: number;
  cashCollectedTotal: number;
  adjustmentTotal: number;
  reimbursementTotal: number;
  incentiveTotal: number;
  unclassifiedTotal: number;
}

export interface UberPaymentGroup {
  tripUuid: string;
  paymentTimestampAnchor: string | null;
  currencyCode: string | null;
  totals: UberPaymentClassificationTotals;
  rawRows: Array<Record<string, string>>;
}

export interface UberTripCandidate {
  tripId: string;
  requestTimestamp: string | null;
  beginTripTimestamp: string | null;
  dropoffTimestamp: string | null;
  tripDistanceMiles: number | null;
  tripDurationSeconds: number | null;
  baseFareLocal: number | null;
  originalFareLocal: number | null;
  cancellationFeeLocal: number | null;
  currencyCode: string | null;
  vehicleUuid: string | null;
  licensePlate: string | null;
  sourceRow: Record<string, string>;
}

export interface UberMatchScoreBreakdown {
  timeProximityScore: number;
  fareSimilarityScore: number;
  uniquenessScore: number;
  totalScore: number;
  confidenceBand: UberEvidenceConfidenceBand;
  searchWindowMinutes: number;
}

export interface UberTripPaymentMatchRow {
  tripId: string;
  tripUuid: string;
  matchedBy: "request" | "dropoff" | "begintrip";
  score: UberMatchScoreBreakdown;
  matchedAt: string | null;
  tripDropoffTimestamp: string | null;
  tripBeginTimestamp: string | null;
  paymentTimestampAnchor: string | null;
  tripFareComparable: number | null;
  paymentFareComparable: number;
  deltaMinutes: number | null;
  deltaFare: number | null;
}

export interface UberAmbiguousMatchRow {
  tripUuid: string;
  topCandidateTripId: string;
  secondCandidateTripId: string;
  topScore: number;
  secondScore: number;
  scoreDelta: number;
}

export interface UberUnmatchedTripRow {
  tripId: string;
  dropoffTimestamp: string | null;
  beginTripTimestamp: string | null;
  originalFareLocal: number | null;
}

export interface UberUnmatchedPaymentGroupRow {
  tripUuid: string;
  paymentTimestampAnchor: string | null;
  fareComparable: number;
  tipTotal: number;
  rowCount: number;
}

export interface UberUnknownClassificationRow {
  tripUuid: string;
  classificationRaw: string | null;
  categoryRaw: string | null;
  amount: number;
  paymentTimestamp: string | null;
}

export interface UberAnalyticsInferencePoint {
  latitude: number;
  longitude: number;
  timestamp: string;
  confidence: number;
}

export interface UberTripAnalyticsInference {
  tripId: string;
  inferredStart: UberAnalyticsInferencePoint | null;
  inferredEnd: UberAnalyticsInferencePoint | null;
}

export interface UberTripPaymentMatchArtifacts {
  discovery: {
    tripsFileFound: boolean;
    paymentsFileFound: boolean;
    analyticsFileFound: boolean;
    tripsFileName: string | null;
    paymentsFileName: string | null;
    analyticsFileName: string | null;
    ignoredFilesCount: number;
    ignoredFileNames: string[];
  };
  validation: UberMatchingValidationResult;
  tripCandidates: UberTripCandidate[];
  paymentGroups: UberPaymentGroup[];
  matchedTrips: UberTripPaymentMatchRow[];
  unmatchedTrips: UberUnmatchedTripRow[];
  unmatchedPaymentGroups: UberUnmatchedPaymentGroupRow[];
  ambiguousMatches: UberAmbiguousMatchRow[];
  unknownClassification: UberUnknownClassificationRow[];
  analyticsInference: UberTripAnalyticsInference[];
}

export interface UberMatchCsvFileInput {
  fileName: string;
  csvText: string;
}

export interface UberMatchEngineInput {
  tripsFile: UberMatchCsvFileInput;
  paymentsFile: UberMatchCsvFileInput;
  analyticsFile?: UberMatchCsvFileInput | null;
}
