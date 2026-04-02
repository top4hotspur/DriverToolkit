import type * as SQLite from "expo-sqlite";
import { getLocalSchemaSql } from "./localSchema";

let schemaReady = false;
let schemaInitPromise: Promise<void> | null = null;

export async function ensureSchemaReady(db: SQLite.SQLiteDatabase): Promise<void> {
  if (schemaReady) {
    return;
  }

  if (!schemaInitPromise) {
    schemaInitPromise = (async () => {
      logDb("db-schema-init-start", {});
      await db.execAsync(getLocalSchemaSql());
      await runSchemaMigrations(db);

      const sessionTableExists = await tableExists(db, "session_state");
      logDb("db-table-check", { table: "session_state", exists: sessionTableExists });
      if (!sessionTableExists) {
        throw new Error("session_state table missing after schema init");
      }

      const userVersionRow = await db.getFirstAsync<{ userVersion: number }>("PRAGMA user_version");
      logDb("db-schema-init-complete", {
        userVersion: userVersionRow?.userVersion ?? 0,
      });
      schemaReady = true;
    })().catch((error) => {
      schemaInitPromise = null;
      schemaReady = false;
      logDb("db-schema-init-failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });
  }

  await schemaInitPromise;
}

async function runSchemaMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  const userVersionRow = await db.getFirstAsync<{ userVersion: number }>("PRAGMA user_version");
  const version = userVersionRow?.userVersion ?? 0;
  logDb("db-migration-version-detected", { userVersion: version });

  await addMissingColumns(db, "provider_imports", [
    { name: "source_file_name", sqlType: "TEXT" },
    { name: "file_signature", sqlType: "TEXT" },
    { name: "data_start_at", sqlType: "TEXT" },
    { name: "data_end_at", sqlType: "TEXT" },
  ]);

  await addMissingColumns(db, "trips_raw", [
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

  await addMissingColumns(db, "trips_normalized", [
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

  await addMissingColumns(db, "expenses", [
    { name: "payment_method", sqlType: "TEXT DEFAULT 'other'" },
    { name: "receipt_required_status", sqlType: "TEXT DEFAULT 'none'" },
    { name: "receipt_source_type", sqlType: "TEXT" },
    { name: "local_receipt_uri", sqlType: "TEXT" },
    { name: "mime_type", sqlType: "TEXT" },
    { name: "original_file_name", sqlType: "TEXT" },
    { name: "file_size_bytes", sqlType: "INTEGER" },
    { name: "fuel_litres", sqlType: "REAL" },
    { name: "fuel_price_per_litre", sqlType: "REAL" },
    { name: "fuel_total", sqlType: "REAL" },
    { name: "local_sync_status", sqlType: "TEXT DEFAULT 'saved-local'" },
    { name: "cloud_synced_at", sqlType: "TEXT" },
    { name: "sync_state", sqlType: "TEXT DEFAULT 'local-only'" },
    { name: "receipt_file_id", sqlType: "TEXT" },
    { name: "updated_at", sqlType: "TEXT" },
  ]);

  await addMissingColumns(db, "app_settings", [
    { name: "operator_licence_due_date", sqlType: "TEXT" },
    { name: "training_hours_completed", sqlType: "REAL DEFAULT 0" },
    { name: "tax_correct_to_date", sqlType: "TEXT" },
  ]);

  await addMissingColumns(db, "session_state", [
    { name: "accumulated_online_seconds", sqlType: "REAL DEFAULT 0" },
  ]);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS online_session_history (
      id TEXT PRIMARY KEY NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL,
      start_area_label TEXT,
      end_area_label TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS receipt_files (
      id TEXT PRIMARY KEY NOT NULL,
      expense_id TEXT,
      local_uri TEXT NOT NULL,
      mime_type TEXT,
      original_file_name TEXT,
      file_size_bytes INTEGER,
      storage_provider TEXT NOT NULL DEFAULT 'local-only',
      cloud_object_key TEXT,
      cloud_bucket TEXT,
      cloud_region TEXT,
      upload_status TEXT NOT NULL DEFAULT 'local-only',
      uploaded_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await addMissingColumns(db, "receipt_files", [
    { name: "storage_provider", sqlType: "TEXT DEFAULT 'local-only'" },
    { name: "uploaded_at", sqlType: "TEXT" },
  ]);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS sync_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      sync_status TEXT NOT NULL,
      last_error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS privacy_import_files (
      id TEXT PRIMARY KEY NOT NULL,
      provider TEXT NOT NULL,
      source_file_name TEXT NOT NULL,
      local_uri TEXT,
      file_size_bytes INTEGER,
      cloud_object_key TEXT,
      cloud_bucket TEXT,
      cloud_region TEXT,
      upload_status TEXT NOT NULL DEFAULT 'local-only',
      imported_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.execAsync(`PRAGMA user_version = 1`);
}

async function addMissingColumns(
  db: SQLite.SQLiteDatabase,
  table: string,
  columns: Array<{ name: string; sqlType: string }>,
): Promise<void> {
  const tablePresent = await tableExists(db, table);
  if (!tablePresent) {
    logDb("db-table-missing-during-migration", { table });
    return;
  }

  const existing = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  const names = new Set(existing.map((column) => column.name));

  for (const column of columns) {
    if (!names.has(column.name)) {
      await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.sqlType}`);
    }
  }
}

async function tableExists(db: SQLite.SQLiteDatabase, table: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [table],
  );
  return (row?.count ?? 0) > 0;
}

function logDb(event: string, payload: Record<string, unknown>): void {
  console.log(`[DT][db] ${event}`, payload);
}
