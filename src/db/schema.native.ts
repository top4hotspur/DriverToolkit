import { getDb } from "./client.native";
import { getLocalSchemaSql } from "./localSchema";

export async function initDatabase(): Promise<void> {
  const db = await getDb();
  await db.execAsync(getLocalSchemaSql());
}
