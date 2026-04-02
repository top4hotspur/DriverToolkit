import { getDb } from "../db/client.native";
import { SessionMode, SessionStateModel } from "./sessionTypes";

const SESSION_ID = "current";

export async function getSessionState(): Promise<SessionStateModel> {
  const db = await getDb();
  await ensureSessionRow();

  try {
    const row = await db.getFirstAsync<{
      mode: SessionMode;
      currentAreaLabel: string | null;
      trackingStartedAt: string | null;
      trackingStoppedAt: string | null;
      businessMileageTrackingEnabled: number;
      accumulatedOnlineSeconds: number | null;
    }>(`
      SELECT
        mode,
        current_area_label as currentAreaLabel,
        tracking_started_at as trackingStartedAt,
        tracking_stopped_at as trackingStoppedAt,
        business_mileage_tracking_enabled as businessMileageTrackingEnabled,
        accumulated_online_seconds as accumulatedOnlineSeconds
      FROM session_state
      WHERE id = ?
    `, [SESSION_ID]);

    const state = {
      mode: row?.mode ?? "offline",
      currentAreaLabel: row?.currentAreaLabel ?? null,
      trackingStartedAt: row?.trackingStartedAt ?? null,
      trackingStoppedAt: row?.trackingStoppedAt ?? null,
      businessMileageTrackingEnabled: (row?.businessMileageTrackingEnabled ?? 0) === 1,
      accumulatedOnlineSeconds: Math.floor(row?.accumulatedOnlineSeconds ?? 0),
    };
    logSessionState("get-session-state", state);
    return state;
  } catch {
    const legacy = await db.getFirstAsync<{
      mode: SessionMode;
      currentAreaLabel: string | null;
      trackingStartedAt: string | null;
      trackingStoppedAt: string | null;
      businessMileageTrackingEnabled: number;
    }>(`
      SELECT
        mode,
        current_area_label as currentAreaLabel,
        tracking_started_at as trackingStartedAt,
        tracking_stopped_at as trackingStoppedAt,
        business_mileage_tracking_enabled as businessMileageTrackingEnabled
      FROM session_state
      WHERE id = ?
    `, [SESSION_ID]);

    const state = {
      mode: legacy?.mode ?? "offline",
      currentAreaLabel: legacy?.currentAreaLabel ?? null,
      trackingStartedAt: legacy?.trackingStartedAt ?? null,
      trackingStoppedAt: legacy?.trackingStoppedAt ?? null,
      businessMileageTrackingEnabled: (legacy?.businessMileageTrackingEnabled ?? 0) === 1,
      accumulatedOnlineSeconds: 0,
    };
    logSessionState("get-session-state-legacy", state);
    return state;
  }
}

export async function setSessionMode(mode: SessionMode, areaLabel: string | null = null): Promise<SessionStateModel> {
  const db = await getDb();
  await ensureSessionRow();
  await ensureSessionColumns();
  await ensureSessionHistoryTable();

  const previous = await getSessionState();
  logSessionState("set-session-mode-before", previous, {
    targetMode: mode,
    targetAreaLabel: areaLabel,
  });
  const now = new Date();
  const nowIso = now.toISOString();
  const enabled = mode === "online" ? 1 : 0;

  let completedSessionSeconds = 0;
  if (mode === "offline" && previous.mode === "online" && previous.trackingStartedAt) {
    const started = new Date(previous.trackingStartedAt).getTime();
    completedSessionSeconds = Math.max(0, Math.floor((now.getTime() - started) / 1000));
  }

  const nextTrackingStartedAt = mode === "online" ? nowIso : null;
  const nextTrackingStoppedAt = mode === "offline" ? nowIso : previous.trackingStoppedAt;

  await updateSessionState(
    {
      mode,
      currentAreaLabel: areaLabel,
      trackingStartedAt: nextTrackingStartedAt,
      trackingStoppedAt: nextTrackingStoppedAt,
      businessMileageTrackingEnabled: enabled === 1,
      accumulatedOnlineSeconds: 0,
    },
    "set-session-mode",
  );

  if (completedSessionSeconds > 0 && previous.trackingStartedAt) {
    await db.runAsync(
      `
        INSERT INTO online_session_history (
          id, started_at, ended_at, duration_seconds, start_area_label, end_area_label, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        `online_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
        previous.trackingStartedAt,
        nowIso,
        completedSessionSeconds,
        previous.currentAreaLabel,
        areaLabel,
        nowIso,
      ],
    );
  }

  const next = await getSessionState();
  logSessionState("set-session-mode-after", next, {
    targetMode: mode,
    targetAreaLabel: areaLabel,
  });
  return next;
}

export async function setCurrentAreaLabel(areaLabel: string | null): Promise<void> {
  const before = await getSessionState();
  logSessionState("set-current-area-before", before, {
    targetAreaLabel: areaLabel,
  });
  await updateSessionState(
    {
      currentAreaLabel: areaLabel,
    },
    "set-current-area-label",
  );
  const after = await getSessionState();
  logSessionState("set-current-area-after", after, {
    targetAreaLabel: areaLabel,
  });
}

export async function updateSessionState(
  patch: Partial<SessionStateModel>,
  reason = "patch",
): Promise<SessionStateModel> {
  const db = await getDb();
  await ensureSessionRow();
  const previous = await getSessionState();
  const next: SessionStateModel = {
    ...previous,
    ...patch,
  };
  const nowIso = new Date().toISOString();
  await db.runAsync(
    `
      UPDATE session_state
      SET mode = ?,
          current_area_label = ?,
          tracking_started_at = ?,
          tracking_stopped_at = ?,
          business_mileage_tracking_enabled = ?,
          accumulated_online_seconds = ?,
          updated_at = ?
      WHERE id = ?
    `,
    [
      next.mode,
      next.currentAreaLabel,
      next.trackingStartedAt,
      next.trackingStoppedAt,
      next.businessMileageTrackingEnabled ? 1 : 0,
      next.accumulatedOnlineSeconds,
      nowIso,
      SESSION_ID,
    ],
  );
  logSessionState("update-session-state", next, { reason });
  return next;
}

async function ensureSessionColumns(): Promise<void> {
  const db = await getDb();
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(session_state)`);
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("accumulated_online_seconds")) {
    await db.execAsync(`ALTER TABLE session_state ADD COLUMN accumulated_online_seconds REAL DEFAULT 0`);
  }
}

function logSessionState(event: string, state: SessionStateModel, extras?: Record<string, unknown>): void {
  console.log(`[DT][session] ${event}`, {
    ...extras,
    mode: state.mode,
    currentAreaLabel: state.currentAreaLabel,
    trackingStartedAt: state.trackingStartedAt,
    trackingStoppedAt: state.trackingStoppedAt,
    businessMileageTrackingEnabled: state.businessMileageTrackingEnabled,
    accumulatedOnlineSeconds: state.accumulatedOnlineSeconds,
  });
}

async function ensureSessionHistoryTable(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS online_session_history (
      id TEXT PRIMARY KEY NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL,
      start_area_label TEXT,
      end_area_label TEXT,
      created_at TEXT NOT NULL
    )
  `);
}

async function ensureSessionRow(): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM session_state WHERE id = ?`,
    [SESSION_ID],
  );

  if ((existing?.count ?? 0) > 0) {
    return;
  }

  const now = new Date().toISOString();

  await db.runAsync(
    `
      INSERT INTO session_state (
        id, mode, current_area_label, tracking_started_at,
        tracking_stopped_at, business_mileage_tracking_enabled, accumulated_online_seconds, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [SESSION_ID, "offline", null, null, now, 0, 0, now],
  );
}
