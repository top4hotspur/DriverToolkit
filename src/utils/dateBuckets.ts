export function toHourBucket(dateIso: string): string {
  const date = new Date(dateIso);
  const hour = date.getUTCHours();
  const next = (hour + 1) % 24;
  return `${hour.toString().padStart(2, "0")}:00-${next.toString().padStart(2, "0")}:00`;
}

export function toDayOfWeek(dateIso: string): string {
  const day = new Date(dateIso).getUTCDay();
  const map = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return map[day] ?? "Unknown";
}

export function toWeekType(dateIso: string): "weekday" | "weekend" {
  const day = new Date(dateIso).getUTCDay();
  return day === 0 || day === 6 ? "weekend" : "weekday";
}
