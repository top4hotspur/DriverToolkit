import { DiaryAdvisoryEntry } from "../contracts/advisory";
import { buildDiaryAdvisories, buildTrackedPlacesFromFavourites } from "../engines/advisory/proximityAlerts";
import { StartPoint } from "../state/startPointTypes";

export function buildSmartDiaryFromFavourites(args: {
  favourites: StartPoint[];
  now: Date;
}): {
  basisLabel: string;
  entries: DiaryAdvisoryEntry[];
} {
  const trackedPlaces = buildTrackedPlacesFromFavourites(args.favourites);
  const entries = buildDiaryAdvisories({
    now: args.now,
    trackedPlaces,
  });

  return {
    basisLabel: "Favourites + monitored places (day/hour baseline with event-aware advisory scaffolding)",
    entries,
  };
}
