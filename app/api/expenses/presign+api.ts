import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ExpensePresignRequest, ExpensePresignResponse } from "../../../src/contracts/cloudStorage";
import { buildExpenseReceiptObjectKey, getReceiptsBucket, getS3Client } from "../_lib/aws";

const URL_EXPIRY_SECONDS = 900;

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as Partial<ExpensePresignRequest>;

    if (!body.userId || !body.expenseId || !body.fileType) {
      return Response.json({ error: "userId, expenseId and fileType are required." }, { status: 400 });
    }

    const bucket = getReceiptsBucket();
    const objectKey = buildExpenseReceiptObjectKey({
      userId: body.userId,
      expenseId: body.expenseId,
      fileType: body.fileType,
    });

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: body.fileType,
    });

    const presignedUrl = await getSignedUrl(getS3Client(), command, {
      expiresIn: URL_EXPIRY_SECONDS,
    });

    const response: ExpensePresignResponse = {
      objectKey,
      contentType: body.fileType,
      expiresInSeconds: URL_EXPIRY_SECONDS,
      method: "PUT",
      presignedUrl,
    };

    return Response.json(response);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to create upload URL.",
      },
      { status: 500 },
    );
  }
}
