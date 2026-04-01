export interface VehicleCostSettings {
  mpg: number;
  fuelPricePerLitre: number;
  maintenancePerMile: number;
}

let current: VehicleCostSettings = {
  mpg: 42,
  fuelPricePerLitre: 1.48,
  maintenancePerMile: 0.45,
};

export async function getVehicleCostSettings(): Promise<VehicleCostSettings> {
  return current;
}

export async function saveVehicleCostSettings(next: VehicleCostSettings): Promise<void> {
  current = next;
}
