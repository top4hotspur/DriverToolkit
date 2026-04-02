import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";

export function getAwsRegion(): string {
  return process.env.AWS_REGION ?? process.env.EXPO_PUBLIC_AWS_REGION ?? "eu-west-1";
}

export function getReceiptsBucket(): string {
  return process.env.AWS_RECEIPTS_BUCKET ?? process.env.EXPO_PUBLIC_AWS_RECEIPTS_BUCKET ?? "driver-toolkit-receipts";
}

export function getImportsBucket(): string {
  return process.env.AWS_IMPORTS_BUCKET ?? process.env.EXPO_PUBLIC_AWS_IMPORTS_BUCKET ?? "driver-toolkit-imports";
}

export function getExpensesTableName(): string {
  return process.env.AWS_EXPENSES_TABLE ?? "DriverToolkitExpenses";
}

export function getImportsTableName(): string {
  return process.env.AWS_IMPORTS_TABLE ?? "DriverToolkitImports";
}

export function getS3Client(): S3Client {
  return new S3Client({ region: getAwsRegion() });
}

export function getDynamoClient(): DynamoDBClient {
  return new DynamoDBClient({ region: getAwsRegion() });
}

export function buildExpenseReceiptObjectKey(args: {
  userId: string;
  expenseId: string;
  fileType: string;
}): string {
  const extension = extensionFromMimeType(args.fileType);
  const userSegment = sanitizeSegment(args.userId);
  const expenseSegment = sanitizeSegment(args.expenseId);
  return `${userSegment}/expenses/${expenseSegment}.${extension}`;
}

export function buildUberImportObjectKey(args: {
  userId: string;
  importId: string;
  sourceFileName: string;
}): string {
  const userSegment = sanitizeSegment(args.userId);
  const importSegment = sanitizeSegment(args.importId);
  const fileSegment = sanitizeSegment(args.sourceFileName).replace(/-zip$/i, ".zip");
  return `${userSegment}/imports/uber/${importSegment}/${fileSegment.endsWith(".zip") ? fileSegment : `${fileSegment}.zip`}`;
}

function extensionFromMimeType(fileType: string): string {
  const normalized = fileType.toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) {
    return "jpg";
  }
  if (normalized.includes("png")) {
    return "png";
  }
  if (normalized.includes("heic")) {
    return "heic";
  }
  if (normalized.includes("webp")) {
    return "webp";
  }
  if (normalized.includes("pdf")) {
    return "pdf";
  }
  return "jpg";
}

function sanitizeSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, "-");
}
