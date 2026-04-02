import { getDb } from "../db/client.native";

export async function queuePrivacyImportFileMetadata(args: {
  provider: "uber" | "bolt" | "lyft";
  sourceFileName: string;
  localUri: string | null;
  fileSizeBytes: number | null;
  importedAt: string;
}): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `
      INSERT INTO privacy_import_files (
        id, provider, source_file_name, local_uri, file_size_bytes,
        cloud_object_key, cloud_bucket, cloud_region, upload_status,
        imported_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      `privacy_file_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      args.provider,
      args.sourceFileName,
      args.localUri,
      args.fileSizeBytes,
      null,
      null,
      null,
      "queued",
      args.importedAt,
      now,
      now,
    ],
  );
}
