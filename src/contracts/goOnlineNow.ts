import { ConfidenceLevel } from "../domain/types";

export type GoOnlineDecision = "DONT_WORK" | "DO_WORK" | "DO_WORK_GO_TO_AREA";

export interface GoOnlineNowDecisionContract {
  decision: GoOnlineDecision;
  headline: string;
  rationale: string;
  confidence: ConfidenceLevel;
  sampleSize: number;
  comparedAreaLabel?: string;
  comparedAreaDistanceMiles?: number;
  percentileBand?: string;
  basisWindowDays: number;
}

