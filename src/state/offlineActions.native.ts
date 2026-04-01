import { OfflineAction } from "../contracts/tasks";
import { getDb } from "../db/client.native";

export async function getOutstandingActions(context: {
  hasNewAchievements: boolean;
  latestImportToken: string | null;
}): Promise<OfflineAction[]> {
  const db = await getDb();
  const now = new Date();
  const completed = await listCompletedActionIds();

  const actions: OfflineAction[] = [];

  const weeklyReceiptId = `receipts-${weekToken(now)}`;
  if (!completed.has(weeklyReceiptId)) {
    actions.push({
      id: weeklyReceiptId,
      type: "receipt-review",
      label: "Check outstanding expense records",
      priority: "high",
      completed: false,
      actionLabel: "Review",
      relatedRoute: "/reports",
      recurrenceKey: weekToken(now),
    });
  }

  const flaggedCount = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM earnings_leaks WHERE status = 'open'`,
  );

  if ((flaggedCount?.count ?? 0) > 0 && context.latestImportToken) {
    const flaggedActionId = `flagged-${context.latestImportToken}`;
    if (!completed.has(flaggedActionId)) {
      actions.push({
        id: flaggedActionId,
        type: "review-flagged-trips",
        label: "Review flagged trips from latest upload",
        priority: "medium",
        completed: false,
        actionLabel: "Review",
        relatedRoute: "/claims",
      });
    }
  }

  const lastSettingsUpdate = await db.getFirstAsync<{ updatedAt: string | null }>(
    `SELECT updated_at as updatedAt FROM app_settings WHERE id = 'primary'`,
  );

  const needsTaxRefresh = isOlderThanDays(lastSettingsUpdate?.updatedAt ?? null, 30);
  const taxActionId = `tax-${monthToken(now)}`;
  if (needsTaxRefresh && !completed.has(taxActionId)) {
    actions.push({
      id: taxActionId,
      type: "tax-update",
      label: "Update tax savings amount",
      priority: "medium",
      completed: false,
      actionLabel: "Update",
      relatedRoute: "/settings",
      recurrenceKey: monthToken(now),
    });
  }

  const latestImport = await db.getFirstAsync<{ importedAt: string | null }>(
    `
      SELECT imported_at as importedAt
      FROM provider_imports
      WHERE parse_status = 'parsed'
      ORDER BY imported_at DESC
      LIMIT 1
    `,
  );

  const privacyRefreshId = `privacy-refresh-${monthToken(now)}`;
  if (latestImport?.importedAt && isOlderThanDays(latestImport.importedAt, 27) && !completed.has(privacyRefreshId)) {
    actions.push({
      id: privacyRefreshId,
      type: "privacy-refresh",
      label: "Refresh your privacy file",
      priority: "medium",
      completed: false,
      actionLabel: "Open Settings",
      relatedRoute: "/settings",
      recurrenceKey: monthToken(now),
    });
  }

  if (context.hasNewAchievements) {
    const achievementsId = `achievements-${context.latestImportToken ?? monthToken(now)}`;
    if (!completed.has(achievementsId)) {
      actions.push({
        id: achievementsId,
        type: "review-achievements",
        label: "Review new achievements since latest upload",
        priority: "low",
        completed: false,
        actionLabel: "View",
        relatedRoute: "/reports/achievements",
      });
    }
  }

  return actions;
}

export async function completeOutstandingAction(actionId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `
      INSERT OR REPLACE INTO task_states (id, completed_at, updated_at)
      VALUES (?, ?, ?)
    `,
    [actionId, new Date().toISOString(), new Date().toISOString()],
  );
}

async function listCompletedActionIds(): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string }>(`SELECT id FROM task_states`);
  return new Set(rows.map((row) => row.id));
}

function weekToken(date: Date): string {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const diff = (date.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  const week = Math.ceil((diff + start.getUTCDay() + 1) / 7);
  return `${date.getUTCFullYear()}-W${week}`;
}

function monthToken(date: Date): string {
  return `${date.getUTCFullYear()}-${(date.getUTCMonth() + 1).toString().padStart(2, "0")}`;
}

function isOlderThanDays(dateIso: string | null, days: number): boolean {
  if (!dateIso) {
    return false;
  }

  const ageMs = Date.now() - new Date(dateIso).getTime();
  return ageMs >= days * 24 * 60 * 60 * 1000;
}