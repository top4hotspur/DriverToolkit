export type ExpenseType = "fuel" | "other";

export type ReceiptInputMode = "receipt-upload" | "cash-manual" | "upload-receipt-later" | "no-receipt";

export interface ExpenseFormInput {
  type: ExpenseType;
  amount: number;
  occurredOn: string;
  note?: string;
  receiptInputMode: ReceiptInputMode;
  localReceiptUri?: string | null;
  mimeType?: string | null;
  originalFileName?: string | null;
  fileSizeBytes?: number | null;
  confirmedFuelPricePerLitre?: number | null;
}

export interface SavedExpense {
  id: string;
  type: ExpenseType;
  amount: number;
  occurredOn: string;
  note: string | null;
  receiptInputMode: ReceiptInputMode;
  localReceiptUri: string | null;
  createdAt: string;
}

export interface ExpenseSaveResult {
  ok: boolean;
  expenseId: string;
  fuelPriceUpdated: boolean;
  warning?: string;
}
