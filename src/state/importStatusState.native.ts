import { ImportStatusResponse } from "../contracts/cloudStorage";
import { getDb } from "../db/client.native";

const CACHE_ID = "latest-completed";

export async function saveLatestCompletedImportStatus(
  status: ImportStatusResponse,
): Promise<void> {
  const db = await getDb();
  await ensureTable();
  const now = new Date().toISOString();
  await db.runAsync(
    `
      INSERT INTO import_status_cache (id, payload_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at
    `,
    [CACHE_ID, JSON.stringify(status), now],
  );
}

export async function getLatestCompletedImportStatus(): Promise<ImportStatusResponse | null> {
  const db = await getDb();
  await ensureTable();
  const row = await db.getFirstAsync<{ payloadJson: string }>(
    `
      SELECT payload_json as payloadJson
      FROM import_status_cache
      WHERE id = ?
    `,
    [CACHE_ID],
  );

  try {
    const raw = row?.payloadJson;
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as ImportStatusResponse;
  } catch {
    return null;
  }
}

async function ensureTable(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS import_status_cache (
      id TEXT PRIMARY KEY NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}
