import { getDb } from "../db/client.native";
import { AppSettingsModel } from "./settingsTypes";

const SETTINGS_ID = "primary";

const defaultSettings: AppSettingsModel = {
  taxSavingsAmount: 2450,
  estimatedTaxLiability: 3800,
  psvDueDate: "2026-05-18",
  insuranceDueDate: "2026-05-03",
  maxStartShiftTravelRadiusMiles: 5,
};

export async function getAppSettings(): Promise<AppSettingsModel> {
  const db = await getDb();
  await ensureSettingsRow();

  const row = await db.getFirstAsync<{
    taxSavingsAmount: number;
    estimatedTaxLiability: number;
    psvDueDate: string | null;
    insuranceDueDate: string | null;
    maxStartShiftTravelRadiusMiles: number;
  }>(`
    SELECT
      tax_savings_amount as taxSavingsAmount,
      estimated_tax_liability as estimatedTaxLiability,
      psv_due_date as psvDueDate,
      insurance_due_date as insuranceDueDate,
      max_start_shift_travel_radius_miles as maxStartShiftTravelRadiusMiles
    FROM app_settings
    WHERE id = ?
  `, [SETTINGS_ID]);

  return row ?? defaultSettings;
}

export async function saveAppSettings(next: AppSettingsModel): Promise<void> {
  const db = await getDb();
  await ensureSettingsRow();

  await db.runAsync(
    `
      UPDATE app_settings
      SET tax_savings_amount = ?,
          estimated_tax_liability = ?,
          psv_due_date = ?,
          insurance_due_date = ?,
          max_start_shift_travel_radius_miles = ?,
          updated_at = ?
      WHERE id = ?
    `,
    [
      next.taxSavingsAmount,
      next.estimatedTaxLiability,
      next.psvDueDate,
      next.insuranceDueDate,
      next.maxStartShiftTravelRadiusMiles,
      new Date().toISOString(),
      SETTINGS_ID,
    ],
  );
}

async function ensureSettingsRow(): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM app_settings WHERE id = ?`,
    [SETTINGS_ID],
  );

  if ((existing?.count ?? 0) > 0) {
    return;
  }

  const now = new Date().toISOString();
  await db.runAsync(
    `
      INSERT INTO app_settings (
        id, tax_savings_amount, estimated_tax_liability,
        psv_due_date, insurance_due_date,
        max_start_shift_travel_radius_miles, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      SETTINGS_ID,
      defaultSettings.taxSavingsAmount,
      defaultSettings.estimatedTaxLiability,
      defaultSettings.psvDueDate,
      defaultSettings.insuranceDueDate,
      defaultSettings.maxStartShiftTravelRadiusMiles,
      now,
    ],
  );
}

