export interface NewAchievementEvent {
  type: "new-best" | "new-worst" | "record-broken" | "painful-milestone";
  achievementId: string;
  headline: string;
  description: string;
  detectedAt: string;
}

export interface NewAchievementDetectionResult {
  hasNewAchievements: boolean;
  events: NewAchievementEvent[];
}
