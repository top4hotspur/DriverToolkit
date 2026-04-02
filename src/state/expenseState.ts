import { ExpenseInput, ExpenseRecord, ExpenseSaveResult, LocalSyncStatus } from "../contracts/expenses";
import { getVehicleCostSettings, saveVehicleCostSettings } from "./vehicleCostState";

const stored: ExpenseRecord[] = [];

export async function saveExpense(input: ExpenseInput): Promise<ExpenseSaveResult> {
  const now = new Date().toISOString();
  const expenseId = `expense_${Date.now()}`;

  const localSyncStatus: LocalSyncStatus = "needs-retry";

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
    receiptFileId: null,
    fuelLitres: input.fuelLitres ?? null,
    fuelPricePerLitre: input.confirmedFuelPricePerLitre ?? input.fuelPricePerLitre ?? null,
    fuelTotal: input.fuelTotal ?? input.amountGbp,
    createdAt: now,
    updatedAt: now,
    localSyncStatus,
    cloudSyncedAt: null,
    localReceiptUri: input.localReceiptUri ?? null,
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

