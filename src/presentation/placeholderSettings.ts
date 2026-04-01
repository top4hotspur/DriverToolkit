import { daysUntil, shouldShowDueWarning } from "../utils/dueDates";

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
  psvDueDate: string | null;
  insuranceDueDate: string | null;
  operatorLicenceDueDate: string | null;
  trainingHoursCompleted: number;
  taxCorrectToDate: string | null;
  maxStartShiftTravelRadiusMiles: number;
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
  operatorLicenceDueDate: null,
  trainingHoursCompleted: 7.25,
  taxCorrectToDate: "2026-03-30",
  maxStartShiftTravelRadiusMiles: 5,
};

export function getDueWarnings(nowIso: string = new Date().toISOString()): string[] {
  const warnings: string[] = [];

  if (placeholderSettings.psvDueDate && shouldShowDueWarning(placeholderSettings.psvDueDate, 42)) {
    warnings.push(`PSV due in ${daysUntil(placeholderSettings.psvDueDate, nowIso)} days`);
  }

  if (placeholderSettings.insuranceDueDate && shouldShowDueWarning(placeholderSettings.insuranceDueDate, 42)) {
    warnings.push(`Insurance renewal due in ${daysUntil(placeholderSettings.insuranceDueDate, nowIso)} days`);
  }

  if (placeholderSettings.operatorLicenceDueDate && shouldShowDueWarning(placeholderSettings.operatorLicenceDueDate, 42)) {
    warnings.push(`Operator licence due in ${daysUntil(placeholderSettings.operatorLicenceDueDate, nowIso)} days`);
  }

  return warnings;
}
