import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { ExpenseRecord, LocalSyncStatus, getExpenseCategoryLabel } from "../contracts/expenses";
import { initDatabase } from "../db/schema";
import { listRecentExpenses, retryExpenseSync } from "../state/expenseState";
import { formatGBP, formatUkDate } from "../utils/format";
import { Card, KeyValueRow, PrimaryButton, ScreenShell } from "./ui";

export function ExpensesHistoryScreen() {
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    try {
      await initDatabase();
      const rows = await listRecentExpenses(100);
      setExpenses(rows);
      setMessage(null);
    } catch {
      setMessage("Couldn't load expenses right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadExpenses();
  }, [loadExpenses]);

  const onRetrySync = async (expenseId: string) => {
    setMessage(null);
    try {
      await retryExpenseSync(expenseId);
      await loadExpenses();
    } catch {
      setMessage("Couldn't retry sync for that expense.");
    }
  };

  return (
    <ScreenShell title="Expenses" subtitle="Recent expense saves and sync state.">
      <Card title="Actions" compact>
        <View style={styles.row}>
          <PrimaryButton label="Refresh" onPress={() => void loadExpenses()} />
        </View>
        {message ? <Text style={styles.errorText}>{message}</Text> : null}
      </Card>

      {loading ? <Text>Loading expenses...</Text> : null}

      {!loading && expenses.length === 0 ? (
        <Card title="No Expenses Yet">
          <Text>Add an expense from Home quick actions to see history here.</Text>
        </Card>
      ) : null}

      {expenses.map((expense) => (
        <Card key={expense.id} title={getExpenseCategoryLabel(expense.category)}>
          <KeyValueRow label="Expense type" value={expense.expenseType === "cash_manual" ? "Cash manual" : "Receipt upload"} />
          <KeyValueRow label="Amount" value={formatGBP(expense.amountGbp)} />
          <KeyValueRow label="Date" value={formatUkDate(expense.expenseDate)} />
          <KeyValueRow label="Payment" value={toPaymentLabel(expense.paymentMethod)} />
          <KeyValueRow label="Receipt" value={toReceiptLabel(expense.receiptRequiredStatus)} />
          <KeyValueRow label="Sync" value={toSyncLabel(expense.localSyncStatus)} />
          {expense.category === "fuel" ? <Text style={styles.fuelMarker}>Fuel expense</Text> : null}
          {expense.note ? <Text>{`Note: ${expense.note}`}</Text> : null}
          {expense.localSyncStatus === "needs-retry" ? (
            <PrimaryButton label="Retry sync" onPress={() => void onRetrySync(expense.id)} />
          ) : null}
          <Text style={styles.placeholderText}>Edit/delete coming soon.</Text>
        </Card>
      ))}
    </ScreenShell>
  );
}

function toPaymentLabel(value: ExpenseRecord["paymentMethod"]): string {
  if (value === "cash") {
    return "Cash";
  }
  if (value === "card") {
    return "Card";
  }
  return "Other";
}

function toReceiptLabel(value: ExpenseRecord["receiptRequiredStatus"]): string {
  if (value === "attached") {
    return "Receipt attached";
  }
  if (value === "add_later") {
    return "Add receipt later";
  }
  return "No receipt";
}

function toSyncLabel(value: LocalSyncStatus): string {
  if (value === "saved-local") {
    return "Saved locally";
  }
  if (value === "syncing") {
    return "Syncing...";
  }
  if (value === "synced") {
    return "Synced to cloud";
  }
  return "Needs retry";
}

const styles = {
  row: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 8,
  },
  fuelMarker: {
    color: "#23593f",
    fontWeight: "700" as const,
    marginTop: 4,
  },
  placeholderText: {
    marginTop: 6,
    color: "#5d6a63",
  },
  errorText: {
    marginTop: 8,
    color: "#7a382f",
  },
};
