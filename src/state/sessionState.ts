import { SessionMode, SessionStateModel } from "./sessionTypes";

let state: SessionStateModel = {
  mode: "offline",
  currentAreaLabel: null,
  trackingStartedAt: null,
  trackingStoppedAt: null,
  businessMileageTrackingEnabled: false,
  accumulatedOnlineSeconds: 0,
};

const completedOnlineSessions: Array<{
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  startAreaLabel: string | null;
  endAreaLabel: string | null;
}> = [];

export async function getSessionState(): Promise<SessionStateModel> {
  return state;
}

export async function setSessionMode(mode: SessionMode, areaLabel: string | null = null): Promise<SessionStateModel> {
  const now = new Date();
  const nowIso = now.toISOString();

  if (mode === "offline" && state.mode === "online" && state.trackingStartedAt) {
    const started = new Date(state.trackingStartedAt).getTime();
    const durationSeconds = Math.max(0, Math.floor((now.getTime() - started) / 1000));
    if (durationSeconds > 0) {
      completedOnlineSessions.unshift({
        startedAt: state.trackingStartedAt,
        endedAt: nowIso,
        durationSeconds,
        startAreaLabel: state.currentAreaLabel,
        endAreaLabel: areaLabel,
      });
    }
  }

  state = {
    ...state,
    mode,
    currentAreaLabel: areaLabel,
    trackingStartedAt: mode === "online" ? nowIso : null,
    trackingStoppedAt: mode === "offline" ? nowIso : state.trackingStoppedAt,
    businessMileageTrackingEnabled: mode === "online",
    accumulatedOnlineSeconds: 0,
  };
  return state;
}

export async function setCurrentAreaLabel(areaLabel: string | null): Promise<void> {
  state = {
    ...state,
    currentAreaLabel: areaLabel,
  };
}