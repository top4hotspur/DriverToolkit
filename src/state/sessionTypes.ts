export type SessionMode = "online" | "offline";

export interface SessionStateModel {
  mode: SessionMode;
  currentAreaLabel: string | null;
  trackingStartedAt: string | null;
  trackingStoppedAt: string | null;
  businessMileageTrackingEnabled: boolean;
  accumulatedOnlineSeconds: number;
}

export interface SessionToggleResult {
  state: SessionStateModel;
}