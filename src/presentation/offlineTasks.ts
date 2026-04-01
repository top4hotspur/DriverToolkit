import { OfflineAction } from "../contracts/tasks";

export type ReceiptActionState = "needs-receipt-now" | "upload-receipt-later" | "no-receipt-available";

export function buildReceiptActionLabel(state: ReceiptActionState): string {
  switch (state) {
    case "needs-receipt-now":
      return "Add receipt now";
    case "upload-receipt-later":
      return "Upload receipt later";
    default:
      return "No receipt available";
  }
}

export function isReceiptActionOutstanding(state: ReceiptActionState): boolean {
  return state === "needs-receipt-now" || state === "upload-receipt-later";
}

export function getCaughtUpState(actions: OfflineAction[]): string | null {
  return actions.length === 0 ? "You're all caught up." : null;
}
