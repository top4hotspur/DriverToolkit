export interface AppSettingsModel {
  taxSavingsAmount: number;
  estimatedTaxLiability: number;
  psvDueDate: string | null;
  insuranceDueDate: string | null;
  operatorLicenceDueDate: string | null;
  trainingHoursCompleted: number;
  taxCorrectToDate: string | null;
  maxStartShiftTravelRadiusMiles: number;
}
