import { getDb } from "../db/client.native";

const USER_ID = "local-user";

export interface VehicleCostSettings {
  mpg: number;
  fuelPricePerLitre: number;
  maintenancePerMile: number;
}

const defaultVehicleCosts: VehicleCostSettings = {
  mpg: 42,
  fuelPricePerLitre: 1.48,
  maintenancePerMile: 0.45,
};

export async function getVehicleCostSettings(): Promise<VehicleCostSettings> {
  const db = await getDb();
  const row = await db.getFirstAsync<VehicleCostSettings>(`
    SELECT
      mpg as mpg,
      fuel_price_per_litre as fuelPricePerLitre,
      maintenance_per_mile as maintenancePerMile
    FROM vehicle_cost_history
    WHERE user_id = ?
    ORDER BY effective_from DESC
    LIMIT 1
  `, [USER_ID]);

  return row ?? defaultVehicleCosts;
}

export async function saveVehicleCostSettings(next: VehicleCostSettings): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `
      INSERT INTO vehicle_cost_history (
        id, user_id, effective_from, mpg, fuel_price_per_litre, maintenance_per_mile, other_cost_per_mile, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      `vehicle_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      USER_ID,
      now,
      next.mpg,
      next.fuelPricePerLitre,
      next.maintenancePerMile,
      0,
      now,
    ],
  );
}
