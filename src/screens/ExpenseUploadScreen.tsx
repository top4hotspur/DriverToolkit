import * as DocumentPicker from "expo-document-picker";
import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { ExpenseType } from "../contracts/expenses";
import { initDatabase } from "../db/schema";
import { saveExpense } from "../state/expenseState";
import { formatGBP } from "../utils/format";
import { Card, PrimaryButton, ScreenShell } from "./ui";

export function ExpenseUploadScreen() {
  const [type, setType] = useState<ExpenseType>("fuel");
  const [amountInput, setAmountInput] = useState("");
  const [dateInput, setDateInput] = useState(new Date().toISOString().slice(0, 10));
  const [noteInput, setNoteInput] = useState("");
  const [fuelPriceInput, setFuelPriceInput] = useState("");
  const [receiptMode, setReceiptMode] = useState<"receipt-upload" | "upload-receipt-later" | "no-receipt">("receipt-upload");
  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    initDatabase().catch(() => {
      setMessage("Couldn't initialize local storage.");
    });
  }, []);

  const pickReceipt = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (!result.canceled && result.assets.length > 0) {
        setSelectedFile(result.assets[0]);
        setReceiptMode("receipt-upload");
      }
    } catch {
      setMessage("Couldn't open file picker.");
    }
  };

  const onSave = async () => {
    const amount = Number(amountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage("Enter a valid amount.");
      return;
    }

    const fuelPrice = Number(fuelPriceInput);
    const confirmedFuelPricePerLitre =
      type === "fuel" && Number.isFinite(fuelPrice) && fuelPrice > 0 ? fuelPrice : null;

    try {
      const saveResult = await saveExpense({
        type,
        amount,
        occurredOn: dateInput,
        note: noteInput,
        receiptInputMode: receiptMode,
        localReceiptUri: receiptMode === "receipt-upload" ? selectedFile?.uri ?? null : null,
        mimeType: selectedFile?.mimeType ?? null,
        originalFileName: selectedFile?.name ?? null,
        fileSizeBytes: selectedFile?.size ?? null,
        confirmedFuelPricePerLitre,
      });

      setMessage(
        saveResult.fuelPriceUpdated
          ? `Expense saved and fuel price updated (${formatGBP(confirmedFuelPricePerLitre ?? 0)}/L).`
          : "Expense saved locally.",
      );
      setAmountInput("");
      setNoteInput("");
      setFuelPriceInput("");
      setSelectedFile(null);
    } catch {
      setMessage("Couldn't save expense. Try again.");
    }
  };

  return (
    <ScreenShell title="Upload Expense" subtitle="Save expense details immediately and attach receipt files locally.">
      <Card title="Expense Type">
        <View style={styles.row}>
          <PrimaryButton label={type === "fuel" ? "Fuel (Selected)" : "Fuel"} onPress={() => setType("fuel")} />
          <PrimaryButton label={type === "other" ? "Other (Selected)" : "Other"} onPress={() => setType("other")} />
        </View>
      </Card>

      <Card title="Details">
        <Text>Amount (£)</Text>
        <TextInput value={amountInput} onChangeText={setAmountInput} keyboardType="decimal-pad" style={styles.input} />
        <Text>Date (YYYY-MM-DD)</Text>
        <TextInput value={dateInput} onChangeText={setDateInput} style={styles.input} />
        <Text>Optional note</Text>
        <TextInput value={noteInput} onChangeText={setNoteInput} style={styles.input} />
        {type === "fuel" ? (
          <>
            <Text>Fuel price per litre (manual confirm)</Text>
            <TextInput value={fuelPriceInput} onChangeText={setFuelPriceInput} keyboardType="decimal-pad" style={styles.input} />
          </>
        ) : null}
      </Card>

      <Card title="Receipt">
        <PrimaryButton label="Attach receipt file" onPress={pickReceipt} />
        {selectedFile ? <Text>{`Attached: ${selectedFile.name}`}</Text> : null}
        <View style={styles.row}>
          <PrimaryButton label={receiptMode === "upload-receipt-later" ? "Add later (Selected)" : "Add later"} onPress={() => setReceiptMode("upload-receipt-later")} />
          <PrimaryButton label={receiptMode === "no-receipt" ? "No receipt (Selected)" : "No receipt"} onPress={() => setReceiptMode("no-receipt")} />
        </View>
      </Card>

      <Card title="Save">
        <PrimaryButton label="Save expense" onPress={onSave} />
        {message ? <Text>{message}</Text> : null}
      </Card>
    </ScreenShell>
  );
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
