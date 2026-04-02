import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import {
  ExpenseCategory,
  EXPENSE_CATEGORY_OPTIONS,
  LocalSyncStatus,
  getExpenseCategoryLabel,
} from "../contracts/expenses";
import { initDatabase } from "../db/schema";
import { getExpenseSyncStatus, retryExpenseSync, saveExpense } from "../state/expenseState";
import { formatUkDate } from "../utils/format";
import { Card, PrimaryButton, ScreenShell } from "./ui";

export function CashExpenseScreen() {
  const router = useRouter();
  const [category, setCategory] = useState<ExpenseCategory>("other");
  const [amountInput, setAmountInput] = useState("");
  const [dateInput, setDateInput] = useState(new Date().toISOString().slice(0, 10));
  const [noteInput, setNoteInput] = useState("");
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<LocalSyncStatus | "info">("info");
  const [lastExpenseId, setLastExpenseId] = useState<string | null>(null);

  useEffect(() => {
    initDatabase().catch(() => {
      setStatusLabel("Couldn't initialize local storage.");
      setStatusTone("needs-retry");
    });
  }, []);

  const onSave = async () => {
    const amount = Number(amountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setStatusLabel("Enter a valid amount.");
      setStatusTone("needs-retry");
      return;
    }

    setStatusLabel("Syncing...");
    setStatusTone("syncing");

    try {
      const result = await saveExpense({
        category,
        expenseType: "cash_manual",
        paymentMethod: "cash",
        amountGbp: amount,
        expenseDate: dateInput,
        note: noteInput.trim() || null,
        receiptRequiredStatus: "none",
        receiptSourceType: null,
        localReceiptUri: null,
        mimeType: null,
        originalFileName: null,
        fileSizeBytes: null,
      });

      setLastExpenseId(result.expenseId);
      setStatusTone(result.localSyncStatus);
      setStatusLabel(buildSaveMessage(result.localSyncStatus));
      setAmountInput("");
      setNoteInput("");
    } catch {
      setStatusLabel("Couldn't save cash expense. Try again.");
      setStatusTone("needs-retry");
    }
  };

  const onRetrySync = async () => {
    if (!lastExpenseId) {
      return;
    }

    setStatusTone("syncing");
    setStatusLabel("Syncing...");
    try {
      const syncStatus = await retryExpenseSync(lastExpenseId);
      setStatusTone(syncStatus);
      setStatusLabel(buildSaveMessage(syncStatus));
    } catch {
      setStatusTone("needs-retry");
      setStatusLabel("Retry failed. Expense is still saved locally.");
    }
  };

  useEffect(() => {
    if (!lastExpenseId) {
      return;
    }

    let active = true;
    const tick = async () => {
      const state = await getExpenseSyncStatus(lastExpenseId);
      if (!active || !state) {
        return;
      }
      setStatusTone(state);
      setStatusLabel(buildSaveMessage(state));
    };

    tick().catch(() => {
      // Silent fallback; manual retry remains available.
    });
    const interval = setInterval(() => {
      tick().catch(() => {
        // Silent fallback; manual retry remains available.
      });
    }, 1500);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [lastExpenseId]);

  return (
    <ScreenShell title="Add Cash Expense" subtitle="Record cash expense now with immediate local save and best-effort cloud sync.">
      <Card title="Category">
        <View style={styles.row}>
          {EXPENSE_CATEGORY_OPTIONS.map((entry) => (
            <PrimaryButton
              key={entry.value}
              label={category === entry.value ? `${entry.label} (Selected)` : entry.label}
              onPress={() => setCategory(entry.value)}
            />
          ))}
        </View>
      </Card>

      <Card title="Details">
        <Text>Amount (GBP)</Text>
        <TextInput value={amountInput} onChangeText={setAmountInput} keyboardType="decimal-pad" style={styles.input} />
        <Text>Date (YYYY-MM-DD)</Text>
        <TextInput value={dateInput} onChangeText={setDateInput} style={styles.input} />
        <Text>{`Display: ${formatUkDate(dateInput)}`}</Text>
        <Text>Optional note</Text>
        <TextInput value={noteInput} onChangeText={setNoteInput} style={styles.input} />
      </Card>

      <Card title="Save">
        <PrimaryButton label="Save cash expense" onPress={onSave} />
        <PrimaryButton label="View expenses" onPress={() => router.push("/expenses/history")} />
        <Text>{`Category: ${getExpenseCategoryLabel(category)}`}</Text>
        {statusTone === "needs-retry" && lastExpenseId ? (
          <PrimaryButton label="Retry cloud sync" onPress={onRetrySync} />
        ) : null}
        {statusLabel ? <Text style={toneStyle(statusTone)}>{statusLabel}</Text> : null}
      </Card>
    </ScreenShell>
  );
}

function buildSaveMessage(sync: LocalSyncStatus): string {
  if (sync === "synced") {
    return "Synced to cloud.";
  }
  if (sync === "syncing") {
    return "Syncing...";
  }
  if (sync === "needs-retry") {
    return "Saved locally. Needs retry for cloud sync.";
  }
  return "Saved locally.";
}

function toneStyle(tone: LocalSyncStatus | "info") {
  if (tone === "synced") {
    return { color: "#23593f", marginTop: 8 };
  }
  if (tone === "needs-retry") {
    return { color: "#7a382f", marginTop: 8 };
  }
  return { color: "#415049", marginTop: 8 };
}

const styles = {
  input: {
    borderWidth: 1,
    borderColor: "#c5cbc3",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 8,
  },
};



