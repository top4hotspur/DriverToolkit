import { ExpenseFormInput, ExpenseSaveResult, SavedExpense } from "../contracts/expenses";
import { getVehicleCostSettings, saveVehicleCostSettings } from "./vehicleCostState";

const stored: SavedExpense[] = [];

export async function saveExpense(input: ExpenseFormInput): Promise<ExpenseSaveResult> {
  const now = new Date().toISOString();
  const expenseId = `expense_${Date.now()}`;
  stored.unshift({
    id: expenseId,
    type: input.type,
    amount: input.amount,
    occurredOn: input.occurredOn,
    note: input.note ?? null,
    receiptInputMode: input.receiptInputMode,
    localReceiptUri: input.localReceiptUri ?? null,
    createdAt: now,
  });

  let fuelPriceUpdated = false;
  if (input.type === "fuel" && typeof input.confirmedFuelPricePerLitre === "number" && input.confirmedFuelPricePerLitre > 0) {
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
    fuelPriceUpdated,
  };
}

export async function listRecentExpenses(limit = 20): Promise<SavedExpense[]> {
  return stored.slice(0, limit);
}
