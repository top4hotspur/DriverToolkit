import {
  BasisWindow,
  ComparableContext,
  ConfidenceLevel,
  RecommendationAction,
} from "../domain/types";

export interface RecommendedActionContract {
  action: RecommendationAction;
  confidence: ConfidenceLevel;
  sampleSize: number;
  rationale: string;
  basisWindow: BasisWindow;
  alternative?: {
    action: RecommendationAction;
    rationale: string;
  };
}

export interface HaveIBeenHereBeforeContract {
  comparableContext: ComparableContext;
  averageWaitMinutes: number;
  averageFirstFare: number;
  likelyOutcome60Minutes: number;
  likelyOutcome90Minutes: number;
  followOnRate: number;
  confidence: ConfidenceLevel;
  sampleSize: number;
}

export interface WhatUsuallyHappensNextContract {
  comparableContext: ComparableContext;
  likelyNextJobType: string;
  likelyWaitMinutes: number;
  expectedYield60Minutes: number;
  expectedYield90Minutes: number;
  confidence: ConfidenceLevel;
  sampleSize: number;
}

export interface BadBetAreaContract {
  areaCode: string;
  areaName: string;
  averageTrueNetPerHour: number;
  averageTrueNetPerMile: number;
  deadMileTendency: "low" | "moderate" | "high";
  suggestedMinimumAcceptFare: number;
  trend: "improving" | "flat" | "declining";
  confidence: ConfidenceLevel;
  sampleSize: number;
}

export interface JourneyRegretContract {
  regretScore: number;
  commonTheme: string;
  suggestedThresholdRule: string;
  confidence: ConfidenceLevel;
  sampleSize: number;
}
