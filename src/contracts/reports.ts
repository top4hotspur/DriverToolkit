import { BasisWindow, ConfidenceLevel, ReportType } from "../domain/types";

export interface ReportCardContract {
  type: ReportType;
  title: string;
  summary: string;
  insightNudge: string;
  confidence: ConfidenceLevel;
  sampleSize: number;
  basisWindow: BasisWindow;
}

export interface DetailedAnalysisContract {
  reportType: ReportType;
  title: string;
  correctToDate: string;
  basisWindowNote: string;
  confidenceLabel: string;
  actionableInsight: string;
  comparisonRows: Array<{
    label: string;
    yourValue: string;
    comparableValue: string;
    delta: string;
  }>;
  takeaway: string;
  ifThenRules: Array<{
    if: string;
    then: string;
  }>;
}
