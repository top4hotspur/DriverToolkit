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

