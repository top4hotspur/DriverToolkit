import * as Location from "expo-location";
import { GoOnlineNowDecisionContract } from "../contracts/goOnlineNow";
import { StartPoint } from "../state/startPointTypes";

export async function evaluateShouldGoOnlineNow(args: {
  maxRadiusMiles: number | null;
  startPoints: StartPoint[];
}): Promise<GoOnlineNowDecisionContract> {
  if (!args.maxRadiusMiles || args.maxRadiusMiles <= 0) {
    return unavailable("Set your travel radius in Settings to compare nearby start areas.");
  }

  if (args.startPoints.length === 0) {
    return unavailable("Add at least one preferred starting point in Settings first.");
  }

  const maxRadiusMiles = args.maxRadiusMiles;

  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      return unavailable("Location permission is needed for this one-off check.");
    }

    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const nearby = args.startPoints
      .map((point) => ({
        point,
        distanceMiles: haversineMiles(
          position.coords.latitude,
          position.coords.longitude,
          point.latitude,
          point.longitude,
        ),
      }))
      .filter((candidate) => candidate.distanceMiles <= maxRadiusMiles)
      .sort((a, b) => a.distanceMiles - b.distanceMiles);

    if (nearby.length === 0) {
      return {
        state: "decision",
        decision: "DONT_WORK",
        userFacingDecisionLabel: "Don't work now",
        headline: "Don't work now",
        rationale:
          "No preferred starting point inside your configured radius is historically strong enough for this time window.",
        evidenceLabel: "Good evidence",
        evidenceDetail: "Based on comparable start periods in your recent history.",
        percentileBand: "bottom 25%",
        basisWindowDays: 90,
      };
    }

    const best = nearby[0];
    const areaStrength = scoreAreaForCurrentTime(best.point.postcode);

    if (areaStrength >= 0.75) {
      return {
        state: "decision",
        decision: "DO_WORK",
        userFacingDecisionLabel: "Go online here",
        headline: "Go online here",
        rationale: `${best.point.postcode} is historically one of your stronger starts for this day and time.`,
        evidenceLabel: "Strong evidence",
        evidenceDetail: "Based on similar start windows in the last 90 days.",
        percentileBand: "top 20%",
        basisWindowDays: 90,
      };
    }

    if (nearby.length > 1) {
      const alternative = nearby[1];
      return {
        state: "decision",
        decision: "DO_WORK_GO_TO_AREA",
        userFacingDecisionLabel: "Go online, but reposition first",
        headline: "Go online, but reposition first",
        rationale: `${best.point.postcode} is weaker now, but ${alternative.point.postcode} is historically stronger for this time.`,
        evidenceLabel: "Good evidence",
        evidenceDetail: "Based on comparable starts and nearby area ranking.",
        comparedAreaLabel: alternative.point.postcode,
        comparedAreaDistanceMiles: round2(alternative.distanceMiles),
        percentileBand: "top 75%",
        basisWindowDays: 90,
      };
    }

    return {
      state: "decision",
      decision: "DONT_WORK",
      userFacingDecisionLabel: "Don't work now",
      headline: "Don't work now",
      rationale: "This starting point is usually weak for the current time and no stronger alternative is nearby.",
      evidenceLabel: "Light evidence",
      evidenceDetail: "Based on limited comparable starts.",
      percentileBand: "bottom 25%",
      basisWindowDays: 90,
    };
  } catch {
    return unavailable("We couldn't check your location just now. Try again.");
  }
}

function unavailable(message: string): GoOnlineNowDecisionContract {
  return {
    state: "unavailable",
    decision: null,
    userFacingDecisionLabel: "Unavailable",
    headline: "Couldn't complete this check",
    rationale: message,
    evidenceLabel: "No evidence",
    evidenceDetail: "No location comparison was completed.",
    basisWindowDays: 90,
    fallbackMessage: message,
  };
}

function scoreAreaForCurrentTime(postcode: string): number {
  const hour = new Date().getHours();
  const base = postcode.startsWith("BT7") ? 0.82 : postcode.startsWith("BT1") ? 0.68 : 0.55;

  if (hour >= 17 && hour <= 21) {
    return Math.min(base + 0.1, 0.95);
  }

  return base;
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
