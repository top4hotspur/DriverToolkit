import { IntermediateTripRecord } from "../../domain/importTypes";
import { TripNormalizedRow, TripRawRow } from "../../domain/types";
import { toDayOfWeek, toHourBucket, toWeekType } from "../../utils/dateBuckets";

export interface NormalizedTripBundle {
  rawRows: Omit<TripRawRow, "id" | "createdAt">[];
  normalizedRows: Omit<TripNormalizedRow, "id" | "createdAt">[];
}

export function normalizeUberTrips(params: {
  importId: string;
  provider: "uber";
  currency: string;
  trips: IntermediateTripRecord[];
}): NormalizedTripBundle {
  const rawRows: Omit<TripRawRow, "id" | "createdAt">[] = [];
  const normalizedRows: Omit<TripNormalizedRow, "id" | "createdAt">[] = [];

  params.trips.forEach((trip, index) => {
    const tripId = `${params.importId}-${trip.externalTripId}-${index}`;
    const pickupAreaCode = deriveAreaCode(trip.pickupArea, trip.pickupLat, trip.pickupLng);
    const dropoffAreaCode = deriveAreaCode(trip.dropoffArea, trip.dropoffLat, trip.dropoffLng);
    const deadMiles = inferDeadMilesAfterTrip(trip.distanceMiles, pickupAreaCode, dropoffAreaCode);

    rawRows.push({
      importId: params.importId,
      provider: params.provider,
      rawTripId: tripId,
      providerTripId: trip.externalTripId,
      rowIndex: index,
      startedAt: trip.startedAt,
      endedAt: trip.endedAt,
      pickupLat: trip.pickupLat,
      pickupLng: trip.pickupLng,
      dropoffLat: trip.dropoffLat,
      dropoffLng: trip.dropoffLng,
      pickupArea: trip.pickupArea,
      dropoffArea: trip.dropoffArea,
      fareGross: trip.fareGross,
      surgeAmount: trip.surgeAmount,
      tollAmount: trip.tolls,
      waitTimeAmount: trip.waits,
      tipAmount: trip.tips,
      durationMinutes: trip.durationMinutes,
      tripDistanceMiles: trip.distanceMiles,
      status: trip.status,
      rawPayloadJson: JSON.stringify(trip.metadata),
    });

    normalizedRows.push({
      tripId,
      importId: params.importId,
      provider: params.provider,
      providerTripId: trip.externalTripId,
      startedAt: trip.startedAt,
      endedAt: trip.endedAt,
      dayOfWeek: toDayOfWeek(trip.startedAt),
      hourBucket: toHourBucket(trip.startedAt),
      weekType: toWeekType(trip.startedAt),
      pickupAreaCode,
      dropoffAreaCode,
      pickupZoneKey: `zone-${pickupAreaCode}`,
      dropoffZoneKey: `zone-${dropoffAreaCode}`,
      pickupLat: trip.pickupLat,
      pickupLng: trip.pickupLng,
      dropoffLat: trip.dropoffLat,
      dropoffLng: trip.dropoffLng,
      tripDistanceMiles: trip.distanceMiles,
      durationMinutes: trip.durationMinutes,
      fareGross: trip.fareGross,
      surgeAmount: trip.surgeAmount,
      tollAmount: trip.tolls,
      waitTimeAmount: trip.waits,
      tipAmount: trip.tips,
      earningsTotal: trip.earningsTotal,
      inferredDeadMilesAfterTrip: deadMiles,
      inferredReturnToCoreMiles: Math.max(deadMiles * 0.65, 0),
      geofenceTagsJson: JSON.stringify([]),
      eventContextJson: JSON.stringify({ source: "none" }),
      status: trip.status,
      currency: params.currency,
    });
  });

  return { rawRows, normalizedRows };
}

function deriveAreaCode(areaLabel: string | null, lat: number | null, lng: number | null): string {
  if (areaLabel && areaLabel.trim().length > 0) {
    const compact = areaLabel.trim().replace(/\s+/g, "-").toUpperCase();
    return compact.length > 24 ? compact.slice(0, 24) : compact;
  }

  if (lat !== null && lng !== null) {
    return `GRID-${Math.round(lat * 10)}-${Math.round(lng * 10)}`;
  }

  return "UNKNOWN";
}

function inferDeadMilesAfterTrip(distanceMiles: number, pickupAreaCode: string, dropoffAreaCode: string): number {
  if (pickupAreaCode === "UNKNOWN" || dropoffAreaCode === "UNKNOWN") {
    return round2(Math.max(distanceMiles * 0.15, 0));
  }

  if (pickupAreaCode === dropoffAreaCode) {
    return round2(Math.max(distanceMiles * 0.08, 0));
  }

  return round2(Math.max(distanceMiles * 0.22, 0));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
