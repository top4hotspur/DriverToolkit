import { buildCanonicalMetrics } from "../../domain/formulas";
import { IntermediateTripRecord } from "../../domain/importTypes";
import { TripNormalizedRow } from "../../domain/types";
import { getDb } from "../../db/client";
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
