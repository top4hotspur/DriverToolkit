import { CanonicalMetrics } from "./types";

export interface MetricInputs {
  earningsTotal: number;
  waitingTimeMinutes: number;
  tripDistanceMiles: number;
  deadMiles: number;
  mpg: number;
  fuelPricePerLitre: number;
  maintenancePerMile: number;
  targetHourly: number;
  targetPerMile: number;
  activeDurationMinutes: number;
}

export function buildCanonicalMetrics(input: MetricInputs): CanonicalMetrics {
  const fuelCost = calculateFuelCost(
    input.tripDistanceMiles + input.deadMiles,
    input.mpg,
    input.fuelPricePerLitre,
  );
  const maintenanceCost = calculateMaintenanceCost(
    input.tripDistanceMiles + input.deadMiles,
    input.maintenancePerMile,
  );
  const returnTripPenalty = calculateReturnTripPenalty(
    input.deadMiles,
    input.mpg,
    input.fuelPricePerLitre,
    input.maintenancePerMile,
  );

  const trueNet = roundMoney(input.earningsTotal - fuelCost - maintenanceCost - returnTripPenalty);
  const trueNetPerHour =
    input.activeDurationMinutes > 0
      ? roundMoney(trueNet / (input.activeDurationMinutes / 60))
      : 0;
  const trueNetPerMile =
    input.tripDistanceMiles > 0 ? roundMoney(trueNet / input.tripDistanceMiles) : 0;

  return {
    earningsTotal: roundMoney(input.earningsTotal),
    waitingTimeMinutes: round2(input.waitingTimeMinutes),
    tripDistanceMiles: round2(input.tripDistanceMiles),
    deadMiles: round2(input.deadMiles),
    fuelCost,
    maintenanceCost,
    trueNet,
    trueNetPerHour,
    trueNetPerMile,
    returnTripPenalty,
    targetGapHourly: roundMoney(input.targetHourly - trueNetPerHour),
    targetGapMile: roundMoney(input.targetPerMile - trueNetPerMile),
  };
}

export function calculateFuelCost(
  distanceMiles: number,
  mpg: number,
  fuelPricePerLitre: number,
): number {
  if (distanceMiles <= 0 || mpg <= 0 || fuelPricePerLitre <= 0) {
    return 0;
  }

  const litresPerImperialGallon = 4.54609;
  const gallonsUsed = distanceMiles / mpg;
  return roundMoney(gallonsUsed * litresPerImperialGallon * fuelPricePerLitre);
}

export function calculateMaintenanceCost(distanceMiles: number, maintenancePerMile: number): number {
  if (distanceMiles <= 0 || maintenancePerMile <= 0) {
    return 0;
  }

  return roundMoney(distanceMiles * maintenancePerMile);
}

export function calculateReturnTripPenalty(
  deadMiles: number,
  mpg: number,
  fuelPricePerLitre: number,
  maintenancePerMile: number,
): number {
  const fuel = calculateFuelCost(deadMiles, mpg, fuelPricePerLitre);
  const maintenance = calculateMaintenanceCost(deadMiles, maintenancePerMile);
  return roundMoney(fuel + maintenance);
}

export function calculateSuggestedMinimumAcceptFare(params: {
  targetHourly: number;
  expectedMinutes: number;
  expectedTripMiles: number;
  expectedDeadMiles: number;
  mpg: number;
  fuelPricePerLitre: number;
  maintenancePerMile: number;
  riskBuffer: number;
}): number {
  const expectedHours = Math.max(params.expectedMinutes, 0) / 60;
  const targetValue = params.targetHourly * expectedHours;
  const travelMiles = Math.max(params.expectedTripMiles, 0) + Math.max(params.expectedDeadMiles, 0);
  const costFloor =
    calculateFuelCost(travelMiles, params.mpg, params.fuelPricePerLitre) +
    calculateMaintenanceCost(travelMiles, params.maintenancePerMile);

  return roundMoney(targetValue + costFloor + Math.max(params.riskBuffer, 0));
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
