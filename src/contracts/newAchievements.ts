import { AchievementType } from "./achievements";

export type NewAchievementEventType = "new-best" | "new-worst" | "record-broken" | "painful-milestone";

export interface NewAchievementEvent {
  type: NewAchievementEventType;
  achievementId: AchievementType;
  headline: string;
  description: string;
  detectedAt: string;
}

export interface NewAchievementDetectionResult {
  hasNewAchievements: boolean;
  events: NewAchievementEvent[];
}

