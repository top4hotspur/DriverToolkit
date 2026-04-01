import type * as SQLite from "expo-sqlite";

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  throw new Error("SQLite is not available on web.");
}
