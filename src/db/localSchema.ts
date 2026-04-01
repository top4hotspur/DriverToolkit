const schemaStatements = [
  `PRAGMA journal_mode = WAL;`,
  `CREATE TABLE IF NOT EXISTS users_local (
    id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT,
    timezone TEXT NOT NULL,
    currency TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS provider_imports (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_hash TEXT,
    file_type TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    record_count INTEGER NOT NULL,
    parse_status TEXT NOT NULL,
    parse_notes TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS trips_raw (
    id TEXT PRIMARY KEY NOT NULL,
    import_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    row_index INTEGER NOT NULL,
    raw_payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS trips_normalized (
    id TEXT PRIMARY KEY NOT NULL,
    import_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_trip_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    start_area_code TEXT,
    end_area_code TEXT,
    start_lat REAL,
    start_lng REAL,
    end_lat REAL,
    end_lng REAL,
    wait_time_minutes REAL NOT NULL,
    trip_distance_miles REAL NOT NULL,
    dead_miles REAL NOT NULL,
    fare_base REAL NOT NULL,
    fare_surge REAL NOT NULL,
    tip_amount REAL NOT NULL,
    tolls_amount REAL NOT NULL,
    fees_amount REAL NOT NULL,
    earnings_total REAL NOT NULL,
    currency TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS expenses (\n    id TEXT PRIMARY KEY NOT NULL,\n    user_id TEXT NOT NULL,\n    category TEXT NOT NULL,\n    amount REAL NOT NULL,\n    occurred_on TEXT NOT NULL,\n    notes TEXT,\n    receipt_source_type TEXT,\n    local_receipt_uri TEXT,\n    mime_type TEXT,\n    original_file_name TEXT,\n    file_size_bytes INTEGER,\n    sync_state TEXT NOT NULL DEFAULT "local-only",\n    created_at TEXT NOT NULL\n  );`,
  `CREATE TABLE IF NOT EXISTS vehicle_cost_history (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    mpg REAL NOT NULL,
    fuel_price_per_litre REAL NOT NULL,
    maintenance_per_mile REAL NOT NULL,
    other_cost_per_mile REAL NOT NULL,
    created_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS decision_targets (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    target_hourly REAL NOT NULL,
    target_per_mile REAL NOT NULL,
    min_sample_size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS start_areas (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    area_code TEXT NOT NULL,
    display_name TEXT NOT NULL,
    center_lat REAL NOT NULL,
    center_lng REAL NOT NULL,
    radius_miles REAL NOT NULL,
    created_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS geofences (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    area_code TEXT NOT NULL,
    name TEXT NOT NULL,
    polygon_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS diary_events_cached (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    area_code TEXT,
    confidence_hint REAL,
    created_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS recommendation_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    action TEXT NOT NULL,
    confidence TEXT NOT NULL,
    sample_size INTEGER NOT NULL,
    basis_window_days INTEGER NOT NULL,
    rationale TEXT NOT NULL,
    payload_json TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS earnings_leaks (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    trip_id TEXT NOT NULL,
    leak_type TEXT NOT NULL,
    estimated_value REAL NOT NULL,
    confidence TEXT NOT NULL,
    explanation TEXT NOT NULL,
    claim_helper_text TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`,
];

export function getLocalSchemaSql(): string {
  return schemaStatements.join("\n\n");
}

export function getLocalSchemaStatements(): string[] {
  return [...schemaStatements];
}

