import { RecommendedActionContract } from "../contracts/recommendations";

export interface RecommendedActionTemplateCopy {
  areaStrength: string;
  stayGuidance: string;
  nearbyGuidance: string;
}

type AreaStrengthTier = "lower-quartile" | "average" | "higher-band" | "best-areas";
type StayTier = "do-not-stay" | "wait-briefly" | "stay-short" | "stay-patient";
type NearbyTier = "nearby-stronger" | "best-local" | "stay-but-lean" | "move-on";

export function buildRecommendedActionTemplate(args: {
  recommendation: RecommendedActionContract;
  favouriteOrAreaLabel: string;
  hasNearbyAlternative: boolean;
}): RecommendedActionTemplateCopy {
  const areaTier = mapAreaStrength(args.recommendation);
  const stayTier = mapStayTier(args.recommendation);
  const nearbyTier = mapNearbyTier(args.recommendation, args.hasNearbyAlternative);

  return {
    areaStrength: areaStrengthLine(areaTier),
    stayGuidance: stayGuidanceLine(stayTier),
    nearbyGuidance: nearbyGuidanceLine(nearbyTier, args.favouriteOrAreaLabel),
  };
}

function mapAreaStrength(recommendation: RecommendedActionContract): AreaStrengthTier {
  if (recommendation.action === "avoid") {
    return "lower-quartile";
  }
  if (recommendation.action === "reposition") {
    return recommendation.confidence === "HIGH" ? "lower-quartile" : "average";
  }
  if (recommendation.action === "stay") {
    return recommendation.confidence === "HIGH" ? "best-areas" : "higher-band";
  }
  return "average";
}

function mapStayTier(recommendation: RecommendedActionContract): StayTier {
  if (recommendation.action === "avoid") {
    return "do-not-stay";
  }
  if (recommendation.action === "reposition") {
    return "wait-briefly";
  }
  if (recommendation.action === "stay") {
    return recommendation.confidence === "HIGH" ? "stay-patient" : "stay-short";
  }
  return "wait-briefly";
}

function mapNearbyTier(recommendation: RecommendedActionContract, hasNearbyAlternative: boolean): NearbyTier {
  if (recommendation.action === "avoid") {
    return "move-on";
  }
  if (recommendation.action === "reposition") {
    return hasNearbyAlternative ? "nearby-stronger" : "move-on";
  }
  if (recommendation.action === "stay") {
    return hasNearbyAlternative ? "stay-but-lean" : "best-local";
  }
  return "best-local";
}

function areaStrengthLine(tier: AreaStrengthTier): string {
  switch (tier) {
    case "lower-quartile":
      return "This area is historically in your **lower quartile** for this time.";
    case "average":
      return "This area is historically around your **average** for this time.";
    case "higher-band":
      return "This area is historically in your **higher band** for this time.";
    default:
      return "This area is historically one of your **best areas** for this time.";
  }
}

function stayGuidanceLine(tier: StayTier): string {
  switch (tier) {
    case "do-not-stay":
      return "**Do not stay** too long unless the first offer is good enough.";
    case "wait-briefly":
      return "**Wait briefly** and move on if nothing decent arrives.";
    case "stay-short":
      return "**Stay here** for a short period and reassess.";
    default:
      return "**Stay here** — this area usually justifies patience.";
  }
}

function nearbyGuidanceLine(tier: NearbyTier, areaLabel: string): string {
  switch (tier) {
    case "nearby-stronger":
      return `**${areaLabel} is historically stronger** within your travel radius.`;
    case "best-local":
      return "**This is your best local position** right now.";
    case "stay-but-lean":
      return `**Stay in this area**, but consider moving toward **${areaLabel}** if it stays quiet.`;
    default:
      return "**Move on** — a better nearby setup is usually available.";
  }
}
