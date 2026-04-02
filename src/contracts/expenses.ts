export type ExpenseCategory =
  | "mileage_vehicle"
  | "fuel"
  | "parking"
  | "tolls"
  | "licence_badge_compliance"
  | "radio_operator_fees"
  | "repairs_servicing_tyres_mot"
  | "insurance_vehicle_tax"
  | "cleaning_valeting"
  | "phone_data_internet"
  | "software_subscriptions"
  | "accounting_professional_fees"
  | "office_stationery_postage"
  | "protective_clothing_uniform"
  | "other";

export type ExpenseType = "upload_receipt" | "cash_manual";

export type VehicleExpenseMethod = "simplified_mileage" | "actual_vehicle_costs";

export type ExpensePaymentMethod = "cash" | "card" | "other";

export type ReceiptRequiredStatus = "attached" | "none" | "add_later";

export type ReceiptSourceType = "camera" | "file-upload";

export type LocalSyncStatus = "saved-local" | "syncing" | "synced" | "needs-retry";

export type UploadStatus = "queued" | "uploading" | "uploaded" | "failed";

export type SyncStatus = "pending" | "syncing" | "synced" | "failed";

export interface ExpenseInput {
  category: ExpenseCategory;
  expenseType: ExpenseType;
  paymentMethod: ExpensePaymentMethod;
  amountGbp: number;
  expenseDate: string;
  note?: string | null;
  receiptRequiredStatus: ReceiptRequiredStatus;
  receiptSourceType?: ReceiptSourceType | null;
  localReceiptUri?: string | null;
  mimeType?: string | null;
  originalFileName?: string | null;
  fileSizeBytes?: number | null;
  fuelLitres?: number | null;
  fuelPricePerLitre?: number | null;
  fuelTotal?: number | null;
  confirmedFuelPricePerLitre?: number | null;
}

export interface ExpenseRecord {
  id: string;
  userId: string;
  category: ExpenseCategory;
  expenseType: ExpenseType;
  paymentMethod: ExpensePaymentMethod;
  amountGbp: number;
  expenseDate: string;
  note: string | null;
  receiptRequiredStatus: ReceiptRequiredStatus;
  receiptFileId: string | null;
  fuelLitres: number | null;
  fuelPricePerLitre: number | null;
  fuelTotal: number | null;
  createdAt: string;
  updatedAt: string;
  localSyncStatus: LocalSyncStatus;
  cloudSyncedAt: string | null;
  localReceiptUri: string | null;
}

export interface ReceiptFileMetadata {
  fileId: string;
  expenseId: string;
  localUri: string;
  mimeType: string | null;
  originalFilename: string | null;
  fileSizeBytes: number | null;
  storageProvider: "s3" | "local-only";
  cloudObjectKey: string | null;
  uploadStatus: UploadStatus;
  uploadedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncJobRecord {
  id: string;
  entityType: "expense" | "receipt_file" | "privacy_import_file";
  entityId: string;
  syncStatus: SyncStatus;
  lastError: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseSaveResult {
  ok: boolean;
  expenseId: string;
  localSyncStatus: LocalSyncStatus;
  fuelPriceUpdated: boolean;
  warning?: string;
}

export const EXPENSE_CATEGORY_OPTIONS: Array<{ value: ExpenseCategory; label: string }> = [
  { value: "mileage_vehicle", label: "Mileage / Vehicle" },
  { value: "fuel", label: "Fuel" },
  { value: "parking", label: "Parking" },
  { value: "tolls", label: "Tolls" },
  { value: "licence_badge_compliance", label: "Licence / Badge / Compliance" },
  { value: "radio_operator_fees", label: "Radio / Operator Fees" },
  { value: "repairs_servicing_tyres_mot", label: "Repairs / Servicing / Tyres / MOT" },
  { value: "insurance_vehicle_tax", label: "Insurance / Vehicle Tax" },
  { value: "cleaning_valeting", label: "Cleaning / Valeting" },
  { value: "phone_data_internet", label: "Phone / Data / Internet" },
  { value: "software_subscriptions", label: "Software / Subscriptions" },
  { value: "accounting_professional_fees", label: "Accounting / Professional Fees" },
  { value: "office_stationery_postage", label: "Office / Stationery / Postage" },
  { value: "protective_clothing_uniform", label: "Protective Clothing / Uniform" },
  { value: "other", label: "Other" },
];

export function getExpenseCategoryLabel(category: ExpenseCategory): string {
  const match = EXPENSE_CATEGORY_OPTIONS.find((item) => item.value === category);
  return match?.label ?? category;
}
