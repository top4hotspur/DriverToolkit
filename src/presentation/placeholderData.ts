import {
  HaveIBeenHereBeforeContract,
  RecommendedActionContract,
  WhatUsuallyHappensNextContract,
} from "../contracts/recommendations";
import { BasisWindow } from "../domain/types";

const defaultBasis: BasisWindow = {
  days: 90,
  label: "Based on last 90 days",
  reason: "default",
};

export const placeholderDashboard: {
  contextState: string;
  recommendation: RecommendedActionContract;
  opportunityNudge: string;
  lowValueAreas: Array<{ area: string; minAcceptFare: number; note: string }>;
} = {
  contextState: "Evaluating weekday 17:00-18:00 context from historical patterns",
  recommendation: {
    action: "reposition",
    confidence: "MEDIUM",
    sampleSize: 12,
    rationale: "Comparable starts from this area underperformed your target benchmark in the first 30 minutes.",
    basisWindow: defaultBasis,
    alternative: {
      action: "short-wait-only",
      rationale: "If no job within 8 minutes, leave to avoid queue trap risk.",
    },
  },
  opportunityNudge: "Nearby BT7 historically performs better for this hour bucket.",
  lowValueAreas: [
    { area: "Airport Holding", minAcceptFare: 14.2, note: "High dead-mile tendency" },
    { area: "Retail Park East", minAcceptFare: 10.8, note: "Weak follow-on rate" },
  ],
};

export const placeholderOnlineGuidance = {
  areaStrength: "This area is historically in your lower quartile for this time.",
  nearbyAlternative: "BT7 is historically stronger within your configured travel radius.",
  shiftHint: "Short wait only here unless first offer clears your minimum threshold.",
};

export const placeholderDiary: {
  basisLabel: string;
  cards: Array<{ title: string; window: string; note: string; confidence: string }>;
} = {
  basisLabel: defaultBasis.label,
  cards: [
    {
      title: "Tue 07:00-09:00",
      window: "Commuter wave",
      note: "Historical starts here are steady but low-tip.",
      confidence: "Medium confidence",
    },
    {
      title: "Fri 18:30-21:00",
      window: "Event spillover",
      note: "Diary event overlap improved follow-on strength by 18%.",
      confidence: "High confidence",
    },
  ],
};

export const placeholderBeenHereBefore: HaveIBeenHereBeforeContract = {
  comparableContext: {
    areaCode: "CITY-CENTRE",
    weekdayClass: "weekday",
    hourBucket: "17:00-18:00",
  },
  averageWaitMinutes: 7.8,
  averageFirstFare: 9.4,
  likelyOutcome60Minutes: 15.3,
  likelyOutcome90Minutes: 22.1,
  followOnRate: 0.34,
  confidence: "MEDIUM",
  sampleSize: 12,
};

export const placeholderUsuallyNext: WhatUsuallyHappensNextContract = {
  comparableContext: {
    areaCode: "CITY-CENTRE",
    weekdayClass: "weekday",
    hourBucket: "17:00-18:00",
  },
  likelyNextJobType: "short urban hop",
  likelyWaitMinutes: 6.2,
  expectedYield60Minutes: 16.1,
  expectedYield90Minutes: 24.8,
  confidence: "MEDIUM",
  sampleSize: 12,
};

