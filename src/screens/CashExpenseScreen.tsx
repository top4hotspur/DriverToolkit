import { useEffect, useState } from "react";
import { Text, TextInput } from "react-native";
import { initDatabase } from "../db/schema";
import { saveExpense } from "../state/expenseState";
import { Card, PrimaryButton, ScreenShell } from "./ui";

export function CashExpenseScreen() {
  const [type, setType] = useState<"fuel" | "other">("other");
  const [amountInput, setAmountInput] = useState("");
  const [dateInput, setDateInput] = useState(new Date().toISOString().slice(0, 10));
  const [noteInput, setNoteInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    initDatabase().catch(() => {
      setMessage("Couldn't initialize local storage.");
    });
  }, []);

  const onSave = async () => {
    const amount = Number(amountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage("Enter a valid amount.");
      return;
    }

    try {
      await saveExpense({
        type,
        amount,
        occurredOn: dateInput,
        note: noteInput,
        receiptInputMode: "cash-manual",
        localReceiptUri: null,
      });
      setMessage("Cash expense saved locally.");
      setAmountInput("");
      setNoteInput("");
    } catch {
      setMessage("Couldn't save cash expense. Try again.");
    }
  };

  return (
    <ScreenShell title="Add Cash Expense" subtitle="Record a cash expense now and attach a receipt later if needed.">
      <Card title="Expense Type">
        <PrimaryButton label={type === "fuel" ? "Fuel (Selected)" : "Fuel"} onPress={() => setType("fuel")} />
        <PrimaryButton label={type === "other" ? "Other (Selected)" : "Other"} onPress={() => setType("other")} />
      </Card>

      <Card title="Details">
        <Text>Amount (£)</Text>
        <TextInput value={amountInput} onChangeText={setAmountInput} keyboardType="decimal-pad" style={styles.input} />
        <Text>Date (YYYY-MM-DD)</Text>
        <TextInput value={dateInput} onChangeText={setDateInput} style={styles.input} />
        <Text>Optional note</Text>
        <TextInput value={noteInput} onChangeText={setNoteInput} style={styles.input} />
      </Card>

      <Card title="Save">
        <PrimaryButton label="Save cash expense" onPress={onSave} />
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
};
