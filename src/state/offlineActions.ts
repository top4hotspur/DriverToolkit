import { OfflineAction } from "../contracts/tasks";

let completed = new Set<string>();
let latestImportedAt: string | null = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();

export async function getOutstandingActions(context: {
  hasNewAchievements: boolean;
  latestImportToken: string | null;
}): Promise<OfflineAction[]> {
  const now = new Date();
  const weekly = `receipts-${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${Math.ceil(now.getUTCDate() / 7)}`;

  const base: OfflineAction[] = [
    {
      id: weekly,
      type: "receipt-review",
      label: "Check outstanding expense records",
      priority: "high",
      completed: false,
      actionLabel: "Review",
      relatedRoute: "/reports",
    },
    {
      id: `tax-${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`,
      type: "tax-update",
      label: "Update tax savings amount",
      priority: "medium",
      completed: false,
      actionLabel: "Update",
      relatedRoute: "/settings",
    },
  ];

  if (latestImportedAt && isOlderThanDays(latestImportedAt, 27)) {
    base.push({
      id: `privacy-refresh-${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`,
      type: "privacy-refresh",
      label: "Refresh your privacy file",
      priority: "medium",
      completed: false,
      actionLabel: "Open Settings",
      relatedRoute: "/settings",
    });
  }

  if (context.hasNewAchievements) {
    base.push({
      id: `achievements-${context.latestImportToken ?? "none"}`,
      type: "review-achievements",
      label: "Review new achievements since latest upload",
      priority: "low",
      completed: false,
      actionLabel: "View",
      relatedRoute: "/reports/achievements",
    });
  }

  return base.filter((action) => !completed.has(action.id));
}

export async function completeOutstandingAction(actionId: string): Promise<void> {
  completed.add(actionId);
}

function isOlderThanDays(dateIso: string | null, days: number): boolean {
  if (!dateIso) {
    return false;
  }
  const ageMs = Date.now() - new Date(dateIso).getTime();
  return ageMs >= days * 24 * 60 * 60 * 1000;
}