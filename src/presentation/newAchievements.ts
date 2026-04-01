import { NewAchievementDetectionResult } from "../contracts/newAchievements";

export function detectNewAchievementsAfterImport(tripCount: number): NewAchievementDetectionResult {
  if (tripCount < 10) {
    return {
      hasNewAchievements: false,
      events: [],
    };
  }

  return {
    hasNewAchievements: true,
    events: [
      {
        type: "record-broken",
        achievementId: "best-tip",
        headline: "New biggest tip ever",
        description: "Latest import contains a higher single-trip tip than your previous record.",
        detectedAt: new Date().toISOString(),
      },
      {
        type: "new-worst",
        achievementId: "worst-trip-per-mile",
        headline: "New lowest £/mile trip on record",
        description: "A long dead-mile return trip created a new low-value milestone.",
        detectedAt: new Date().toISOString(),
      },
    ],
  };
}

