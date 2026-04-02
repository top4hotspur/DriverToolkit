import { DiaryPlannerOutput } from "../contracts/diary";
import { buildDiaryPlanner, buildTrackedPlacesFromFavourites } from "../engines/advisory/proximityAlerts";
import { fetchTranslinkRailSnapshots } from "../engines/advisory/translinkRail";
import { StartPoint } from "../state/startPointTypes";

export function buildSmartDiaryPlanner(args: {
  favourites: StartPoint[];
  now: Date;
}): DiaryPlannerOutput {
  const trackedPlaces = buildTrackedPlacesFromFavourites(args.favourites);
  return buildDiaryPlanner({
    now: args.now,
    trackedPlaces,
    days: 7,
  });
}

export async function buildSmartDiaryPlannerWithRail(args: {
  favourites: StartPoint[];
  now: Date;
}): Promise<DiaryPlannerOutput> {
  const trackedPlaces = buildTrackedPlacesFromFavourites(args.favourites);
  const rail = await fetchTranslinkRailSnapshots({ now: args.now }).catch(() => ({
    snapshots: [],
    warnings: ["Live rail feed unavailable; diary using fallback rail expectations."],
  }));

  const planner = buildDiaryPlanner({
    now: args.now,
    trackedPlaces,
    days: 7,
    railSnapshots: rail.snapshots,
  });

  return planner;
}
