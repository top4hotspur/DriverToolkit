import { buildCanonicalMetrics } from "../../domain/formulas";
import { IntermediateTripRecord } from "../../domain/importTypes";
import { TripNormalizedRow } from "../../domain/types";
import { getDb } from "../../db/client";
import { UberTripPaymentMatchArtifacts } from "../../contracts/uberMatching";
import { NormalizedTripBundle } from "./normalizeUberTrip";

export interface PersistImportPayload {
  importId: string;
  userId: string;
  provider: "uber";
  sourceFileName: string;
  fileName: string;
  fileType: "zip";
  fileHash: string | null;
  fileSignature: string;
  parseStatus: "parsed" | "failed";
  parseNotes: string | null;
  importedAt: string;
  dataStartAt: string | null;
  dataEndAt: string | null;
  sourceTrips: IntermediateTripRecord[];
  normalized: NormalizedTripBundle;
  matchingArtifacts?: UberTripPaymentMatchArtifacts | null;
}

export interface PersistImportResult {
  rawRowCount: number;
  normalizedRowCount: number;
  metricRowCount: number;
}

export interface LatestImportSummary {
  sourceFileName: string;
  importedAt: string;
  provider: string;
  parseStatus: string;
  recordCount: number;
  dataStartAt: string | null;
  dataEndAt: string | null;
}

export interface LatestUberImportReview {
  importId: string;
  sourceFileName: string;
  importedAt: string;
  parseStatus: string;
  tripsDateRange: {
    startAt: string | null;
    endAt: string | null;
  };
  paymentsDateRange: {
    startAt: string | null;
    endAt: string | null;
  };
  analyticsDateRange: {
    startAt: string | null;
    endAt: string | null;
  } | null;
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
  locationEnrichedTrips: number;
  analyticsCoverageNote: string;
  matchedExamples: Array<{
    tripId: string;
    tripUuid: string;
    confidenceBand: string;
    score: number;
    matchedAt: string | null;
  }>;
  unmatchedTripExamples: Array<{
    tripId: string;
    dropoffTimestamp: string | null;
    originalFareLocal: number | null;
  }>;
  unmatchedPaymentExamples: Array<{
    tripUuid: string;
    paymentTimestampAnchor: string | null;
    fareComparable: number;
  }>;
  reimbursementExamples: Array<{
    tripUuid: string;
    reimbursementTotal: number;
    adjustmentTotal: number;
  }>;
}

export async function persistImport(payload: PersistImportPayload): Promise<PersistImportResult> {
  const db = await getDb();

  await db.runAsync(
    `
      INSERT INTO provider_imports (
        id, user_id, provider, source_file_name, file_name,
        file_hash, file_signature, file_type, imported_at,
        data_start_at, data_end_at, record_count, parse_status, parse_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      payload.importId,
      payload.userId,
      payload.provider,
      payload.sourceFileName,
      payload.fileName,
      payload.fileHash,
      payload.fileSignature,
      payload.fileType,
      payload.importedAt,
      payload.dataStartAt,
      payload.dataEndAt,
      payload.sourceTrips.length,
      payload.parseStatus,
      payload.parseNotes,
    ],
  );

  const now = payload.importedAt;

  if (payload.matchingArtifacts) {
    await db.runAsync(
      `
        INSERT INTO import_match_artifacts (
          id, import_id, provider, discovery_json, validation_json,
          matched_json, unmatched_json, ambiguous_json, unknown_json,
          enrichment_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        `${payload.importId}-match-artifacts`,
        payload.importId,
        payload.provider,
        JSON.stringify(payload.matchingArtifacts.discovery),
        JSON.stringify(payload.matchingArtifacts.validation),
        JSON.stringify({
          paymentGroups: payload.matchingArtifacts.paymentGroups,
          matchedTrips: payload.matchingArtifacts.matchedTrips,
        }),
        JSON.stringify({
          unmatchedTrips: payload.matchingArtifacts.unmatchedTrips,
          unmatchedPaymentGroups: payload.matchingArtifacts.unmatchedPaymentGroups,
        }),
        JSON.stringify(payload.matchingArtifacts.ambiguousMatches),
        JSON.stringify(payload.matchingArtifacts.unknownClassification),
        JSON.stringify(payload.matchingArtifacts.analyticsInference),
        now,
      ],
    );
  }

  for (let i = 0; i < payload.normalized.rawRows.length; i += 1) {
    const row = payload.normalized.rawRows[i];
    await db.runAsync(
      `
      INSERT INTO trips_raw (
        id, import_id, provider, raw_trip_id, provider_trip_id, row_index,
        started_at, ended_at, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
        pickup_area, dropoff_area, fare_gross, surge_amount, toll_amount,
        wait_time_amount, tip_amount, duration_minutes, trip_distance_miles,
        status, raw_payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        `${payload.importId}-raw-${i}`,
        row.importId,
        row.provider,
        row.rawTripId,
        row.providerTripId,
        row.rowIndex,
        row.startedAt,
        row.endedAt,
        row.pickupLat,
        row.pickupLng,
        row.dropoffLat,
        row.dropoffLng,
        row.pickupArea,
        row.dropoffArea,
        row.fareGross,
        row.surgeAmount,
        row.tollAmount,
        row.waitTimeAmount,
        row.tipAmount,
        row.durationMinutes,
        row.tripDistanceMiles,
        row.status,
        row.rawPayloadJson,
        now,
      ],
    );
  }

  const defaults = await getMetricDefaults();

  for (let i = 0; i < payload.normalized.normalizedRows.length; i += 1) {
    const row = payload.normalized.normalizedRows[i];
    await insertNormalizedRow(db, row, `${payload.importId}-normalized-${i}`, now);

    const metrics = buildCanonicalMetrics({
      earningsTotal: row.earningsTotal,
      waitingTimeMinutes: 0,
      tripDistanceMiles: row.tripDistanceMiles,
      deadMiles: row.inferredDeadMilesAfterTrip,
      mpg: defaults.mpg,
      fuelPricePerLitre: defaults.fuelPricePerLitre,
      maintenancePerMile: defaults.maintenancePerMile,
      targetHourly: defaults.targetHourly,
      targetPerMile: defaults.targetPerMile,
      activeDurationMinutes: row.durationMinutes,
    });

    await db.runAsync(
      `
      INSERT INTO trip_truth_metrics (
        id, trip_id, import_id, earnings_total, trip_distance_miles,
        fuel_cost, maintenance_cost, true_net, true_net_per_hour,
        true_net_per_mile, target_gap_hourly, target_gap_mile, calculated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        `${payload.importId}-metric-${i}`,
        row.tripId,
        row.importId,
        metrics.earningsTotal,
        metrics.tripDistanceMiles,
        metrics.fuelCost,
        metrics.maintenanceCost,
        metrics.trueNet,
        metrics.trueNetPerHour,
        metrics.trueNetPerMile,
        metrics.targetGapHourly,
        metrics.targetGapMile,
        now,
      ],
    );
  }

  return {
    rawRowCount: payload.normalized.rawRows.length,
    normalizedRowCount: payload.normalized.normalizedRows.length,
    metricRowCount: payload.normalized.normalizedRows.length,
  };
}

export async function getLatestImportSummary(): Promise<LatestImportSummary | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<LatestImportSummary>(`
    SELECT
      source_file_name as sourceFileName,
      imported_at as importedAt,
      provider,
      parse_status as parseStatus,
      record_count as recordCount,
      data_start_at as dataStartAt,
      data_end_at as dataEndAt
    FROM provider_imports
    ORDER BY imported_at DESC
    LIMIT 1
  `);

  return row ?? null;
}

export async function getLatestUberImportReview(): Promise<LatestUberImportReview | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    importId: string;
    sourceFileName: string;
    importedAt: string;
    parseStatus: string;
    discoveryJson: string;
    validationJson: string;
    matchedJson: string;
    unmatchedJson: string;
    ambiguousJson: string;
    enrichmentJson: string;
  }>(`
    SELECT
      p.id as importId,
      p.source_file_name as sourceFileName,
      p.imported_at as importedAt,
      p.parse_status as parseStatus,
      a.discovery_json as discoveryJson,
      a.validation_json as validationJson,
      a.matched_json as matchedJson,
      a.unmatched_json as unmatchedJson,
      a.ambiguous_json as ambiguousJson,
      a.enrichment_json as enrichmentJson
    FROM provider_imports p
    INNER JOIN import_match_artifacts a ON a.import_id = p.id
    WHERE p.provider = 'uber'
    ORDER BY p.imported_at DESC
    LIMIT 1
  `);

  if (!row) {
    return null;
  }

  const discovery = safeJson<{
    tripsFileFound: boolean;
    paymentsFileFound: boolean;
    analyticsFileFound: boolean;
    ignoredFilesCount: number;
  }>(row.discoveryJson, {
    tripsFileFound: false,
    paymentsFileFound: false,
    analyticsFileFound: false,
    ignoredFilesCount: 0,
  });
  const validation = safeJson<{
    trips?: { range?: { startAt: string | null; endAt: string | null } };
    payments?: { range?: { startAt: string | null; endAt: string | null } };
    analytics?: { range?: { startAt: string | null; endAt: string | null } } | null;
    warnings?: string[];
    overlap?: { tripsAnalyticsOverlap?: boolean | null };
  }>(row.validationJson, {});
  const matched = safeJson<{
    paymentGroups?: Array<{ tripUuid: string; totals?: { reimbursementTotal?: number; adjustmentTotal?: number } }>;
    matchedTrips?: Array<{
      tripId: string;
      tripUuid: string;
      matchedAt: string | null;
      score?: { confidenceBand?: string; totalScore?: number };
    }>;
  }>(row.matchedJson, {});
  const unmatched = safeJson<{
    unmatchedTrips?: Array<{ tripId: string; dropoffTimestamp: string | null; originalFareLocal: number | null }>;
    unmatchedPaymentGroups?: Array<{ tripUuid: string; paymentTimestampAnchor: string | null; fareComparable: number }>;
  }>(row.unmatchedJson, {});
  const ambiguous = safeJson<Array<unknown>>(row.ambiguousJson, []);
  const enrichment = safeJson<Array<{ inferredStart: unknown | null; inferredEnd: unknown | null }>>(row.enrichmentJson, []);

  const paymentGroups = matched.paymentGroups ?? [];
  const reimbursements = paymentGroups
    .map((group) => ({
      tripUuid: group.tripUuid,
      reimbursementTotal: round2(group.totals?.reimbursementTotal ?? 0),
      adjustmentTotal: round2(group.totals?.adjustmentTotal ?? 0),
    }))
    .filter((group) => group.reimbursementTotal !== 0 || group.adjustmentTotal !== 0);

  const locationEnrichedTrips = enrichment.filter(
    (item) => item.inferredStart !== null || item.inferredEnd !== null,
  ).length;

  return {
    importId: row.importId,
    sourceFileName: row.sourceFileName,
    importedAt: row.importedAt,
    parseStatus: row.parseStatus,
    tripsDateRange: validation.trips?.range ?? { startAt: null, endAt: null },
    paymentsDateRange: validation.payments?.range ?? { startAt: null, endAt: null },
    analyticsDateRange: validation.analytics?.range ?? null,
    discovery,
    matchedTrips: matched.matchedTrips?.length ?? 0,
    unmatchedTrips: unmatched.unmatchedTrips?.length ?? 0,
    unmatchedPaymentGroups: unmatched.unmatchedPaymentGroups?.length ?? 0,
    ambiguousMatches: ambiguous.length,
    reimbursementsDetected: round2(
      reimbursements.reduce((sum, item) => sum + item.reimbursementTotal + item.adjustmentTotal, 0),
    ),
    locationEnrichedTrips,
    analyticsCoverageNote: buildAnalyticsCoverageNote({
      hasAnalytics: discovery.analyticsFileFound,
      analyticsOverlap: validation.overlap?.tripsAnalyticsOverlap ?? null,
      warnings: validation.warnings ?? [],
    }),
    matchedExamples: (matched.matchedTrips ?? []).slice(0, 5).map((item) => ({
      tripId: item.tripId,
      tripUuid: item.tripUuid,
      confidenceBand: item.score?.confidenceBand ?? "NONE",
      score: round2(item.score?.totalScore ?? 0),
      matchedAt: item.matchedAt,
    })),
    unmatchedTripExamples: (unmatched.unmatchedTrips ?? []).slice(0, 5),
    unmatchedPaymentExamples: (unmatched.unmatchedPaymentGroups ?? []).slice(0, 5),
    reimbursementExamples: reimbursements.slice(0, 5),
  };
}

async function getMetricDefaults(): Promise<{
  mpg: number;
  fuelPricePerLitre: number;
  maintenancePerMile: number;
  targetHourly: number;
  targetPerMile: number;
}> {
  const db = await getDb();

  const vehicle = await db.getFirstAsync<{
    mpg: number;
    fuelPricePerLitre: number;
    maintenancePerMile: number;
  }>(`
    SELECT
      mpg,
      fuel_price_per_litre as fuelPricePerLitre,
      maintenance_per_mile as maintenancePerMile
    FROM vehicle_cost_history
    ORDER BY effective_from DESC
    LIMIT 1
  `);

  const targets = await db.getFirstAsync<{
    targetHourly: number;
    targetPerMile: number;
  }>(`
    SELECT
      target_hourly as targetHourly,
      target_per_mile as targetPerMile
    FROM decision_targets
    ORDER BY effective_from DESC
    LIMIT 1
  `);

  return {
    mpg: vehicle?.mpg ?? 42,
    fuelPricePerLitre: vehicle?.fuelPricePerLitre ?? 1.5,
    maintenancePerMile: vehicle?.maintenancePerMile ?? 0.45,
    targetHourly: targets?.targetHourly ?? 18,
    targetPerMile: targets?.targetPerMile ?? 1.2,
  };
}

async function insertNormalizedRow(
  db: Awaited<ReturnType<typeof getDb>>,
  row: Omit<TripNormalizedRow, "id" | "createdAt">,
  id: string,
  createdAt: string,
): Promise<void> {
  await db.runAsync(
    `
    INSERT INTO trips_normalized (
      id, trip_id, import_id, provider, provider_trip_id,
      started_at, ended_at, day_of_week, hour_bucket, week_type,
      pickup_area_code, dropoff_area_code, pickup_zone_key, dropoff_zone_key,
      pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
      trip_distance_miles, duration_minutes, fare_gross, surge_amount,
      toll_amount, wait_time_amount, tip_amount, earnings_total,
      inferred_dead_miles_after_trip, inferred_return_to_core_miles,
      geofence_tags_json, event_context_json, status, currency, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      row.tripId,
      row.importId,
      row.provider,
      row.providerTripId,
      row.startedAt,
      row.endedAt,
      row.dayOfWeek,
      row.hourBucket,
      row.weekType,
      row.pickupAreaCode,
      row.dropoffAreaCode,
      row.pickupZoneKey,
      row.dropoffZoneKey,
      row.pickupLat,
      row.pickupLng,
      row.dropoffLat,
      row.dropoffLng,
      row.tripDistanceMiles,
      row.durationMinutes,
      row.fareGross,
      row.surgeAmount,
      row.tollAmount,
      row.waitTimeAmount,
      row.tipAmount,
      row.earningsTotal,
      row.inferredDeadMilesAfterTrip,
      row.inferredReturnToCoreMiles,
      row.geofenceTagsJson,
      row.eventContextJson,
      row.status,
      row.currency,
      createdAt,
    ],
  );
}

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function buildAnalyticsCoverageNote(args: {
  hasAnalytics: boolean;
  analyticsOverlap: boolean | null;
  warnings: string[];
}): string {
  if (!args.hasAnalytics) {
    return "No analytics file provided.";
  }
  if (args.analyticsOverlap === false) {
    return "Analytics file did not overlap trip period.";
  }
  if (args.warnings.some((warning) => warning.toLowerCase().includes("partial"))) {
    return "Analytics coverage is partial/recent only.";
  }
  return "Analytics coverage overlaps import period.";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
