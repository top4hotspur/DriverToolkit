import * as Location from "expo-location";
import { GoOnlineNowDecisionContract } from "../contracts/goOnlineNow";

export async function evaluateShouldGoOnlineNow(args: {
  maxRadiusMiles: number;
}): Promise<GoOnlineNowDecisionContract> {
  let distanceMiles = 0;

  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status === "granted") {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      distanceMiles = estimateDistanceToPreferredArea(position.coords.latitude, position.coords.longitude);
    }
  } catch {
    distanceMiles = 0;
  }

  if (distanceMiles > args.maxRadiusMiles) {
    return {
      decision: "DONT_WORK",
      headline: "Hold off for now",
      rationale:
        "Historically this time sits in your lower-performance band nearby, and no stronger area is inside your configured start radius.",
      confidence: "MEDIUM",
      sampleSize: 14,
      percentileBand: "bottom 25%",
      basisWindowDays: 90,
    };
  }

  if (distanceMiles > 1.5) {
    return {
      decision: "DO_WORK_GO_TO_AREA",
      headline: "Go online, but reposition first",
      rationale: "This immediate area is weak, but BT7 within range is historically stronger for this hour bucket.",
      confidence: "MEDIUM",
      sampleSize: 21,
      comparedAreaLabel: "BT7",
      comparedAreaDistanceMiles: round2(distanceMiles),
      percentileBand: "top 75%",
      basisWindowDays: 90,
    };
  }

  return {
    decision: "DO_WORK",
    headline: "Worth going online here",
    rationale: "This area/time combination is historically one of your stronger windows in the nearby set.",
    confidence: "HIGH",
    sampleSize: 26,
    percentileBand: "top 20%",
    basisWindowDays: 90,
  };
}

function estimateDistanceToPreferredArea(lat: number, lng: number): number {
  const targetLat = 54.597;
  const targetLng = -5.93;
  return haversineMiles(lat, lng, targetLat, targetLng);
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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

