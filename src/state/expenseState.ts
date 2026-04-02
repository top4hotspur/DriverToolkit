import {
  AttachReceiptInput,
  ExpenseDetailRecord,
  ExpenseInput,
  ExpenseRecord,
  ExpenseSaveResult,
  ExpenseUpdateInput,
  LocalSyncStatus,
} from "../contracts/expenses";
import { getVehicleCostSettings, saveVehicleCostSettings } from "./vehicleCostState";

const stored: ExpenseDetailRecord[] = [];

export async function saveExpense(input: ExpenseInput): Promise<ExpenseSaveResult> {
  const now = new Date().toISOString();
  const expenseId = `expense_${Date.now()}`;

  stored.unshift({
    id: expenseId,
    userId: "local-user",
    category: input.category,
    expenseType: input.expenseType,
    paymentMethod: input.paymentMethod,
    amountGbp: input.amountGbp,
    expenseDate: input.expenseDate,
    note: input.note ?? null,
    receiptRequiredStatus: input.receiptRequiredStatus,
    receiptSourceType: input.receiptSourceType ?? null,
    receiptFileId: input.localReceiptUri ? `receipt_${Date.now()}` : null,
    fuelLitres: input.fuelLitres ?? null,
    fuelPricePerLitre: input.confirmedFuelPricePerLitre ?? input.fuelPricePerLitre ?? null,
    fuelTotal: input.fuelTotal ?? input.amountGbp,
    createdAt: now,
    updatedAt: now,
    localSyncStatus: "needs-retry",
    cloudSyncedAt: null,
    localReceiptUri: input.localReceiptUri ?? null,
    mimeType: input.mimeType ?? null,
    originalFileName: input.originalFileName ?? null,
    fileSizeBytes: input.fileSizeBytes ?? null,
    receiptUploadStatus: input.localReceiptUri ? "queued" : null,
    receiptCloudObjectKey: null,
    receiptUploadedAt: null,
  });

  let fuelPriceUpdated = false;
  if (input.category === "fuel" && typeof input.confirmedFuelPricePerLitre === "number" && input.confirmedFuelPricePerLitre > 0) {
    const current = await getVehicleCostSettings();
    await saveVehicleCostSettings({
      ...current,
      fuelPricePerLitre: input.confirmedFuelPricePerLitre,
    });
    fuelPriceUpdated = true;
  }

  return {
    ok: true,
    expenseId,
    localSyncStatus: "saved-local",
    fuelPriceUpdated,
    warning: "Saved locally first. Cloud sync is not configured for web fallback.",
  };
}

export async function retryExpenseSync(_: string): Promise<LocalSyncStatus> {
  return "needs-retry";
}

export async function getExpenseSyncStatus(expenseId: string): Promise<LocalSyncStatus | null> {
  const match = stored.find((entry) => entry.id === expenseId);
  return match?.localSyncStatus ?? null;
}

export async function listRecentExpenses(limit = 20): Promise<ExpenseRecord[]> {
  return stored.slice(0, limit);
}

export async function getExpenseDetail(expenseId: string): Promise<ExpenseDetailRecord | null> {
  return stored.find((entry) => entry.id === expenseId) ?? null;
}

export async function updateExpense(expenseId: string, input: ExpenseUpdateInput): Promise<LocalSyncStatus> {
  const match = stored.find((entry) => entry.id === expenseId);
  if (!match) {
    throw new Error("Expense not found.");
  }

  match.category = input.category;
  match.amountGbp = input.amountGbp;
  match.expenseDate = input.expenseDate;
  match.paymentMethod = input.paymentMethod;
  match.note = input.note ?? null;
  match.fuelLitres = input.category === "fuel" ? (input.fuelLitres ?? null) : null;
  match.fuelPricePerLitre = input.category === "fuel"
    ? (input.confirmedFuelPricePerLitre ?? input.fuelPricePerLitre ?? null)
    : null;
  match.fuelTotal = input.category === "fuel" ? (input.fuelTotal ?? input.amountGbp) : null;
  match.localSyncStatus = "needs-retry";
  match.updatedAt = new Date().toISOString();

  const confirmedFuelPrice = input.confirmedFuelPricePerLitre ?? input.fuelPricePerLitre ?? null;
  if (input.category === "fuel" && typeof confirmedFuelPrice === "number" && confirmedFuelPrice > 0) {
    const current = await getVehicleCostSettings();
    await saveVehicleCostSettings({
      ...current,
      fuelPricePerLitre: confirmedFuelPrice,
    });
  }

  return "saved-local";
}

export async function attachReceiptToExpense(expenseId: string, input: AttachReceiptInput): Promise<LocalSyncStatus> {
  const match = stored.find((entry) => entry.id === expenseId);
  if (!match) {
    throw new Error("Expense not found.");
  }

  match.receiptRequiredStatus = "attached";
  match.receiptSourceType = input.receiptSourceType ?? "file-upload";
  match.localReceiptUri = input.localReceiptUri;
  match.mimeType = input.mimeType ?? null;
  match.originalFileName = input.originalFileName ?? null;
  match.fileSizeBytes = input.fileSizeBytes ?? null;
  match.receiptFileId = match.receiptFileId ?? `receipt_${Date.now()}`;
  match.receiptUploadStatus = "queued";
  match.receiptCloudObjectKey = null;
  match.receiptUploadedAt = null;
  match.localSyncStatus = "needs-retry";
  match.updatedAt = new Date().toISOString();

  return "saved-local";
}

export async function deleteExpense(expenseId: string): Promise<{ deleted: boolean; cloudDeletePending: boolean }> {
  const index = stored.findIndex((entry) => entry.id === expenseId);
  if (index < 0) {
    return { deleted: false, cloudDeletePending: false };
  }

  const cloudDeletePending = Boolean(stored[index].cloudSyncedAt);
  stored.splice(index, 1);
  return { deleted: true, cloudDeletePending };
}
