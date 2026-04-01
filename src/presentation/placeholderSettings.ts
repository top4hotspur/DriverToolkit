import { daysUntil, shouldShowDueWarning } from "../utils/dueDates";

export interface SettingsPreviewStat {
  areaName: string;
  trueNetPerHour: number;
  trueNetPerMile: number;
  sampleSize: number;
}

export interface SettingsPlaceholderData {
  targetHourly: number;
  targetPerMile: number;
  vehicleAssumptions: {
    mpg: number;
    fuelPricePerLitre: number;
    maintenancePerMile: number;
  };
  taxSavingsAmount: number;
  estimatedTaxLiability: number;
  psvDueDate: string;
  insuranceDueDate: string;
  maxStartShiftTravelRadiusMiles: number;
  startAreaPreviewStats: SettingsPreviewStat[];
}

export const placeholderSettings: SettingsPlaceholderData = {
  targetHourly: 18,
  targetPerMile: 1.2,
  vehicleAssumptions: {
    mpg: 42,
    fuelPricePerLitre: 1.48,
    maintenancePerMile: 0.12,
  },
  taxSavingsAmount: 2450,
  estimatedTaxLiability: 3800,
  psvDueDate: "2026-05-18",
  insuranceDueDate: "2026-05-03",
  maxStartShiftTravelRadiusMiles: 5,
  startAreaPreviewStats: [
    { areaName: "City Centre", trueNetPerHour: 15.9, trueNetPerMile: 1.05, sampleSize: 21 },
    { areaName: "North Dock", trueNetPerHour: 19.5, trueNetPerMile: 1.22, sampleSize: 17 },
    { areaName: "University Area", trueNetPerHour: 20.1, trueNetPerMile: 1.29, sampleSize: 12 },
  ],
};

export function getDueWarnings(nowIso: string = new Date().toISOString()): string[] {
  const warnings: string[] = [];

  if (shouldShowDueWarning(placeholderSettings.psvDueDate, 42)) {
    warnings.push(`PSV due in ${daysUntil(placeholderSettings.psvDueDate, nowIso)} days`);
  }

  if (shouldShowDueWarning(placeholderSettings.insuranceDueDate, 42)) {
    warnings.push(`Insurance renewal due in ${daysUntil(placeholderSettings.insuranceDueDate, nowIso)} days`);
  }

  return warnings;
}

