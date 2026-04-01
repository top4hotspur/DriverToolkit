import { SessionMode, SessionStateModel } from "./sessionTypes";

let state: SessionStateModel = {
  mode: "offline",
  currentAreaLabel: null,
  trackingStartedAt: null,
  trackingStoppedAt: null,
  businessMileageTrackingEnabled: false,
  accumulatedOnlineSeconds: 0,
};

export async function getSessionState(): Promise<SessionStateModel> {
  return state;
}

export async function setSessionMode(mode: SessionMode, areaLabel: string | null = null): Promise<SessionStateModel> {
  const now = new Date();
  const nowIso = now.toISOString();

  let accumulatedOnlineSeconds = state.accumulatedOnlineSeconds;
  if (mode === "offline" && state.mode === "online" && state.trackingStartedAt) {
    const started = new Date(state.trackingStartedAt).getTime();
    const deltaSeconds = Math.max(0, Math.floor((now.getTime() - started) / 1000));
    accumulatedOnlineSeconds += deltaSeconds;
  }

  state = {
    ...state,
    mode,
    currentAreaLabel: areaLabel,
    trackingStartedAt: mode === "online" ? nowIso : state.trackingStartedAt,
    trackingStoppedAt: mode === "offline" ? nowIso : state.trackingStoppedAt,
    businessMileageTrackingEnabled: mode === "online",
    accumulatedOnlineSeconds,
  };
  return state;
}

export async function setCurrentAreaLabel(areaLabel: string | null): Promise<void> {
  state = {
    ...state,
    currentAreaLabel: areaLabel,
  };
}