import { ExpenseFormInput, ExpenseSaveResult, SavedExpense } from "../contracts/expenses";
import { getDb } from "../db/client.native";
import { getVehicleCostSettings, saveVehicleCostSettings } from "./vehicleCostState.native";

const USER_ID = "local-user";

export async function saveExpense(input: ExpenseFormInput): Promise<ExpenseSaveResult> {
  const db = await getDb();
  const now = new Date().toISOString();
  const expenseId = `expense_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

  let receiptFileId: string | null = null;
  if (input.localReceiptUri) {
    receiptFileId = `receipt_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    await db.runAsync(
      `
        INSERT INTO receipt_files (
          id, expense_id, local_uri, mime_type, original_file_name, file_size_bytes,
          cloud_object_key, cloud_bucket, cloud_region, upload_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        receiptFileId,
        expenseId,
        input.localReceiptUri,
        input.mimeType ?? null,
        input.originalFileName ?? null,
        input.fileSizeBytes ?? null,
        null,
        null,
        null,
        "queued",
        now,
        now,
      ],
    );
  }

  await db.runAsync(
    `
      INSERT INTO expenses (
        id, user_id, category, amount, occurred_on, notes,
        receipt_source_type, local_receipt_uri, mime_type, original_file_name, file_size_bytes,
        sync_state, receipt_file_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      expenseId,
      USER_ID,
      input.type,
      input.amount,
      input.occurredOn,
      input.note ?? null,
      mapReceiptSourceType(input.receiptInputMode),
      input.localReceiptUri ?? null,
      input.mimeType ?? null,
      input.originalFileName ?? null,
      input.fileSizeBytes ?? null,
      "queued",
      receiptFileId,
      now,
    ],
  );

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
  const db = await getDb();
  const rows = await db.getAllAsync<SavedExpense & { receipt_source_type: string | null }>(
    `
      SELECT
        id,
        category as type,
        amount,
        occurred_on as occurredOn,
        notes as note,
        receipt_source_type as receiptInputMode,
        local_receipt_uri as localReceiptUri,
        created_at as createdAt
      FROM expenses
      ORDER BY created_at DESC
      LIMIT ?
    `,
    [limit],
  );

  return rows.map((row) => ({
    ...row,
    receiptInputMode: mapReceiptInputMode(row.receiptInputMode),
  }));
}

function mapReceiptSourceType(mode: ExpenseFormInput["receiptInputMode"]): string {
  if (mode === "receipt-upload") {
    return "file-upload";
  }
  if (mode === "cash-manual") {
    return "no-receipt";
  }
  if (mode === "upload-receipt-later") {
    return "upload-later";
  }
  return "no-receipt";
}

function mapReceiptInputMode(source: string | null): ExpenseFormInput["receiptInputMode"] {
  if (source === "file-upload" || source === "camera") {
    return "receipt-upload";
  }
  if (source === "upload-later") {
    return "upload-receipt-later";
  }
  return "no-receipt";
}
