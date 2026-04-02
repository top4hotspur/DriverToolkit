import {
  BaselineHourlyExpectation,
  LiveArrivalAnomaly,
  ProximityAlertResult,
  RailStationLiveSnapshot,
  TrackedPlace,
  TrackedPlaceType,
} from "../../contracts/advisory";
import {
  AirportArrivalAnomaly,
  DayAnomaly,
  DiaryDay,
  DiaryDayPlan,
  DiaryPlannerOutput,
  DiarySourceAnchor,
  OpportunityWindow,
  TransportDisruptionAnomaly,
  WeatherAnomaly,
} from "../../contracts/diary";
import { StartPoint } from "../../state/startPointTypes";
import {
  buildSeededRailSnapshotForDay,
  classifyRailActivity,
  getTrackedRailStations,
  stationForTrackedPlace,
} from "./translinkRail";

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
  {
    id: "seeded-grand-central",
    label: "Grand Central",
    type: "station",
    latitude: 54.5958,
    longitude: -5.9344,
    source: "seeded",
  },
  {
    id: "seeded-bangor",
    label: "Bangor",
    type: "station",
    latitude: 54.6646,
    longitude: -5.6686,
    source: "seeded",
  },
  {
    id: "seeded-sse",
    label: "SSE Arena",
    type: "venue",
    latitude: 54.6032,
    longitude: -5.9159,
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

export function buildDiaryPlanner(args: {
  now: Date;
  trackedPlaces: TrackedPlace[];
  days?: number;
  railSnapshots?: RailStationLiveSnapshot[];
}): DiaryPlannerOutput {
  const dayCount = Math.max(1, Math.min(args.days ?? 7, 7));
  const sourceAnchors: DiarySourceAnchor[] = args.trackedPlaces.map((place) => ({
    id: place.id,
    label: place.label,
    type: mapPlaceTypeToAnchorType(place.type, place.source),
    source: place.source,
    latitude: place.latitude,
    longitude: place.longitude,
    relatedFavouriteId: place.relatedFavouriteId ?? null,
  }));

  const days: DiaryDayPlan[] = [];
  for (let index = 0; index < dayCount; index += 1) {
    const date = startOfDay(addDays(args.now, index));
    const day = toDiaryDay(date, index);
    const anomalies = buildDayAnomalies({
      date,
      trackedPlaces: args.trackedPlaces,
      railSnapshots: args.railSnapshots ?? [],
      plannerNow: args.now,
    });
    const opportunities = buildOpportunityWindows({
      date,
      trackedPlaces: args.trackedPlaces,
      railSnapshots: args.railSnapshots ?? [],
      plannerNow: args.now,
    });
    days.push({ day, anomalies, opportunities });
  }

  return {
    generatedAt: args.now.toISOString(),
    basisLabel:
      "7 day rolling planner from favourites and live disruption monitoring",
    sourceAnchors,
    days,
  };
}

export function evaluateProximityAlert(args: {
  now: Date;
  currentCoords: { latitude: number; longitude: number } | null;
  trackedPlaces: TrackedPlace[];
  radiusMiles?: number;
  railSnapshots?: RailStationLiveSnapshot[];
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
    .map((candidate) => evaluatePlaceAnomaly(candidate.place, args.now, args.railSnapshots ?? []))
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

function buildDayAnomalies(args: {
  date: Date;
  trackedPlaces: TrackedPlace[];
  railSnapshots: RailStationLiveSnapshot[];
  plannerNow: Date;
}): DayAnomaly[] {
  const weather = buildWeatherAnomaly(args.date, args.trackedPlaces[0]);
  const transport = buildTransportAnomaly(args.date, args.trackedPlaces, args.railSnapshots, args.plannerNow);
  const airport = buildAirportAnomaly(args.date, args.trackedPlaces);

  return [weather, transport, airport]
    .filter((entry): entry is DayAnomaly => entry !== null)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

function buildOpportunityWindows(args: {
  date: Date;
  trackedPlaces: TrackedPlace[];
  railSnapshots: RailStationLiveSnapshot[];
  plannerNow: Date;
}): OpportunityWindow[] {
  const anchors = args.trackedPlaces.slice(0, Math.min(args.trackedPlaces.length, 6));
  const opportunities = anchors.map((place, index) => {
    const hourSeed = (seedFromId(place.id) + args.date.getDay() + index * 3) % 14;
    const startHour = 7 + hourSeed;
    const durationHours = place.type === "venue" ? 1 : 2;
    const startsAt = atHour(args.date, startHour);
    const endsAt = atHour(args.date, Math.min(startHour + durationHours, 23));
    const baseline = getBaselineExpectation(place.id, startsAt);
    const nextHourArrivals = simulateNextHourArrivals(place, startsAt);
    const confidence: OpportunityWindow["confidence"] =
      nextHourArrivals >= baseline.expectedArrivalsNextHour + 2 ? "HIGH" : "MEDIUM";

    return {
      id: `opp-${place.id}-${args.date.toISOString()}`,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      anchorId: place.id,
      anchorLabel: place.label,
      anchorType: mapPlaceTypeToAnchorType(place.type, place.source),
      confidence,
      title: buildOpportunityTitle(place),
      detail: buildOpportunityDetail(place, nextHourArrivals, baseline.expectedArrivalsNextHour),
    };
  });

  const railOpportunities = buildRailOpportunityWindows(args.date, args.railSnapshots, args.plannerNow);
  return [...opportunities, ...railOpportunities].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
}

function buildWeatherAnomaly(date: Date, anchor: TrackedPlace | undefined): WeatherAnomaly | null {
  const seed = seedFromId(`${date.toISOString().slice(0, 10)}-weather`);
  if (seed % 3 !== 0) {
    return null;
  }

  const startsAt = atHour(date, 12);
  const endsAt = atHour(date, 14);
  const severity: WeatherAnomaly["severity"] = seed % 2 === 0 ? "warning" : "info";

  return {
    id: `weather-${date.toISOString().slice(0, 10)}`,
    type: "weather",
    severity,
    areaLabel: anchor?.label ?? "Your monitored area",
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    message: `Weather warning in this period (${formatHourWindow(startsAt, endsAt)}).`,
  };
}

function buildTransportAnomaly(
  date: Date,
  trackedPlaces: TrackedPlace[],
  railSnapshots: RailStationLiveSnapshot[],
  plannerNow: Date,
): TransportDisruptionAnomaly | null {
  const station = trackedPlaces.find((place) => place.type === "station") ?? null;
  const dayKey = date.toISOString().slice(0, 10);
  const isToday = dayKey === plannerNow.toISOString().slice(0, 10);
  if (isToday) {
    const liveDisruption = railSnapshots.find((snapshot) => snapshot.replacementBusCount > 0 || snapshot.cancelledCount > 0);
    if (liveDisruption) {
      const startsAt = new Date(plannerNow);
      const endsAt = new Date(plannerNow.getTime() + 2 * 60 * 60 * 1000);
      const replacement = liveDisruption.replacementBusCount > 0;
      return {
        id: `transport-live-${liveDisruption.stationId}-${dayKey}`,
        type: "transport-disruption",
        severity: "warning",
        networkLabel: `${liveDisruption.stationLabel} rail corridor`,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        message: replacement
          ? `Replacement bus service expected on this corridor (${formatHourWindow(startsAt, endsAt)}).`
          : `Rail disruption expected in this period (${formatHourWindow(startsAt, endsAt)}).`,
      };
    }
  }

  if (!station) {
    return null;
  }
  const seed = seedFromId(`${station.id}-${date.getDay()}-transport`);
  if (seed % 4 !== 0) {
    return null;
  }
  const startsAt = atHour(date, 10);
  const endsAt = atHour(date, 16);
  return {
    id: `transport-${station.id}-${dayKey}`,
    type: "transport-disruption",
    severity: "warning",
    networkLabel: `${station.label} rail corridor`,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    message: `Rail disruption expected in this period (${formatHourWindow(startsAt, endsAt)}).`,
  };
}

function buildAirportAnomaly(date: Date, trackedPlaces: TrackedPlace[]): AirportArrivalAnomaly | null {
  const airport = trackedPlaces.find((place) => place.type === "airport");
  if (!airport) {
    return null;
  }

  const baseline = getBaselineExpectation(airport.id, atHour(date, 9));
  const arrivals = simulateNextHourArrivals(airport, atHour(date, 9));
  if (arrivals <= baseline.expectedArrivalsNextHour) {
    return null;
  }

  const delayedArrivals = simulateDelayedFlights(airport, date, arrivals);
  const startsAt = atHour(date, 9);
  const endsAt = atHour(date, 10);

  const delayedText = delayedArrivals.length > 0
    ? ` ${delayedArrivals.length} delayed arrivals expected.`
    : "";

  return {
    id: `airport-${airport.id}-${date.toISOString().slice(0, 10)}`,
    type: "airport-arrival",
    severity: delayedArrivals.length > 0 ? "high" : "info",
    airportLabel: airport.label,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    expectedArrivals: arrivals,
    delayedArrivals,
    message: `${arrivals} flights due into ${shortCode(airport.label)} in the next hour.${delayedText}`,
  };
}

function buildOpportunityTitle(place: TrackedPlace): string {
  if (place.type === "airport") {
    return `${shortCode(place.label)} arrivals window`;
  }
  if (place.type === "station") {
    return `${place.label} passenger window`;
  }
  return `${place.label} event window`;
}

function buildOpportunityDetail(place: TrackedPlace, arrivals: number, baseline: number): string {
  if (place.type === "airport") {
    return `Higher than average flight arrivals expected.`;
  }
  if (place.type === "station") {
    return `Higher than average passenger arrivals expected.`;
  }
  return `Event due to end.`;
}

function evaluatePlaceAnomaly(
  place: TrackedPlace,
  now: Date,
  railSnapshots: RailStationLiveSnapshot[],
): LiveArrivalAnomaly | null {
  const station = stationForTrackedPlace(place);
  if (station) {
    const liveSnapshot =
      railSnapshots.find((snapshot) => snapshot.stationId === station.id) ??
      buildSeededRailSnapshotForDay({ station, at: now });
    if (liveSnapshot.replacementBusCount > 0) {
      return {
        trackedPlaceId: place.id,
        trackedPlaceLabel: station.label,
        stationCode: station.stationCode,
        type: "replacement-bus",
        baselineArrivals: classifyRailActivity({
          stationId: station.id,
          now,
          arrivalsNextHour: liveSnapshot.arrivalsNextHour,
        }).baseline.expectedArrivalsNextHour,
        nextHourArrivals: liveSnapshot.arrivalsNextHour,
        disruptionMessage: "Replacement bus service expected on this corridor",
      };
    }
    if (liveSnapshot.cancelledCount > 0 || liveSnapshot.delayedCount >= 3) {
      return {
        trackedPlaceId: place.id,
        trackedPlaceLabel: station.label,
        stationCode: station.stationCode,
        type: "rail-disruption",
        baselineArrivals: classifyRailActivity({
          stationId: station.id,
          now,
          arrivalsNextHour: liveSnapshot.arrivalsNextHour,
        }).baseline.expectedArrivalsNextHour,
        nextHourArrivals: liveSnapshot.arrivalsNextHour,
        disruptionMessage: "Rail disruption affecting this corridor",
      };
    }
    const classification = classifyRailActivity({
      stationId: station.id,
      now,
      arrivalsNextHour: liveSnapshot.arrivalsNextHour,
    });
    if (classification.classification === "significantly_higher_than_average") {
      return {
        trackedPlaceId: place.id,
        trackedPlaceLabel: station.label,
        stationCode: station.stationCode,
        type: "significantly-above-average",
        baselineArrivals: classification.baseline.expectedArrivalsNextHour,
        nextHourArrivals: liveSnapshot.arrivalsNextHour,
      };
    }
    if (classification.classification === "higher_than_average") {
      return {
        trackedPlaceId: place.id,
        trackedPlaceLabel: station.label,
        stationCode: station.stationCode,
        type: "above-average",
        baselineArrivals: classification.baseline.expectedArrivalsNextHour,
        nextHourArrivals: liveSnapshot.arrivalsNextHour,
      };
    }
  }

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
  if (anomaly.type === "replacement-bus") {
    return "Replacement bus service expected on this corridor";
  }
  if (anomaly.type === "rail-disruption") {
    return `Rail disruption affecting ${anomaly.trackedPlaceLabel} services`;
  }
  if (anomaly.type === "above-average") {
    return `Higher than average passenger arrivals expected at ${anomaly.trackedPlaceLabel} in the next hour`;
  }
  if (anomaly.type === "significantly-above-average") {
    return `Significantly higher than average passenger arrivals expected at ${anomaly.trackedPlaceLabel}`;
  }
  return `${anomaly.delayedArrivals?.length ?? 0} delayed flights due into ${shortCode(anomaly.trackedPlaceLabel)} in the next hour`;
}

function buildDetails(anomaly: LiveArrivalAnomaly): string {
  if (anomaly.type === "replacement-bus" || anomaly.type === "rail-disruption") {
    return anomaly.disruptionMessage ?? "Service disruption expected in this period.";
  }
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

function buildRailOpportunityWindows(
  date: Date,
  railSnapshots: RailStationLiveSnapshot[],
  plannerNow: Date,
): OpportunityWindow[] {
  const isToday = date.toISOString().slice(0, 10) === plannerNow.toISOString().slice(0, 10);
  const stations = getTrackedRailStations();
  const opportunities: OpportunityWindow[] = [];

  for (const station of stations) {
    const snapshot = isToday
      ? railSnapshots.find((item) => item.stationId === station.id) ?? buildSeededRailSnapshotForDay({ station, at: date })
      : buildSeededRailSnapshotForDay({ station, at: date });

    const classification = classifyRailActivity({
      stationId: station.id,
      now: date,
      arrivalsNextHour: snapshot.arrivalsNextHour,
    });
    if (classification.classification === "normal") {
      continue;
    }

    const startsAt = isToday ? new Date(plannerNow) : atHour(date, 7 + (seedFromId(station.id) % 10));
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
    opportunities.push({
      id: `rail-opp-${station.id}-${date.toISOString().slice(0, 10)}`,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      anchorId: `rail-${station.id}`,
      anchorLabel: station.label,
      anchorType: "station",
      confidence: classification.classification === "significantly_higher_than_average" ? "HIGH" : "MEDIUM",
      title: `${station.label} rail window`,
      detail:
        classification.classification === "significantly_higher_than_average"
          ? "Significantly higher than average passenger arrivals expected"
          : "Higher than average passenger arrivals expected",
    });
  }

  return opportunities;
}

function inferPlaceType(label: string, postcode: string): TrackedPlaceType {
  const text = `${label} ${postcode}`.toLowerCase();
  if (text.includes("airport") || text.includes("bfs") || text.includes("bhd")) {
    return "airport";
  }
  if (
    text.includes("station") ||
    text.includes("rail") ||
    text.includes("lanyon") ||
    text.includes("bangor") ||
    text.includes("grand central") ||
    text.includes("great victoria")
  ) {
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

function mapPlaceTypeToAnchorType(type: TrackedPlaceType, source: TrackedPlace["source"]): DiarySourceAnchor["type"] {
  if (source === "favourite") {
    return "favourite";
  }
  return type;
}

function toDiaryDay(date: Date, index: number): DiaryDay {
  const selectorLabel =
    index === 0
      ? "Today"
      : index === 1
        ? "Tomorrow"
        : date.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit" });

  return {
    dateIso: date.toISOString(),
    dayLabel: date.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    selectorLabel,
    isToday: index === 0,
    isTomorrow: index === 1,
  };
}

function atHour(date: Date, hour: number): Date {
  const value = new Date(date);
  value.setHours(hour, 0, 0, 0);
  return value;
}

function startOfDay(date: Date): Date {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function addDays(date: Date, days: number): Date {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

function formatHourWindow(startsAt: Date, endsAt: Date): string {
  const start = startsAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  const end = endsAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${start} to ${end}`;
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
