import { ConfidenceLevel } from "../domain/types";
import { AchievementRegistryId } from "./achievementRegistry";

export type AchievementType = AchievementRegistryId;

export interface AchievementCardContract {
  type: AchievementType;
  title: string;
  metricValue: string;
  occurredAt: string;
  areaOrContext: string;
  oneLineExplanation: string;
  confidence: ConfidenceLevel;
  sampleSize: number;
  shareText: string;
  shareTarget: "whatsapp";
  shareCtaLabel: string;
}

export interface AchievementsScreenContract {
  cards: AchievementCardContract[];
  generatedAt: string;
  basisLabel: string;
}
