export type TaskType =
  | "receipt-review"
  | "review-flagged-trips"
  | "tax-update"
  | "review-achievements";

export type TaskPriority = "high" | "medium" | "low";

export interface OfflineAction {
  id: string;
  type: TaskType;
  label: string;
  priority: TaskPriority;
  completed: boolean;
  actionLabel: string;
  relatedRoute?: string;
  recurrenceKey?: string;
}
