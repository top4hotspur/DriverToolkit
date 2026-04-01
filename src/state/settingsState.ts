import { AppSettingsModel } from "./settingsTypes";

let settings: AppSettingsModel = {
  taxSavingsAmount: 2450,
  estimatedTaxLiability: 3800,
  psvDueDate: "2026-05-18",
  insuranceDueDate: "2026-05-03",
  maxStartShiftTravelRadiusMiles: 5,
};

export async function getAppSettings(): Promise<AppSettingsModel> {
  return settings;
}

export async function saveAppSettings(next: AppSettingsModel): Promise<void> {
  settings = next;
}

