export interface UploadStatusPanelPlaceholder {
  state: "empty" | "ready" | "imported";
  title: string;
  description: string;
  acceptedFileTypes: string[];
  latestImportSummary: string | null;
}

export const placeholderUploadStatusPanel: UploadStatusPanelPlaceholder = {
  state: "ready",
  title: "Import Status",
  description: "No live syncing. Imports are local-first and update decision intelligence when you add a file.",
  acceptedFileTypes: [".zip", ".csv"],
  latestImportSummary: "Last import: 2026-03-30, 412 trips normalized locally.",
};
