import { ExpenseInput, ExpenseRecord, ExpenseSaveResult, LocalSyncStatus, ReceiptFileMetadata } from "../contracts/expenses";
import { getDb } from "../db/client.native";
import { canSyncToCloud, syncExpenseMetadataToCloud, uploadReceiptToCloud } from "../engines/cloud/expenseSync";
import { getVehicleCostSettings, saveVehicleCostSettings } from "./vehicleCostState.native";

const USER_ID = "local-user";

export async function saveExpense(input: ExpenseInput): Promise<ExpenseSaveResult> {
  const db = await getDb();
  const now = new Date().toISOString();
  const expenseId = `expense_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

  const receiptRequiredStatus = input.receiptRequiredStatus;
  const receiptSourceType = input.receiptSourceType ?? (receiptRequiredStatus === "attached" ? "file-upload" : null);

  let receiptFileId: string | null = null;

  if (receiptRequiredStatus === "attached" && input.localReceiptUri) {
    receiptFileId = `receipt_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    await db.runAsync(
      `
        INSERT INTO receipt_files (
          id, expense_id, local_uri, mime_type, original_file_name, file_size_bytes,
          storage_provider, cloud_object_key, cloud_bucket, cloud_region, upload_status, uploaded_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        receiptFileId,
        expenseId,
        input.localReceiptUri,
        input.mimeType ?? null,
        input.originalFileName ?? null,
        input.fileSizeBytes ?? null,
        "s3",
        null,
        null,
        null,
        "queued",
        null,
        now,
        now,
      ],
    );
  }

  await db.runAsync(
    `
      INSERT INTO expenses (
        id, user_id, category, expense_type, payment_method, amount, occurred_on, notes,
        receipt_required_status, receipt_source_type, local_receipt_uri,
        mime_type, original_file_name, file_size_bytes,
        fuel_litres, fuel_price_per_litre, fuel_total,
        local_sync_status, cloud_synced_at, sync_state, receipt_file_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      expenseId,
      USER_ID,
      input.category,
      input.expenseType,
      input.paymentMethod,
      input.amountGbp,
      input.expenseDate,
      input.note ?? null,
      receiptRequiredStatus,
      receiptSourceType,
      input.localReceiptUri ?? null,
      input.mimeType ?? null,
      input.originalFileName ?? null,
      input.fileSizeBytes ?? null,
      input.fuelLitres ?? null,
      input.confirmedFuelPricePerLitre ?? input.fuelPricePerLitre ?? null,
      input.fuelTotal ?? input.amountGbp,
      "saved-local",
      null,
      "queued",
      receiptFileId,
      now,
      now,
    ],
  );

  await upsertSyncJob({
    entityType: "expense",
    entityId: expenseId,
    syncStatus: "pending",
    lastError: null,
    retryCount: 0,
    nowIso: now,
  });

  let fuelPriceUpdated = false;
  const confirmedFuelPrice = input.confirmedFuelPricePerLitre ?? input.fuelPricePerLitre ?? null;
  if (input.category === "fuel" && typeof confirmedFuelPrice === "number" && confirmedFuelPrice > 0) {
    const current = await getVehicleCostSettings();
    await saveVehicleCostSettings({
      ...current,
      fuelPricePerLitre: confirmedFuelPrice,
    });
    fuelPriceUpdated = true;
  }

  // Fire-and-forget sync so the UX confirms local save immediately.
  void syncExpenseToCloud(expenseId);

  return {
    ok: true,
    expenseId,
    fuelPriceUpdated,
    localSyncStatus: "saved-local",
    warning: "Saved locally first. Cloud sync will continue in the background.",
  };
}

export async function retryExpenseSync(expenseId: string): Promise<LocalSyncStatus> {
  return syncExpenseToCloud(expenseId);
}

export async function getExpenseSyncStatus(expenseId: string): Promise<LocalSyncStatus | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ localSyncStatus: LocalSyncStatus }>(
    `
      SELECT local_sync_status as localSyncStatus
      FROM expenses
      WHERE id = ?
      LIMIT 1
    `,
    [expenseId],
  );
  return row?.localSyncStatus ?? null;
}

export async function listRecentExpenses(limit = 20): Promise<ExpenseRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ExpenseRecord>(
    `
      SELECT
        id,
        user_id as userId,
        category as category,
        COALESCE(expense_type, 'upload_receipt') as expenseType,
        payment_method as paymentMethod,
        amount as amountGbp,
        occurred_on as expenseDate,
        notes as note,
        receipt_required_status as receiptRequiredStatus,
        receipt_file_id as receiptFileId,
        fuel_litres as fuelLitres,
        fuel_price_per_litre as fuelPricePerLitre,
        fuel_total as fuelTotal,
        created_at as createdAt,
        updated_at as updatedAt,
        local_sync_status as localSyncStatus,
        cloud_synced_at as cloudSyncedAt,
        local_receipt_uri as localReceiptUri
      FROM expenses
      ORDER BY created_at DESC
      LIMIT ?
    `,
    [limit],
  );

  return rows;
}

async function syncExpenseToCloud(expenseId: string): Promise<LocalSyncStatus> {
  const db = await getDb();
  const now = new Date().toISOString();

  await db.runAsync(
    `
      UPDATE expenses
      SET local_sync_status = ?, sync_state = ?, updated_at = ?
      WHERE id = ?
    `,
    ["syncing", "syncing", now, expenseId],
  );

  await upsertSyncJob({
    entityType: "expense",
    entityId: expenseId,
    syncStatus: "syncing",
    lastError: null,
    retryCountDelta: 0,
    nowIso: now,
  });

  const expense = await db.getFirstAsync<ExpenseRecord>(
    `
      SELECT
        id,
        user_id as userId,
        category as category,
        COALESCE(expense_type, 'upload_receipt') as expenseType,
        payment_method as paymentMethod,
        amount as amountGbp,
        occurred_on as expenseDate,
        notes as note,
        receipt_required_status as receiptRequiredStatus,
        receipt_file_id as receiptFileId,
        fuel_litres as fuelLitres,
        fuel_price_per_litre as fuelPricePerLitre,
        fuel_total as fuelTotal,
        created_at as createdAt,
        updated_at as updatedAt,
        local_sync_status as localSyncStatus,
        cloud_synced_at as cloudSyncedAt,
        local_receipt_uri as localReceiptUri
      FROM expenses
      WHERE id = ?
      LIMIT 1
    `,
    [expenseId],
  );

  if (!expense) {
    return failSync(expenseId, "Expense not found for sync.");
  }

  if (!canSyncToCloud()) {
    return failSync(expenseId, "Cloud sync endpoint is not configured.");
  }

  const receipt = expense.receiptFileId
    ? await db.getFirstAsync<ReceiptFileMetadata>(
        `
          SELECT
            id as fileId,
            expense_id as expenseId,
            local_uri as localUri,
            mime_type as mimeType,
            original_file_name as originalFilename,
            file_size_bytes as fileSizeBytes,
            storage_provider as storageProvider,
            cloud_object_key as cloudObjectKey,
            upload_status as uploadStatus,
            uploaded_at as uploadedAt,
            created_at as createdAt,
            updated_at as updatedAt
          FROM receipt_files
          WHERE id = ?
          LIMIT 1
        `,
        [expense.receiptFileId],
      )
    : null;

  let syncedReceipt = receipt;

  if (receipt && receipt.localUri && (receipt.uploadStatus !== "uploaded" || !receipt.cloudObjectKey)) {
    await db.runAsync(
      `
        UPDATE receipt_files
        SET upload_status = ?, updated_at = ?
        WHERE id = ?
      `,
      ["uploading", now, receipt.fileId],
    );

    const upload = await uploadReceiptToCloud({
      userId: expense.userId,
      file: {
        expenseId: expense.id,
        receiptFileId: receipt.fileId,
        localUri: receipt.localUri,
        mimeType: receipt.mimeType,
        originalFileName: receipt.originalFilename,
      },
    });

    if (!upload.ok) {
      await db.runAsync(
        `
          UPDATE receipt_files
          SET upload_status = ?, updated_at = ?
          WHERE id = ?
        `,
        ["failed", new Date().toISOString(), receipt.fileId],
      );
      return failSync(expenseId, upload.error ?? "Receipt upload failed.");
    }

    await db.runAsync(
      `
        UPDATE receipt_files
        SET upload_status = ?, cloud_object_key = ?, uploaded_at = ?, updated_at = ?
        WHERE id = ?
      `,
      ["uploaded", upload.objectKey ?? null, now, now, receipt.fileId],
    );

    syncedReceipt = {
      ...receipt,
      cloudObjectKey: upload.objectKey ?? null,
      uploadStatus: "uploaded",
      uploadedAt: now,
      updatedAt: now,
    };
  }

  const metadataSync = await syncExpenseMetadataToCloud({
    expense: {
      expenseId: expense.id,
      userId: expense.userId,
      category: expense.category,
      expenseType: expense.expenseType,
      paymentMethod: expense.paymentMethod,
      amountGbp: expense.amountGbp,
      expenseDate: expense.expenseDate,
      note: expense.note,
      receiptRequiredStatus: expense.receiptRequiredStatus,
      receiptFileId: expense.receiptFileId,
      fuelLitres: expense.fuelLitres,
      fuelPricePerLitre: expense.fuelPricePerLitre,
      fuelTotal: expense.fuelTotal,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
    },
    receipt: syncedReceipt
      ? {
          fileId: syncedReceipt.fileId,
          mimeType: syncedReceipt.mimeType,
          originalFilename: syncedReceipt.originalFilename,
          fileSizeBytes: syncedReceipt.fileSizeBytes,
          storageProvider: "s3",
          cloudObjectKey: syncedReceipt.cloudObjectKey,
          uploadStatus: syncedReceipt.uploadStatus,
          uploadedAt: syncedReceipt.uploadedAt,
        }
      : null,
  });

  if (!metadataSync.ok) {
    return failSync(expenseId, metadataSync.error ?? "Cloud metadata sync failed.");
  }

  await db.runAsync(
    `
      UPDATE expenses
      SET local_sync_status = ?, sync_state = ?, cloud_synced_at = ?, updated_at = ?
      WHERE id = ?
    `,
    ["synced", "uploaded", now, now, expenseId],
  );

  await upsertSyncJob({
    entityType: "expense",
    entityId: expenseId,
    syncStatus: "synced",
    lastError: null,
    retryCountDelta: 0,
    nowIso: now,
  });

  return "synced";
}

async function failSync(expenseId: string, message: string): Promise<LocalSyncStatus> {
  const db = await getDb();
  const now = new Date().toISOString();

  await db.runAsync(
    `
      UPDATE expenses
      SET local_sync_status = ?, sync_state = ?, updated_at = ?
      WHERE id = ?
    `,
    ["needs-retry", "failed", now, expenseId],
  );

  await upsertSyncJob({
    entityType: "expense",
    entityId: expenseId,
    syncStatus: "failed",
    lastError: message,
    retryCountDelta: 1,
    nowIso: now,
  });

  return "needs-retry";
}

async function upsertSyncJob(args: {
  entityType: "expense" | "receipt_file" | "privacy_import_file";
  entityId: string;
  syncStatus: "pending" | "syncing" | "synced" | "failed";
  lastError: string | null;
  retryCount?: number;
  retryCountDelta?: number;
  nowIso: string;
}): Promise<void> {
  const db = await getDb();
  const id = `${args.entityType}_${args.entityId}`;
  const existing = await db.getFirstAsync<{ retry_count: number }>(
    `SELECT retry_count FROM sync_jobs WHERE id = ? LIMIT 1`,
    [id],
  );

  const nextRetryCount = typeof args.retryCount === "number"
    ? args.retryCount
    : Math.max(0, (existing?.retry_count ?? 0) + (args.retryCountDelta ?? 0));

  if (existing) {
    await db.runAsync(
      `
        UPDATE sync_jobs
        SET sync_status = ?, last_error = ?, retry_count = ?, updated_at = ?
        WHERE id = ?
      `,
      [args.syncStatus, args.lastError, nextRetryCount, args.nowIso, id],
    );
    return;
  }

  await db.runAsync(
    `
      INSERT INTO sync_jobs (
        id, entity_type, entity_id, sync_status, last_error, retry_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [id, args.entityType, args.entityId, args.syncStatus, args.lastError, nextRetryCount, args.nowIso, args.nowIso],
  );
}

