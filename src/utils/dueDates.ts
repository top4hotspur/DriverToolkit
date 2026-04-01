export function daysUntil(dateIso: string, nowIso: string = new Date().toISOString()): number {
  const now = new Date(nowIso).getTime();
  const due = new Date(dateIso).getTime();
  return Math.ceil((due - now) / (1000 * 60 * 60 * 24));
}

export function shouldShowDueWarning(dateIso: string, thresholdDays = 42): boolean {
  const remaining = daysUntil(dateIso);
  return remaining >= 0 && remaining <= thresholdDays;
}

