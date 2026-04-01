import { getDb } from "./client.native";
import { getLocalSchemaSql } from "./localSchema";

export async function initDatabase(): Promise<void> {
  const db = await getDb();
  await db.execAsync(getLocalSchemaSql());
  await runSchemaMigrations();
}

async function runSchemaMigrations(): Promise<void> {
  const db = await getDb();

  await addMissingColumns("provider_imports", [
    { name: "source_file_name", sqlType: "TEXT" },
    { name: "file_signature", sqlType: "TEXT" },
    { name: "data_start_at", sqlType: "TEXT" },
    { name: "data_end_at", sqlType: "TEXT" },
  ]);

  await addMissingColumns("trips_raw", [
    { name: "raw_trip_id", sqlType: "TEXT" },
    { name: "provider_trip_id", sqlType: "TEXT" },
    { name: "started_at", sqlType: "TEXT" },
    { name: "ended_at", sqlType: "TEXT" },
    { name: "pickup_lat", sqlType: "REAL" },
    { name: "pickup_lng", sqlType: "REAL" },
    { name: "dropoff_lat", sqlType: "REAL" },
    { name: "dropoff_lng", sqlType: "REAL" },
    { name: "pickup_area", sqlType: "TEXT" },
    { name: "dropoff_area", sqlType: "TEXT" },
    { name: "fare_gross", sqlType: "REAL" },
    { name: "surge_amount", sqlType: "REAL" },
    { name: "toll_amount", sqlType: "REAL" },
    { name: "wait_time_amount", sqlType: "REAL" },
    { name: "tip_amount", sqlType: "REAL" },
    { name: "duration_minutes", sqlType: "REAL" },
    { name: "trip_distance_miles", sqlType: "REAL" },
    { name: "status", sqlType: "TEXT" },
  ]);

  await addMissingColumns("trips_normalized", [
    { name: "trip_id", sqlType: "TEXT" },
    { name: "day_of_week", sqlType: "TEXT" },
    { name: "hour_bucket", sqlType: "TEXT" },
    { name: "week_type", sqlType: "TEXT" },
    { name: "pickup_area_code", sqlType: "TEXT" },
    { name: "dropoff_area_code", sqlType: "TEXT" },
    { name: "pickup_zone_key", sqlType: "TEXT" },
    { name: "dropoff_zone_key", sqlType: "TEXT" },
    { name: "fare_gross", sqlType: "REAL" },
    { name: "toll_amount", sqlType: "REAL" },
    { name: "wait_time_amount", sqlType: "REAL" },
    { name: "inferred_dead_miles_after_trip", sqlType: "REAL" },
    { name: "inferred_return_to_core_miles", sqlType: "REAL" },
    { name: "geofence_tags_json", sqlType: "TEXT" },
    { name: "event_context_json", sqlType: "TEXT" },
    { name: "status", sqlType: "TEXT" },
  ]);

  await addMissingColumns("expenses", [
    { name: "receipt_source_type", sqlType: "TEXT" },
    { name: "local_receipt_uri", sqlType: "TEXT" },
    { name: "mime_type", sqlType: "TEXT" },
    { name: "original_file_name", sqlType: "TEXT" },
    { name: "file_size_bytes", sqlType: "INTEGER" },
    { name: "sync_state", sqlType: "TEXT DEFAULT 'local-only'" },
  ]);
}

async function addMissingColumns(
  table: string,
  columns: Array<{ name: string; sqlType: string }>,
): Promise<void> {
  const db = await getDb();

  const existing = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  const names = new Set(existing.map((column) => column.name));

  for (const column of columns) {
    if (!names.has(column.name)) {
      await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.sqlType}`);
    }
  }
}
