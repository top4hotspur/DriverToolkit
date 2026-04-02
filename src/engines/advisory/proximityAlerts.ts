import {
  BaselineHourlyExpectation,
  DiaryAdvisoryEntry,
  LiveArrivalAnomaly,
  ProximityAlertResult,
  TrackedPlace,
  TrackedPlaceType,
} from "../../contracts/advisory";
import { StartPoint } from "../../state/startPointTypes";

const SEEDED_TRACKED_PLACES: TrackedPlace[] = [
  {
    id: "seeded-bfs",
    label: "Belfast International",
    type: "airport",
    latitude: 54.6575,
    longitude: -6.2158,
    source: "seeded",
  },
  {
    id: "seeded-bhd",
    label: "George Best Belfast City",
    type: "airport",
    latitude: 54.6181,
    longitude: -5.8725,
    source: "seeded",
  },
  {
    id: "seeded-lanyon",
    label: "Lanyon Place",
    type: "station",
    latitude: 54.5942,
    longitude: -5.9197,
    source: "seeded",
  },
];

export function buildTrackedPlacesFromFavourites(favourites: StartPoint[]): TrackedPlace[] {
  const fromFavourites = favourites.map((favourite) => ({
    id: `fav-${favourite.id}`,
    label: favourite.label,
    type: inferPlaceType(favourite.label, favourite.postcode),
    latitude: favourite.latitude,
    longitude: favourite.longitude,
    source: "favourite" as const,
    relatedFavouriteId: favourite.id,
  }));

  return [...fromFavourites, ...SEEDED_TRACKED_PLACES];
}

export function evaluateProximityAlert(args: {
  now: Date;
  currentCoords: { latitude: number; longitude: number } | null;
  trackedPlaces: TrackedPlace[];
  radiusMiles?: number;
}): ProximityAlertResult {
  const evaluatedAt = args.now.toISOString();
  if (!args.currentCoords || args.trackedPlaces.length === 0) {
    return {
      state: "none",
      headline: "Nothing notable to share",
      details: "No nearby monitored places are currently available for advisory checks.",
      confidence: "LOW",
      basisLabel: "Monitored place advisory (next 60 minutes)",
      evaluatedAt,
    };
  }

  const currentCoords = args.currentCoords;
  const radius = args.radiusMiles ?? 5;
  const nearbyPlaces = args.trackedPlaces
    .map((place) => ({
      place,
      distanceMiles: haversineMiles(
        currentCoords.latitude,
        currentCoords.longitude,
        place.latitude,
        place.longitude,
      ),
    }))
    .filter((candidate) => candidate.distanceMiles <= radius)
    .sort((a, b) => a.distanceMiles - b.distanceMiles);

  if (nearbyPlaces.length === 0) {
    return {
      state: "none",
      headline: "Nothing notable to share",
      details: "No monitored airport, station, or venue is within 5 miles right now.",
      confidence: "LOW",
      basisLabel: "Monitored place advisory (next 60 minutes)",
      evaluatedAt,
    };
  }

  const anomalies = nearbyPlaces
    .map((candidate) => evaluatePlaceAnomaly(candidate.place, args.now))
    .filter((anomaly): anomaly is LiveArrivalAnomaly => anomaly !== null);

  if (anomalies.length === 0) {
    return {
      state: "none",
      headline: "Nothing notable to share",
      details: "Nearby monitored places are tracking close to baseline expectations.",
      confidence: "MEDIUM",
      basisLabel: "Monitored place advisory (next 60 minutes)",
      evaluatedAt,
    };
  }

  const top = anomalies[0];
  return {
    state: "alert",
    headline: buildHeadline(top),
    details: buildDetails(top),
    trackedPlaceId: top.trackedPlaceId,
    trackedPlaceLabel: top.trackedPlaceLabel,
    placeType: nearbyPlaces.find((item) => item.place.id === top.trackedPlaceId)?.place.type,
    confidence: top.type === "significantly-above-average" ? "HIGH" : "MEDIUM",
    basisLabel: "Monitored place advisory (next 60 minutes vs baseline)",
    evaluatedAt,
  };
}

export function buildDiaryAdvisories(args: {
  now: Date;
  trackedPlaces: TrackedPlace[];
}): DiaryAdvisoryEntry[] {
  const advisories = args.trackedPlaces.slice(0, 5).map((place, index) => {
    const baseline = getBaselineExpectation(place.id, args.now);
    const nextHour = simulateNextHourArrivals(place, args.now);
    const confidence: DiaryAdvisoryEntry["confidence"] = nextHour >= baseline.expectedArrivalsNextHour + 2 ? "HIGH" : "MEDIUM";

    return {
      id: `diary-${place.id}-${index}`,
      title: `${place.label} advisory`,
      window: `${args.now.getHours().toString().padStart(2, "0")}:00-${(args.now.getHours() + 1)
        .toString()
        .padStart(2, "0")}:00`,
      note:
        nextHour > baseline.expectedArrivalsNextHour
          ? `${place.label} is above usual activity for this hour.`
          : `${place.label} is around normal activity for this hour.`,
      confidence,
      relatedTrackedPlaceId: place.id,
    };
  });

  return advisories;
}

function evaluatePlaceAnomaly(place: TrackedPlace, now: Date): LiveArrivalAnomaly | null {
  const baseline = getBaselineExpectation(place.id, now);
  const nextHourArrivals = simulateNextHourArrivals(place, now);

  if (place.type === "airport") {
    const delayed = simulateDelayedFlights(place, now, nextHourArrivals);
    if (delayed.length > 0) {
      return {
        trackedPlaceId: place.id,
        trackedPlaceLabel: place.label,
        type: "delayed-flight",
        baselineArrivals: baseline.expectedArrivalsNextHour,
        nextHourArrivals,
        delayedArrivals: delayed,
      };
    }
  }

  if (nextHourArrivals >= baseline.expectedArrivalsNextHour + 3) {
    return {
      trackedPlaceId: place.id,
      trackedPlaceLabel: place.label,
      type: "significantly-above-average",
      baselineArrivals: baseline.expectedArrivalsNextHour,
      nextHourArrivals,
    };
  }

  if (nextHourArrivals > baseline.expectedArrivalsNextHour) {
    return {
      trackedPlaceId: place.id,
      trackedPlaceLabel: place.label,
      type: "above-average",
      baselineArrivals: baseline.expectedArrivalsNextHour,
      nextHourArrivals,
    };
  }

  return null;
}

function buildHeadline(anomaly: LiveArrivalAnomaly): string {
  if (anomaly.type === "above-average") {
    return `More than average arrivals in the next hour at ${anomaly.trackedPlaceLabel}`;
  }
  if (anomaly.type === "significantly-above-average") {
    return `Significantly more arrivals than usual near ${anomaly.trackedPlaceLabel}`;
  }
  return `${anomaly.delayedArrivals?.length ?? 0} delayed flights due into ${shortCode(anomaly.trackedPlaceLabel)} in the next hour`;
}

function buildDetails(anomaly: LiveArrivalAnomaly): string {
  if (anomaly.type === "delayed-flight" && anomaly.delayedArrivals && anomaly.delayedArrivals.length > 0) {
    const detail = anomaly.delayedArrivals
      .slice(0, 2)
      .map((item) => `${item.delayMinutes} min late`)
      .join(" and ");
    return `${anomaly.delayedArrivals.length} delayed flights are expected, including ${detail}.`;
  }

  if (anomaly.type === "significantly-above-average") {
    return `${anomaly.nextHourArrivals} expected vs baseline ${anomaly.baselineArrivals} for this day/hour window.`;
  }

  return `${anomaly.nextHourArrivals} expected vs baseline ${anomaly.baselineArrivals} in the next 60 minutes.`;
}

function inferPlaceType(label: string, postcode: string): TrackedPlaceType {
  const text = `${label} ${postcode}`.toLowerCase();
  if (text.includes("airport") || text.includes("bfs") || text.includes("bhd")) {
    return "airport";
  }
  if (text.includes("station") || text.includes("rail") || text.includes("lanyon")) {
    return "station";
  }
  return "venue";
}

function shortCode(label: string): string {
  if (label.toLowerCase().includes("international")) {
    return "BFS";
  }
  if (label.toLowerCase().includes("city")) {
    return "BHD";
  }
  return label;
}

function getBaselineExpectation(trackedPlaceId: string, now: Date): BaselineHourlyExpectation {
  const baselineSeed = seedFromId(trackedPlaceId);
  const weekday = now.getDay();
  const hour = now.getHours();
  const expectedArrivalsNextHour = 2 + ((baselineSeed + weekday + hour) % 5);
  return {
    trackedPlaceId,
    weekday,
    hour,
    expectedArrivalsNextHour,
  };
}

function simulateNextHourArrivals(place: TrackedPlace, now: Date): number {
  const hourBoost = now.getHours() >= 17 && now.getHours() <= 20 ? 2 : 0;
  const typeBoost = place.type === "airport" ? 2 : place.type === "station" ? 1 : 0;
  const seed = seedFromId(place.id) % 4;
  return 2 + seed + hourBoost + typeBoost;
}

function simulateDelayedFlights(place: TrackedPlace, now: Date, nextHourArrivals: number): Array<{ serviceId: string; delayMinutes: number }> {
  if (place.type !== "airport") {
    return [];
  }
  const seed = seedFromId(place.id + now.getHours().toString());
  if (seed % 3 !== 0) {
    return [];
  }
  const firstDelay = 12 + (seed % 38);
  const maybeSecondDelay = (seed % 2 === 0 && nextHourArrivals >= 4) ? 8 + ((seed + 7) % 45) : null;
  const delays = [{ serviceId: `${shortCode(place.label)}-A`, delayMinutes: firstDelay }];
  if (maybeSecondDelay) {
    delays.push({ serviceId: `${shortCode(place.label)}-B`, delayMinutes: maybeSecondDelay });
  }
  return delays;
}

function seedFromId(id: string): number {
  let seed = 0;
  for (let index = 0; index < id.length; index += 1) {
    seed += id.charCodeAt(index);
  }
  return seed;
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
}
