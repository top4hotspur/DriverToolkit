import { OfflineTask } from "../contracts/tasks";

export function getOfflineTasksPlaceholder(): OfflineTask[] {
  return [
    {
      id: "task-receipts",
      type: "receipt-upload",
      label: "Upload this week\'s business receipts",
      priority: "high",
      completed: false,
      relatedRoute: "/reports",
    },
    {
      id: "task-flagged",
      type: "review-flagged-trips",
      label: "Review flagged trips from latest import",
      priority: "medium",
      completed: false,
      relatedRoute: "/claims",
    },
    {
      id: "task-achievements",
      type: "review-achievements",
      label: "Check new achievements since last upload",
      priority: "low",
      completed: false,
      relatedRoute: "/reports/achievements",
    },
  ];
}

