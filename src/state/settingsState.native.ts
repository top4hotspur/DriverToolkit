import { getDb } from "../db/client.native";
import { AppSettingsModel } from "./settingsTypes";

const SETTINGS_ID = "primary";

const defaultSettings: AppSettingsModel = {
  taxSavingsAmount: 2450,
  estimatedTaxLiability: 3800,
  psvDueDate: "2026-05-18",
  insuranceDueDate: "2026-05-03",
  operatorLicenceDueDate: null,
  trainingHoursCompleted: 7.25,
  taxCorrectToDate: "2026-03-30",
  maxStartShiftTravelRadiusMiles: 5,
  vehicleExpenseMethod: "simplified_mileage",
};

export async function getAppSettings(): Promise<AppSettingsModel> {
  const db = await getDb();
  await ensureSettingsRow();

  const row = await db.getFirstAsync<{
    taxSavingsAmount: number;
    estimatedTaxLiability: number;
    psvDueDate: string | null;
    insuranceDueDate: string | null;
    operatorLicenceDueDate: string | null;
    trainingHoursCompleted: number;
      taxCorrectToDate: string | null;
      maxStartShiftTravelRadiusMiles: number;
      vehicleExpenseMethod: AppSettingsModel["vehicleExpenseMethod"];
    }>(`
    SELECT
      tax_savings_amount as taxSavingsAmount,
      estimated_tax_liability as estimatedTaxLiability,
      psv_due_date as psvDueDate,
      insurance_due_date as insuranceDueDate,
      operator_licence_due_date as operatorLicenceDueDate,
      training_hours_completed as trainingHoursCompleted,
      tax_correct_to_date as taxCorrectToDate,
      max_start_shift_travel_radius_miles as maxStartShiftTravelRadiusMiles,
      vehicle_expense_method as vehicleExpenseMethod
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
          operator_licence_due_date = ?,
          training_hours_completed = ?,
          tax_correct_to_date = ?,
          max_start_shift_travel_radius_miles = ?,
          vehicle_expense_method = ?,
          updated_at = ?
      WHERE id = ?
    `,
    [
      next.taxSavingsAmount,
      next.estimatedTaxLiability,
      next.psvDueDate,
      next.insuranceDueDate,
      next.operatorLicenceDueDate,
      next.trainingHoursCompleted,
      next.taxCorrectToDate,
      next.maxStartShiftTravelRadiusMiles,
      next.vehicleExpenseMethod,
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
        operator_licence_due_date, training_hours_completed,
        tax_correct_to_date,
        max_start_shift_travel_radius_miles, vehicle_expense_method, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      SETTINGS_ID,
      defaultSettings.taxSavingsAmount,
      defaultSettings.estimatedTaxLiability,
      defaultSettings.psvDueDate,
      defaultSettings.insuranceDueDate,
      defaultSettings.operatorLicenceDueDate,
      defaultSettings.trainingHoursCompleted,
      defaultSettings.taxCorrectToDate,
      defaultSettings.maxStartShiftTravelRadiusMiles,
      defaultSettings.vehicleExpenseMethod,
      now,
    ],
  );
}
