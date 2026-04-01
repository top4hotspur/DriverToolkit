import { BasisWindow, ConfidenceLevel } from "./types";

export interface ConfidenceInputs {
  sampleSize: number;
  varianceRatio: number;
  comparabilityScore: number;
}

export function calculateConfidence(inputs: ConfidenceInputs): ConfidenceLevel {
  if (inputs.sampleSize < 3 || inputs.comparabilityScore < 0.35) {
    return "NONE";
  }

  if (inputs.sampleSize >= 20 && inputs.varianceRatio <= 0.2 && inputs.comparabilityScore >= 0.7) {
    return "HIGH";
  }

  if (
    (inputs.sampleSize >= 8 && inputs.sampleSize <= 19) ||
    (inputs.varianceRatio > 0.2 && inputs.varianceRatio <= 0.45)
  ) {
    return "MEDIUM";
  }

  return "LOW";
}

export function pickAdaptiveWindow(params: {
  availableDays: number;
  comparableObservations: number;
}): BasisWindow {
  const defaultDays = 90;

  if (params.comparableObservations >= 20 && params.availableDays >= 30) {
    return {
      days: 30,
      label: "Based on last 30 days",
      reason: "strong-sample",
    };
  }

  if (params.comparableObservations >= 8 || params.availableDays <= defaultDays) {
    return {
      days: Math.min(defaultDays, params.availableDays),
      label: "Based on last 90 days",
      reason: "default",
    };
  }

  const expandedDays = Math.min(Math.max(params.availableDays, 180), 365);
  const months = Math.round(expandedDays / 30);

  return {
    days: expandedDays,
    label: `Expanded to ${months} months due to low sample size`,
    reason: "sparse-sample",
  };
}
