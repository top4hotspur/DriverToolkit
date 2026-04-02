import * as SQLite from "expo-sqlite";
import { ensureSchemaReady } from "./bootstrap.native";

let dbInstance: SQLite.SQLiteDatabase | null = null;
let dbReadyPromise: Promise<SQLite.SQLiteDatabase> | null = null;
const DB_NAME = "driver-toolkit.db";

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  if (!dbReadyPromise) {
    dbReadyPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      const maybePath = (db as unknown as { databasePath?: string }).databasePath ?? null;
      logDb("db-opened", { name: DB_NAME, path: maybePath });
      await ensureSchemaReady(db);
      dbInstance = db;
      return db;
    })().catch((error) => {
      dbReadyPromise = null;
      dbInstance = null;
      logDb("db-open-failed", {
        name: DB_NAME,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });
  }

  return dbReadyPromise;
}

function logDb(event: string, payload: Record<string, unknown>): void {
  console.log(`[DT][db] ${event}`, payload);
}
