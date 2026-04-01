export interface BusinessMileageSummary {
  active: boolean;
  activeSessionId: string | null;
  trackedBusinessMiles: number;
  trackingStartedAt: string | null;
  trackingStoppedAt: string | null;
}

export interface TrackingStartResult {
  ok: boolean;
  summary: BusinessMileageSummary;
  warning?: string;
}

export interface TrackingStopResult {
  ok: boolean;
  summary: BusinessMileageSummary;
}
