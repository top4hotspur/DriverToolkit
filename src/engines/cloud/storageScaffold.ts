import { PresignedUploadIntent } from "../../contracts/cloudStorage";

// Scaffold only: this keeps the app local-first today while defining the cheap cloud path.
export async function buildReceiptUploadIntent(args: {
  userId: string;
  receiptFileId: string;
  mimeType: string;
  originalFileName: string;
}): Promise<PresignedUploadIntent> {
  const objectKey = `receipts/${args.userId}/${args.receiptFileId}-${sanitize(args.originalFileName)}`;
  return {
    objectKey,
    contentType: args.mimeType,
    expiresInSeconds: 900,
    method: "PUT",
    presignedUrl: `https://example-presigned-upload.invalid/${objectKey}`,
  };
}

export async function buildPrivacyZipUploadIntent(args: {
  userId: string;
  provider: "uber" | "bolt" | "lyft";
  importFileId: string;
  fileName: string;
}): Promise<PresignedUploadIntent> {
  const objectKey = `privacy-exports/${args.userId}/${args.provider}/${args.importFileId}-${sanitize(args.fileName)}`;
  return {
    objectKey,
    contentType: "application/zip",
    expiresInSeconds: 900,
    method: "PUT",
    presignedUrl: `https://example-presigned-upload.invalid/${objectKey}`,
  };
}

function sanitize(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
