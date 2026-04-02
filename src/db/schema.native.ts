import { ensureSchemaReady } from "./bootstrap.native";
import { getDb } from "./client.native";

export async function initDatabase(): Promise<void> {
  const db = await getDb();
  await ensureSchemaReady(db);
}
