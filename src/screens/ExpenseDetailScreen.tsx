import * as DocumentPicker from "expo-document-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Text, TextInput, View } from "react-native";
import {
  ExpenseCategory,
  ExpenseDetailRecord,
  ExpensePaymentMethod,
  EXPENSE_CATEGORY_OPTIONS,
  LocalSyncStatus,
  getExpenseCategoryLabel,
} from "../contracts/expenses";
import { initDatabase } from "../db/schema";
import {
  attachReceiptToExpense,
  deleteExpense,
  getExpenseDetail,
  getExpenseSyncStatus,
  retryExpenseSync,
  updateExpense,
} from "../state/expenseState";
import { formatGBP, formatUkDate, formatUkDateTime } from "../utils/format";
import { Card, KeyValueRow, PrimaryButton, ScreenShell } from "./ui";

const PAYMENT_METHODS: ExpensePaymentMethod[] = ["card", "cash", "other"];

export function ExpenseDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ expenseId?: string }>();
  const expenseId = typeof params.expenseId === "string" ? params.expenseId : "";

  const [expense, setExpense] = useState<ExpenseDetailRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<LocalSyncStatus | "info">("info");

  const [category, setCategory] = useState<ExpenseCategory>("other");
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>("other");
  const [amountInput, setAmountInput] = useState("");
  const [dateInput, setDateInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [fuelLitresInput, setFuelLitresInput] = useState("");
  const [fuelPriceInput, setFuelPriceInput] = useState("");

  const amount = useMemo(() => Number(amountInput), [amountInput]);
  const fuelLitres = useMemo(() => Number(fuelLitresInput), [fuelLitresInput]);
  const fuelPrice = useMemo(() => Number(fuelPriceInput), [fuelPriceInput]);

  const loadExpense = useCallback(async () => {
    if (!expenseId) {
      setLoading(false);
      setMessage("Missing expense ID.");
      setStatusTone("needs-retry");
      return;
    }

    setLoading(true);
    try {
      await initDatabase();
      const detail = await getExpenseDetail(expenseId);
      if (!detail) {
        setMessage("Expense not found.");
        setStatusTone("needs-retry");
        setExpense(null);
      } else {
        setExpense(detail);
        setCategory(detail.category);
        setPaymentMethod(detail.paymentMethod);
        setAmountInput(detail.amountGbp.toFixed(2));
        setDateInput(detail.expenseDate);
        setNoteInput(detail.note ?? "");
        setFuelLitresInput(detail.fuelLitres ? detail.fuelLitres.toString() : "");
        setFuelPriceInput(detail.fuelPricePerLitre ? detail.fuelPricePerLitre.toString() : "");
        setMessage(null);
        setStatusTone(detail.localSyncStatus);
      }
    } catch {
      setMessage("Couldn't load expense details.");
      setStatusTone("needs-retry");
    } finally {
      setLoading(false);
    }
  }, [expenseId]);

  useEffect(() => {
    void loadExpense();
  }, [loadExpense]);

  useEffect(() => {
    if (!expenseId) {
      return;
    }

    let active = true;
    const tick = async () => {
      const state = await getExpenseSyncStatus(expenseId);
      if (!active || !state) {
        return;
      }
      setStatusTone(state);
    };

    void tick();
    const interval = setInterval(() => {
      void tick();
    }, 1600);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [expenseId]);

  const onSaveEdits = async () => {
    if (!expense) {
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage("Enter a valid amount.");
      setStatusTone("needs-retry");
      return;
    }

    if (!dateInput.trim()) {
      setMessage("Enter a valid date.");
      setStatusTone("needs-retry");
      return;
    }

    if (category === "fuel") {
      if (!Number.isFinite(fuelLitres) || fuelLitres <= 0 || !Number.isFinite(fuelPrice) || fuelPrice <= 0) {
        setMessage("For fuel expenses, enter litres and fuel £/L.");
        setStatusTone("needs-retry");
        return;
      }
    }

    setMessage("Saving locally and queuing sync...");
    setStatusTone("syncing");

    try {
      const nextStatus = await updateExpense(expense.id, {
        category,
        paymentMethod,
        amountGbp: amount,
        expenseDate: dateInput,
        note: noteInput.trim() || null,
        fuelLitres: category === "fuel" ? fuelLitres : null,
        fuelPricePerLitre: category === "fuel" ? fuelPrice : null,
        fuelTotal: category === "fuel" ? amount : null,
        confirmedFuelPricePerLitre: category === "fuel" ? fuelPrice : null,
      });
      setStatusTone(nextStatus);
      setMessage(buildSaveMessage(nextStatus));
      await loadExpense();
    } catch {
      setStatusTone("needs-retry");
      setMessage("Couldn't save edits. Try again.");
    }
  };

  const onRetrySync = async () => {
    if (!expense) {
      return;
    }
    setStatusTone("syncing");
    setMessage("Syncing...");
    try {
      const state = await retryExpenseSync(expense.id);
      setStatusTone(state);
      setMessage(buildSaveMessage(state));
      await loadExpense();
    } catch {
      setStatusTone("needs-retry");
      setMessage("Retry failed. Expense remains saved locally.");
    }
  };

  const onAttachReceiptLater = async () => {
    if (!expense) {
      return;
    }

    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const file = result.assets[0];
      setStatusTone("syncing");
      setMessage("Attaching receipt and queuing sync...");

      const nextState = await attachReceiptToExpense(expense.id, {
        localReceiptUri: file.uri,
        mimeType: file.mimeType ?? null,
        originalFileName: file.name ?? null,
        fileSizeBytes: file.size ?? null,
        receiptSourceType: "file-upload",
      });

      setStatusTone(nextState);
      setMessage(buildSaveMessage(nextState));
      await loadExpense();
    } catch {
      setStatusTone("needs-retry");
      setMessage("Couldn't attach receipt right now.");
    }
  };

  const onDelete = () => {
    if (!expense) {
      return;
    }

    Alert.alert(
      "Delete expense",
      "Are you sure you want to delete this expense?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const result = await deleteExpense(expense.id);
              if (result.cloudDeletePending) {
                setMessage("Deleted locally. Cloud delete is queued for follow-up.");
              }
              router.replace("/expenses/history");
            } catch {
              setStatusTone("needs-retry");
              setMessage("Couldn't delete this expense right now.");
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <ScreenShell title="Expense Detail" subtitle="Loading expense...">
        <Text>Loading...</Text>
      </ScreenShell>
    );
  }

  if (!expense) {
    return (
      <ScreenShell title="Expense Detail" subtitle="Manage saved expense entries.">
        <Card title="Unavailable">
          <Text>{message ?? "Expense not found."}</Text>
          <PrimaryButton label="Back to history" onPress={() => router.replace("/expenses/history")} />
        </Card>
      </ScreenShell>
    );
  }

  const receiptNeedsLater = expense.receiptRequiredStatus === "add_later" || expense.receiptRequiredStatus === "none";

  return (
    <ScreenShell title="Expense Detail" subtitle="Review, edit, attach receipt later, or delete.">
      <Card title="Summary">
        <KeyValueRow label="Category" value={getExpenseCategoryLabel(expense.category)} />
        <KeyValueRow label="Expense type" value={expense.expenseType === "cash_manual" ? "Cash manual" : "Receipt upload"} />
        <KeyValueRow label="Amount" value={formatGBP(expense.amountGbp)} />
        <KeyValueRow label="Date" value={formatUkDate(expense.expenseDate)} />
        <KeyValueRow label="Payment" value={toTitle(expense.paymentMethod)} />
        <KeyValueRow label="Receipt" value={toReceiptLabel(expense.receiptRequiredStatus)} />
        <KeyValueRow label="Sync" value={toSyncLabel(expense.localSyncStatus)} />
        {expense.note ? <Text>{`Note: ${expense.note}`}</Text> : null}
        {expense.receiptUploadStatus ? <KeyValueRow label="Receipt upload" value={toUploadLabel(expense.receiptUploadStatus)} /> : null}
        {expense.receiptCloudObjectKey ? <Text>{`Cloud key: ${expense.receiptCloudObjectKey}`}</Text> : null}
        {expense.receiptUploadedAt ? <Text>{`Uploaded: ${formatUkDateTime(expense.receiptUploadedAt)}`}</Text> : null}
      </Card>

      <Card title="Edit">
        <Text>Category</Text>
        <View style={styles.row}>
          {EXPENSE_CATEGORY_OPTIONS.map((entry) => (
            <PrimaryButton
              key={entry.value}
              label={category === entry.value ? `${entry.label} (Selected)` : entry.label}
              onPress={() => setCategory(entry.value)}
            />
          ))}
        </View>

        <Text>Payment method</Text>
        <View style={styles.row}>
          {PAYMENT_METHODS.map((entry) => (
            <PrimaryButton
              key={entry}
              label={paymentMethod === entry ? `${toTitle(entry)} (Selected)` : toTitle(entry)}
              onPress={() => setPaymentMethod(entry)}
            />
          ))}
        </View>

        <Text>Amount (GBP)</Text>
        <TextInput value={amountInput} onChangeText={setAmountInput} keyboardType="decimal-pad" style={styles.input} />
        <Text>Date (YYYY-MM-DD)</Text>
        <TextInput value={dateInput} onChangeText={setDateInput} style={styles.input} />
        <Text>Optional note</Text>
        <TextInput value={noteInput} onChangeText={setNoteInput} style={styles.input} />

        {category === "fuel" ? (
          <View style={styles.fuelBlock}>
            <Text>Fuel litres</Text>
            <TextInput value={fuelLitresInput} onChangeText={setFuelLitresInput} keyboardType="decimal-pad" style={styles.input} />
            <Text>Fuel £/L</Text>
            <TextInput value={fuelPriceInput} onChangeText={setFuelPriceInput} keyboardType="decimal-pad" style={styles.input} />
          </View>
        ) : null}

        <PrimaryButton label="Save edits" onPress={onSaveEdits} />
      </Card>

      <Card title="Receipt">
        <Text>{`Current status: ${toReceiptLabel(expense.receiptRequiredStatus)}`}</Text>
        {receiptNeedsLater ? (
          <PrimaryButton label="Attach receipt now" onPress={onAttachReceiptLater} />
        ) : (
          <PrimaryButton label="Replace attached receipt" onPress={onAttachReceiptLater} />
        )}
      </Card>

      <Card title="Actions">
        <View style={styles.row}>
          {expense.localSyncStatus === "needs-retry" ? (
            <PrimaryButton label="Retry sync" onPress={onRetrySync} />
          ) : null}
          <PrimaryButton label="Delete expense" onPress={onDelete} />
          <PrimaryButton label="Back to history" onPress={() => router.replace("/expenses/history")} />
        </View>
        {message ? <Text style={toneStyle(statusTone)}>{message}</Text> : null}
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

function toTitle(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function toReceiptLabel(value: ExpenseDetailRecord["receiptRequiredStatus"]): string {
  if (value === "attached") {
    return "Receipt attached";
  }
  if (value === "add_later") {
    return "Add receipt later";
  }
  return "No receipt";
}

function toUploadLabel(value: NonNullable<ExpenseDetailRecord["receiptUploadStatus"]>): string {
  if (value === "queued") {
    return "Queued";
  }
  if (value === "uploading") {
    return "Uploading";
  }
  if (value === "uploaded") {
    return "Uploaded";
  }
  return "Failed";
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
  fuelBlock: {
    marginTop: 8,
  },
};
