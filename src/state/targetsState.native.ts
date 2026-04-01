import { getDb } from "../db/client.native";
import { TargetSettings } from "./targetTypes";

const USER_ID = "local-user";

export async function getTargetSettings(): Promise<TargetSettings> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ targetHourly: number; targetPerMile: number }>(`
    SELECT
      target_hourly as targetHourly,
      target_per_mile as targetPerMile
    FROM decision_targets
    WHERE user_id = ?
    ORDER BY effective_from DESC
    LIMIT 1
  `, [USER_ID]);

  return {
    targetHourly: row?.targetHourly ?? 18,
    targetPerMile: row?.targetPerMile ?? 1.2,
  };
}

export async function saveTargetSettings(next: TargetSettings): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `
      INSERT INTO decision_targets (
        id, user_id, effective_from, target_hourly, target_per_mile, min_sample_size, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      `target_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      USER_ID,
      new Date().toISOString(),
      next.targetHourly,
      next.targetPerMile,
      8,
      new Date().toISOString(),
    ],
  );
}
