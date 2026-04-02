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
  logSessionState("get-session-state", state);
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

  state = await updateSessionState(
    {
      mode,
      currentAreaLabel: areaLabel,
      trackingStartedAt: mode === "online" ? nowIso : null,
      trackingStoppedAt: mode === "offline" ? nowIso : state.trackingStoppedAt,
      businessMileageTrackingEnabled: mode === "online",
      accumulatedOnlineSeconds: 0,
    },
    "set-session-mode",
  );
  logSessionState("set-session-mode-after", state, {
    targetMode: mode,
    targetAreaLabel: areaLabel,
  });
  return state;
}

export async function setCurrentAreaLabel(areaLabel: string | null): Promise<void> {
  state = await updateSessionState(
    {
      currentAreaLabel: areaLabel,
    },
    "set-current-area-label",
  );
}

export async function updateSessionState(
  patch: Partial<SessionStateModel>,
  reason = "patch",
): Promise<SessionStateModel> {
  state = {
    ...state,
    ...patch,
  };
  logSessionState("update-session-state", state, { reason });
  return state;
}

function logSessionState(event: string, session: SessionStateModel, extras?: Record<string, unknown>): void {
  console.log(`[DT][session] ${event}`, {
    ...extras,
    mode: session.mode,
    currentAreaLabel: session.currentAreaLabel,
    trackingStartedAt: session.trackingStartedAt,
    trackingStoppedAt: session.trackingStoppedAt,
    businessMileageTrackingEnabled: session.businessMileageTrackingEnabled,
    accumulatedOnlineSeconds: session.accumulatedOnlineSeconds,
  });
}
