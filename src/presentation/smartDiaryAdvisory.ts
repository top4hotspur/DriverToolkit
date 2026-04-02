import { DiaryPlannerOutput } from "../contracts/diary";
import { buildDiaryPlanner, buildTrackedPlacesFromFavourites } from "../engines/advisory/proximityAlerts";
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
