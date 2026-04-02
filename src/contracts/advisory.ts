export type TrackedPlaceType = "airport" | "station" | "venue";

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
  type: "above-average" | "significantly-above-average" | "delayed-flight";
  baselineArrivals: number;
  nextHourArrivals: number;
  delayedArrivals?: Array<{ serviceId: string; delayMinutes: number }>;
}

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
