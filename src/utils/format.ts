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

const ukDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const ukDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatUkDate(input: string | Date | null | undefined): string {
  if (!input) {
    return "Not set";
  }
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) {
    return typeof input === "string" ? input : "Not set";
  }
  return ukDateFormatter.format(date);
}

export function formatUkDateTime(input: string | Date | null | undefined): string {
  if (!input) {
    return "Not set";
  }
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) {
    return typeof input === "string" ? input : "Not set";
  }
  return ukDateTimeFormatter.format(date);
}

export function formatDurationClock(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
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
