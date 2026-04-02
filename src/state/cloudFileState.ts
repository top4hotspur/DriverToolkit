const queuedPrivacyFiles: Array<{
  provider: "uber" | "bolt" | "lyft";
  sourceFileName: string;
  localUri: string | null;
  fileSizeBytes: number | null;
  importedAt: string;
}> = [];

export async function queuePrivacyImportFileMetadata(args: {
  provider: "uber" | "bolt" | "lyft";
  sourceFileName: string;
  localUri: string | null;
  fileSizeBytes: number | null;
  importedAt: string;
}): Promise<void> {
  queuedPrivacyFiles.unshift(args);
}
