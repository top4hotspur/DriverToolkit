import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";
import {
  ExpenseCategory,
  ExpenseInput,
  ExpensePaymentMethod,
  EXPENSE_CATEGORY_OPTIONS,
  LocalSyncStatus,
  ReceiptRequiredStatus,
  getExpenseCategoryLabel,
} from "../contracts/expenses";
import { initDatabase } from "../db/schema";
import { getExpenseSyncStatus, retryExpenseSync, saveExpense } from "../state/expenseState";
import { formatGBP, formatUkDate } from "../utils/format";
import { Card, PrimaryButton, ScreenShell } from "./ui";

const PAYMENT_METHODS: ExpensePaymentMethod[] = ["card", "cash", "other"];

export function ExpenseUploadScreen() {
  const router = useRouter();
  const [category, setCategory] = useState<ExpenseCategory>("fuel");
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>("card");
  const [amountInput, setAmountInput] = useState("");
  const [dateInput, setDateInput] = useState(new Date().toISOString().slice(0, 10));
  const [noteInput, setNoteInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [receiptRequiredStatus, setReceiptRequiredStatus] = useState<ReceiptRequiredStatus>("attached");
  const [fuelLitresInput, setFuelLitresInput] = useState("");
  const [fuelPriceInput, setFuelPriceInput] = useState("");
  const [derivedFuelMessage, setDerivedFuelMessage] = useState<string | null>(null);
  const [confirmedFuelPricePerLitre, setConfirmedFuelPricePerLitre] = useState<number | null>(null);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<LocalSyncStatus | "info">("info");
  const [lastExpenseId, setLastExpenseId] = useState<string | null>(null);

  useEffect(() => {
    initDatabase().catch(() => {
      setStatusLabel("Couldn't initialize local storage.");
      setStatusTone("needs-retry");
    });
  }, []);

  const amount = useMemo(() => Number(amountInput), [amountInput]);
  const fuelLitres = useMemo(() => Number(fuelLitresInput), [fuelLitresInput]);
  const fuelPrice = useMemo(() => Number(fuelPriceInput), [fuelPriceInput]);

  const pickReceipt = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (!result.canceled && result.assets.length > 0) {
        setSelectedFile(result.assets[0]);
        setReceiptRequiredStatus("attached");
        setStatusLabel(null);
      }
    } catch {
      setStatusLabel("Couldn't open file picker.");
      setStatusTone("needs-retry");
    }
  };

  const deriveFuelValues = () => {
    if (category !== "fuel") {
      return;
    }

    const total = Number.isFinite(amount) && amount > 0 ? amount : null;
    const litres = Number.isFinite(fuelLitres) && fuelLitres > 0 ? fuelLitres : null;
    const price = Number.isFinite(fuelPrice) && fuelPrice > 0 ? fuelPrice : null;

    const provided = [total, litres, price].filter((value) => value !== null).length;
    if (provided < 2) {
      setDerivedFuelMessage("Enter at least two fuel values to derive the third.");
      setConfirmedFuelPricePerLitre(null);
      return;
    }

    if (!price && total && litres) {
      const derived = total / litres;
      setFuelPriceInput(derived.toFixed(3));
      setDerivedFuelMessage(`Derived fuel price: ${formatGBP(derived)}/L. Confirm before saving.`);
      setConfirmedFuelPricePerLitre(null);
      return;
    }

    if (!litres && total && price) {
      const derived = total / price;
      setFuelLitresInput(derived.toFixed(3));
      setDerivedFuelMessage(`Derived litres: ${derived.toFixed(3)}L. Confirm before saving.`);
      setConfirmedFuelPricePerLitre(null);
      return;
    }

    if (!total && litres && price) {
      const derived = litres * price;
      setAmountInput(derived.toFixed(2));
      setDerivedFuelMessage(`Derived total paid: ${formatGBP(derived)}. Confirm before saving.`);
      setConfirmedFuelPricePerLitre(null);
      return;
    }

    setDerivedFuelMessage("Fuel values are complete. Confirm fuel price before saving.");
    setConfirmedFuelPricePerLitre(null);
  };

  const confirmFuelValues = () => {
    const parsedPrice = Number(fuelPriceInput);
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      setStatusLabel("Enter a valid fuel price per litre before confirming.");
      setStatusTone("needs-retry");
      return;
    }
    setConfirmedFuelPricePerLitre(parsedPrice);
    setStatusLabel(`Fuel price confirmed at ${formatGBP(parsedPrice)}/L.`);
    setStatusTone("info");
  };

  const onSave = async () => {
    const parsedAmount = Number(amountInput);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setStatusLabel("Enter a valid total amount.");
      setStatusTone("needs-retry");
      return;
    }

    if (!dateInput.trim()) {
      setStatusLabel("Enter an expense date.");
      setStatusTone("needs-retry");
      return;
    }

    if (receiptRequiredStatus === "attached" && !selectedFile) {
      setStatusLabel("Attach a receipt file or choose Add later / No receipt.");
      setStatusTone("needs-retry");
      return;
    }

    if (category === "fuel") {
      if (!confirmedFuelPricePerLitre) {
        setStatusLabel("Confirm fuel values before saving this fuel expense.");
        setStatusTone("needs-retry");
        return;
      }

      const parsedLitres = Number(fuelLitresInput);
      if (!Number.isFinite(parsedLitres) || parsedLitres <= 0) {
        setStatusLabel("Enter litres for fuel expense.");
        setStatusTone("needs-retry");
        return;
      }
    }

    setStatusLabel("Syncing...");
    setStatusTone("syncing");

    const payload: ExpenseInput = {
      category,
      expenseType: "upload_receipt",
      paymentMethod,
      amountGbp: parsedAmount,
      expenseDate: dateInput,
      note: noteInput.trim() || null,
      receiptRequiredStatus,
      receiptSourceType: receiptRequiredStatus === "attached" ? "file-upload" : null,
      localReceiptUri: receiptRequiredStatus === "attached" ? selectedFile?.uri ?? null : null,
      mimeType: selectedFile?.mimeType ?? null,
      originalFileName: selectedFile?.name ?? null,
      fileSizeBytes: selectedFile?.size ?? null,
      fuelLitres: category === "fuel" ? Number(fuelLitresInput) : null,
      fuelPricePerLitre: category === "fuel" ? Number(fuelPriceInput) : null,
      fuelTotal: category === "fuel" ? parsedAmount : null,
      confirmedFuelPricePerLitre: category === "fuel" ? confirmedFuelPricePerLitre : null,
    };

    try {
      const result = await saveExpense(payload);
      setLastExpenseId(result.expenseId);
      setStatusTone(result.localSyncStatus);
      setStatusLabel(buildSaveMessage(result.localSyncStatus, result.fuelPriceUpdated));

      setAmountInput("");
      setNoteInput("");
      setFuelLitresInput("");
      setFuelPriceInput("");
      setDerivedFuelMessage(null);
      setConfirmedFuelPricePerLitre(null);
      setSelectedFile(null);
      setReceiptRequiredStatus("attached");
    } catch {
      setStatusTone("needs-retry");
      setStatusLabel("Save failed. Try again.");
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
      setStatusLabel(buildSaveMessage(syncStatus, false));
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
      setStatusLabel(buildSaveMessage(state, false));
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
    <ScreenShell title="Upload Expense" subtitle="Save now locally, then sync receipt + metadata to cloud when available.">
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

      <Card title="Payment Method">
        <View style={styles.row}>
          {PAYMENT_METHODS.map((entry) => (
            <PrimaryButton
              key={entry}
              label={paymentMethod === entry ? `${toTitle(entry)} (Selected)` : toTitle(entry)}
              onPress={() => setPaymentMethod(entry)}
            />
          ))}
        </View>
      </Card>

      <Card title="Details">
        <Text>Total amount paid (GBP)</Text>
        <TextInput value={amountInput} onChangeText={setAmountInput} keyboardType="decimal-pad" style={styles.input} />
        <Text>Date (YYYY-MM-DD)</Text>
        <TextInput value={dateInput} onChangeText={setDateInput} style={styles.input} />
        <Text>{`Display: ${formatUkDate(dateInput)}`}</Text>
        <Text>Optional note</Text>
        <TextInput value={noteInput} onChangeText={setNoteInput} style={styles.input} />
      </Card>

      {category === "fuel" ? (
        <Card title="Fuel Details">
          <Text>Litres</Text>
          <TextInput value={fuelLitresInput} onChangeText={setFuelLitresInput} keyboardType="decimal-pad" style={styles.input} />
          <Text>Price per litre (GBP)</Text>
          <TextInput value={fuelPriceInput} onChangeText={setFuelPriceInput} keyboardType="decimal-pad" style={styles.input} />
          <View style={styles.row}>
            <PrimaryButton label="Derive missing field" onPress={deriveFuelValues} />
            <PrimaryButton label="Confirm fuel values" onPress={confirmFuelValues} />
          </View>
          {derivedFuelMessage ? <Text>{derivedFuelMessage}</Text> : null}
          {confirmedFuelPricePerLitre ? <Text>{`Confirmed fuel £/L: ${formatGBP(confirmedFuelPricePerLitre)}`}</Text> : null}
        </Card>
      ) : null}

      <Card title="Receipt Attachment">
        <PrimaryButton label="Attach receipt file" onPress={pickReceipt} />
        {selectedFile ? <Text>{`Attached: ${selectedFile.name}`}</Text> : <Text>No receipt file selected.</Text>}
        <View style={styles.row}>
          <PrimaryButton
            label={receiptRequiredStatus === "attached" ? "Receipt attached (Selected)" : "Receipt attached"}
            onPress={() => setReceiptRequiredStatus("attached")}
          />
          <PrimaryButton
            label={receiptRequiredStatus === "add_later" ? "Add receipt later (Selected)" : "Add receipt later"}
            onPress={() => setReceiptRequiredStatus("add_later")}
          />
          <PrimaryButton
            label={receiptRequiredStatus === "none" ? "No receipt (Selected)" : "No receipt"}
            onPress={() => setReceiptRequiredStatus("none")}
          />
        </View>
      </Card>

      <Card title="Save">
        <PrimaryButton label="Save expense" onPress={onSave} />
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

function buildSaveMessage(sync: LocalSyncStatus, fuelPriceUpdated: boolean): string {
  if (sync === "synced") {
    return fuelPriceUpdated
      ? "Synced to cloud. Fuel £/L updated in Settings."
      : "Synced to cloud.";
  }

  if (sync === "syncing") {
    return "Syncing...";
  }

  if (sync === "needs-retry") {
    return fuelPriceUpdated
      ? "Saved locally. Needs retry for cloud sync. Fuel £/L updated."
      : "Saved locally. Needs retry for cloud sync.";
  }

  return fuelPriceUpdated ? "Saved locally. Fuel £/L updated in Settings." : "Saved locally.";
}

function toTitle(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function toneStyle(tone: LocalSyncStatus | "info") {
  if (tone === "synced") {
    return { color: "#23593f", marginTop: 8 };
  }
  if (tone === "needs-retry") {
    return { color: "#7a382f", marginTop: 8 };
  }
  if (tone === "syncing") {
    return { color: "#415049", marginTop: 8 };
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



