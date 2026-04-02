export type TrackedPlaceType = "airport" | "station" | "venue";

export type RailStationId = "lanyon-place" | "grand-central" | "bangor";

export interface TrackedPlace {
  id: string;
  label: string;
  type: TrackedPlaceType;
  latitude: number;
  longitude: number;
  source: "favourite" | "seeded";
  relatedFavouriteId?: string | null;
}

export interface BaselineHourlyExpectation {
  trackedPlaceId: string;
  weekday: number; // 0=Sun..6=Sat
  hour: number; // 0..23
  expectedArrivalsNextHour: number;
}

export interface LiveArrivalAnomaly {
  trackedPlaceId: string;
  trackedPlaceLabel: string;
  type:
    | "above-average"
    | "significantly-above-average"
    | "delayed-flight"
    | "rail-disruption"
    | "replacement-bus";
  baselineArrivals: number;
  nextHourArrivals: number;
  stationCode?: string;
  disruptionMessage?: string;
  delayedArrivals?: Array<{ serviceId: string; delayMinutes: number }>;
}

export interface RailStationConfig {
  id: RailStationId;
  stationCode: string;
  label: string;
  aliases: string[];
  latitude: number;
  longitude: number;
}

export interface RailServiceDisruption {
  serviceId: string;
  disruptionType: "cancelled" | "replacement-bus" | "delayed";
  delayMinutes?: number;
  note?: string;
}

export interface RailStationLiveSnapshot {
  stationId: RailStationId;
  stationCode: string;
  stationLabel: string;
  fetchedAt: string;
  arrivalsNextHour: number;
  delayedCount: number;
  cancelledCount: number;
  replacementBusCount: number;
  disruptions: RailServiceDisruption[];
  rawSource: "translink-opendata" | "tiger" | "fallback";
}

export type RailActivityClassification =
  | "normal"
  | "higher_than_average"
  | "significantly_higher_than_average";

export interface ProximityAlertResult {
  state: "none" | "alert";
  headline: string;
  details: string;
  trackedPlaceId?: string;
  trackedPlaceLabel?: string;
  placeType?: TrackedPlaceType;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  basisLabel: string;
  evaluatedAt: string;
}

export interface DiaryAdvisoryEntry {
  id: string;
  title: string;
  window: string;
  note: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  relatedTrackedPlaceId?: string;
}
