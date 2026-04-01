import { getDb } from "../db/client.native";
import { SessionMode, SessionStateModel } from "./sessionTypes";

const SESSION_ID = "current";

export async function getSessionState(): Promise<SessionStateModel> {
  const db = await getDb();
  await ensureSessionRow();

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

  return {
    mode: row?.mode ?? "offline",
    currentAreaLabel: row?.currentAreaLabel ?? null,
    trackingStartedAt: row?.trackingStartedAt ?? null,
    trackingStoppedAt: row?.trackingStoppedAt ?? null,
    businessMileageTrackingEnabled: (row?.businessMileageTrackingEnabled ?? 0) === 1,
    accumulatedOnlineSeconds: Math.floor(row?.accumulatedOnlineSeconds ?? 0),
  };
}

export async function setSessionMode(mode: SessionMode, areaLabel: string | null = null): Promise<SessionStateModel> {
  const db = await getDb();
  await ensureSessionRow();

  const previous = await getSessionState();
  const now = new Date();
  const nowIso = now.toISOString();
  const enabled = mode === "online" ? 1 : 0;

  let accumulatedOnlineSeconds = previous.accumulatedOnlineSeconds;
  if (mode === "offline" && previous.mode === "online" && previous.trackingStartedAt) {
    const started = new Date(previous.trackingStartedAt).getTime();
    const deltaSeconds = Math.max(0, Math.floor((now.getTime() - started) / 1000));
    accumulatedOnlineSeconds += deltaSeconds;
  }

  await db.runAsync(
    `
      UPDATE session_state
      SET mode = ?,
          current_area_label = ?,
          tracking_started_at = CASE WHEN ? = 'online' THEN ? ELSE tracking_started_at END,
          tracking_stopped_at = CASE WHEN ? = 'offline' THEN ? ELSE tracking_stopped_at END,
          business_mileage_tracking_enabled = ?,
          accumulated_online_seconds = ?,
          updated_at = ?
      WHERE id = ?
    `,
    [mode, areaLabel, mode, nowIso, mode, nowIso, enabled, accumulatedOnlineSeconds, nowIso, SESSION_ID],
  );

  return getSessionState();
}

export async function setCurrentAreaLabel(areaLabel: string | null): Promise<void> {
  const db = await getDb();
  await ensureSessionRow();
  await db.runAsync(
    `
      UPDATE session_state
      SET current_area_label = ?, updated_at = ?
      WHERE id = ?
    `,
    [areaLabel, new Date().toISOString(), SESSION_ID],
  );
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