import { ConfidenceLevel } from "../domain/types";

export const gbpFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

export function formatGBP(value: number): string {
  return gbpFormatter.format(value);
}

export function formatMiles(value: number): string {
  return `${value.toFixed(2)} miles`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function evidenceLabelFromConfidence(level: ConfidenceLevel): "Strong evidence" | "Good evidence" | "Light evidence" | "No evidence" {
  switch (level) {
    case "HIGH":
      return "Strong evidence";
    case "MEDIUM":
      return "Good evidence";
    case "LOW":
      return "Light evidence";
    default:
      return "No evidence";
  }
}

export function evidenceDetailFromSample(sampleSize: number, noun = "similar periods"): string {
  if (sampleSize <= 0) {
    return "No comparable history yet.";
  }
  return `Based on ${sampleSize} ${noun}.`;
}
