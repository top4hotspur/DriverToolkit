import { AchievementsScreenContract } from "../contracts/achievements";
import {
  HaveIBeenHereBeforeContract,
  JourneyRegretContract,
  RecommendedActionContract,
  WhatUsuallyHappensNextContract,
} from "../contracts/recommendations";
import { RecoverySummaryContract } from "../contracts/recovery";
import { DetailedAnalysisContract, ReportCardContract } from "../contracts/reports";
import { CanonicalMetrics, ReportType, TripNormalizedRow } from "../domain/types";
import { ImportEngine, ImportFileDescriptor, ParsedImportBundle } from "./import/adapters";

export interface TruthEngine {
  enrichTrip(trip: TripNormalizedRow): Promise<TripNormalizedRow>;
  computeMetrics(trip: TripNormalizedRow): Promise<CanonicalMetrics>;
}

export interface DecisionEngine {
  getRecommendedAction(): Promise<RecommendedActionContract | null>;
  getHaveIBeenHereBefore(): Promise<HaveIBeenHereBeforeContract>;
  getWhatUsuallyHappensNext(): Promise<WhatUsuallyHappensNextContract>;
  getJourneyRegret(): Promise<JourneyRegretContract>;
  getReportCards(): Promise<ReportCardContract[]>;
  getDetailedAnalysis(reportType: ReportType): Promise<DetailedAnalysisContract>;
}

export interface RecoveryEngine {
  detectEarningsLeaks(): Promise<RecoverySummaryContract>;
}

export interface AchievementEngine {
  getAchievements(): Promise<AchievementsScreenContract>;
}

export interface DriverToolkitEngines {
  importEngine: ImportEngine;
  truthEngine: TruthEngine;
  decisionEngine: DecisionEngine;
  recoveryEngine: RecoveryEngine;
  achievementEngine: AchievementEngine;
}

export async function runImportPipeline(
  importEngine: ImportEngine,
  file: ImportFileDescriptor,
): Promise<ParsedImportBundle> {
  return importEngine.parseAndNormalize(file);
}
