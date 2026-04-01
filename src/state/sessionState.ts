import { SessionMode, SessionStateModel } from "./sessionTypes";

let state: SessionStateModel = {
  mode: "offline",
  currentAreaLabel: null,
  trackingStartedAt: null,
  trackingStoppedAt: null,
  businessMileageTrackingEnabled: false,
};

export async function getSessionState(): Promise<SessionStateModel> {
  return state;
}

export async function setSessionMode(mode: SessionMode, areaLabel: string | null = null): Promise<SessionStateModel> {
  const now = new Date().toISOString();
  state = {
    ...state,
    mode,
    currentAreaLabel: areaLabel,
    trackingStartedAt: mode === "online" ? now : state.trackingStartedAt,
    trackingStoppedAt: mode === "offline" ? now : state.trackingStoppedAt,
    businessMileageTrackingEnabled: mode === "online",
  };
  return state;
}

export async function setCurrentAreaLabel(areaLabel: string | null): Promise<void> {
  state = {
    ...state,
    currentAreaLabel: areaLabel,
  };
}

