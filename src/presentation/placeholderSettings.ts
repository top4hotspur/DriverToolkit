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
  startAreaPreviewStats: [
    { areaName: "City Centre", trueNetPerHour: 15.9, trueNetPerMile: 1.05, sampleSize: 21 },
    { areaName: "North Dock", trueNetPerHour: 19.5, trueNetPerMile: 1.22, sampleSize: 17 },
    { areaName: "University Area", trueNetPerHour: 20.1, trueNetPerMile: 1.29, sampleSize: 12 },
  ],
};
