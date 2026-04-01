export type ProviderCode = "uber" | "bolt" | "lyft";

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export type RecommendationAction = "stay" | "reposition" | "avoid" | "short-wait-only";

export type ReportType =
  | "journey-regret"
  | "area-performance"
  | "hour-vs-mile"
  | "best-start-areas"
  | "dead-mile-traps"
  | "queue-traps"
  | "follow-on-strength"
  | "earnings-leaks"
  | "tip-patterns"
  | "time-of-day-winners-losers"
  | "achievements";

export type EarningsLeakType =
  | "missing-surcharge"
  | "wait-time-anomaly"
  | "suspected-underpayment";

export type BasisWindowReason = "default" | "strong-sample" | "sparse-sample";

export interface BasisWindow {
  days: number;
  label: string;
  reason: BasisWindowReason;
}

export interface CanonicalMetrics {
  earningsTotal: number;
  waitingTimeMinutes: number;
  tripDistanceMiles: number;
  deadMiles: number;
  fuelCost: number;
  maintenanceCost: number;
  trueNet: number;
  trueNetPerHour: number;
  trueNetPerMile: number;
  returnTripPenalty: number;
  targetGapHourly: number;
  targetGapMile: number;
}

export interface ComparableContext {
  areaCode: string;
  weekdayClass: "weekday" | "weekend";
  hourBucket: string;
}

export interface LocalUserRow {
  id: string;
  displayName: string | null;
  timezone: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderImportRow {
  id: string;
  userId: string;
  provider: ProviderCode;
  sourceFileName: string;
  fileName: string;
  fileHash: string | null;
  fileSignature: string | null;
  fileType: "zip" | "csv";
  importedAt: string;
  dataStartAt: string | null;
  dataEndAt: string | null;
  recordCount: number;
  parseStatus: "pending" | "parsed" | "failed";
  parseNotes: string | null;
}

export interface TripRawRow {
  id: string;
  importId: string;
  provider: ProviderCode;
  rawTripId: string;
  providerTripId: string | null;
  rowIndex: number;
  startedAt: string | null;
  endedAt: string | null;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  pickupArea: string | null;
  dropoffArea: string | null;
  fareGross: number | null;
  surgeAmount: number | null;
  tollAmount: number | null;
  waitTimeAmount: number | null;
  tipAmount: number | null;
  durationMinutes: number | null;
  tripDistanceMiles: number | null;
  status: string | null;
  rawPayloadJson: string;
  createdAt: string;
}

export interface TripNormalizedRow {
  id: string;
  tripId: string;
  importId: string;
  provider: ProviderCode;
  providerTripId: string | null;
  startedAt: string;
  endedAt: string;
  dayOfWeek: string;
  hourBucket: string;
  weekType: "weekday" | "weekend";
  pickupAreaCode: string;
  dropoffAreaCode: string;
  pickupZoneKey: string;
  dropoffZoneKey: string;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  tripDistanceMiles: number;
  durationMinutes: number;
  fareGross: number;
  surgeAmount: number;
  tollAmount: number;
  waitTimeAmount: number;
  tipAmount: number;
  earningsTotal: number;
  inferredDeadMilesAfterTrip: number;
  inferredReturnToCoreMiles: number;
  geofenceTagsJson: string;
  eventContextJson: string;
  status: string;
  currency: string;
  createdAt: string;
}

export interface TripTruthMetricRow {
  id: string;
  tripId: string;
  importId: string;
  earningsTotal: number;
  tripDistanceMiles: number;
  fuelCost: number;
  maintenanceCost: number;
  trueNet: number;
  trueNetPerHour: number;
  trueNetPerMile: number;
  targetGapHourly: number;
  targetGapMile: number;
  calculatedAt: string;
}

export type ReceiptSourceType = "camera" | "file-upload";

export interface ExpenseRow {
  id: string;
  userId: string;
  category: string;
  amount: number;
  occurredOn: string;
  notes: string | null;
  receiptSourceType: ReceiptSourceType | null;
  localReceiptUri: string | null;
  mimeType: string | null;
  originalFileName: string | null;
  fileSizeBytes: number | null;
  syncState: "local-only";
  createdAt: string;
}

export interface VehicleCostHistoryRow {
  id: string;
  userId: string;
  effectiveFrom: string;
  mpg: number;
  fuelPricePerLitre: number;
  maintenancePerMile: number;
  otherCostPerMile: number;
  createdAt: string;
}

export interface DecisionTargetsRow {
  id: string;
  userId: string;
  effectiveFrom: string;
  targetHourly: number;
  targetPerMile: number;
  minSampleSize: number;
  createdAt: string;
}

export interface StartAreaRow {
  id: string;
  userId: string;
  areaCode: string;
  displayName: string;
  centerLat: number;
  centerLng: number;
  radiusMiles: number;
  createdAt: string;
}

export interface GeofenceRow {
  id: string;
  userId: string;
  areaCode: string;
  name: string;
  polygonJson: string;
  createdAt: string;
}

export interface DiaryEventCachedRow {
  id: string;
  userId: string;
  source: "calendar" | "manual";
  title: string;
  startsAt: string;
  endsAt: string;
  areaCode: string | null;
  confidenceHint: number | null;
  createdAt: string;
}

export interface RecommendationSnapshotRow {
  id: string;
  userId: string;
  generatedAt: string;
  action: RecommendationAction;
  confidence: ConfidenceLevel;
  sampleSize: number;
  basisWindowDays: number;
  rationale: string;
  payloadJson: string;
}

export interface EarningsLeakRow {
  id: string;
  userId: string;
  tripId: string;
  leakType: EarningsLeakType;
  estimatedValue: number;
  confidence: ConfidenceLevel;
  explanation: string;
  claimHelperText: string;
  status: "open" | "reviewing" | "closed";
  createdAt: string;
}
