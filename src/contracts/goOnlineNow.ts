export type GoOnlineDecision = "DONT_WORK" | "DO_WORK" | "DO_WORK_GO_TO_AREA";

export interface GoOnlineNowDecisionContract {
  state: "decision" | "unavailable";
  decision: GoOnlineDecision | null;
  userFacingDecisionLabel: string;
  headline: string;
  rationale: string;
  evidenceLabel: "Strong evidence" | "Good evidence" | "Light evidence" | "No evidence";
  evidenceDetail: string;
  comparedAreaLabel?: string;
  comparedAreaDistanceMiles?: number;
  percentileBand?: string;
  basisWindowDays: number;
  fallbackMessage?: string;
}
