import { ConfidenceLevel, EarningsLeakType } from "../domain/types";

export type ReceiptSourceType = "camera" | "file-upload";

export interface ReceiptAttachmentContract {
  receiptSourceType: ReceiptSourceType;
  localReceiptUri: string;
  mimeType: string;
  originalFileName: string | null;
  fileSizeBytes: number | null;
}

export interface ExpenseAdminRecordContract {
  id: string;
  category: "expense" | "receipt" | "tax-note";
  title: string;
  amount: number | null;
  occurredAt: string;
  receipt: ReceiptAttachmentContract | null;
  notes: string | null;
  syncState: "local-only";
}

export interface EarningsLeakContract {
  type: EarningsLeakType;
  estimatedValue: number;
  explanation: string;
  confidence: ConfidenceLevel;
  claimHelperText: string;
}

export interface RecoverySummaryContract {
  totalEstimatedValue: number;
  openItems: number;
  issueBreakdown: Array<{
    type: EarningsLeakType;
    count: number;
    estimatedValue: number;
  }>;
  leaks: EarningsLeakContract[];
}

export interface ReportAdminSectionContract {
  adminSummary: string;
  receiptInputModes: ReceiptSourceType[];
  records: ExpenseAdminRecordContract[];
}
