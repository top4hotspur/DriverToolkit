export type TaskType = "receipt-upload" | "review-flagged-trips" | "expense-admin" | "review-achievements";

export type TaskPriority = "high" | "medium" | "low";

export interface OfflineTask {
  id: string;
  type: TaskType;
  label: string;
  priority: TaskPriority;
  completed: boolean;
  relatedRoute?: string;
}

