import { BusinessMileageSummary, TrackingStartResult, TrackingStopResult } from "../../contracts/tracking";

let summary: BusinessMileageSummary = {
  active: false,
  activeSessionId: null,
  trackedBusinessMiles: 0,
  trackingStartedAt: null,
  trackingStoppedAt: null,
  accumulatedOnlineSeconds: 0,
};

export async function startBusinessMileageTracking(_currentAreaLabel: string | null): Promise<TrackingStartResult> {
  summary = {
    ...summary,
    active: true,
    activeSessionId: summary.activeSessionId ?? `web-${Date.now()}`,
    trackingStartedAt: summary.trackingStartedAt ?? new Date().toISOString(),
  };

  return { ok: true, summary };
}

export async function stopBusinessMileageTracking(_currentAreaLabel: string | null): Promise<TrackingStopResult> {
  summary = {
    ...summary,
    active: false,
    trackingStoppedAt: new Date().toISOString(),
  };

  return { ok: true, summary };
}

export async function getBusinessMileageSummary(): Promise<BusinessMileageSummary> {
  return summary;
}

