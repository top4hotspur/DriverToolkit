import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ExpenseSaveApiRequest } from "../../../src/contracts/cloudStorage";
import { getDynamoClient, getExpensesTableName } from "../_lib/aws";

const ddbDoc = DynamoDBDocumentClient.from(getDynamoClient(), {
  marshallOptions: { removeUndefinedValues: true },
});

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as Partial<ExpenseSaveApiRequest>;

    if (
      !body.userId ||
      !body.expenseId ||
      typeof body.amount !== "number" ||
      !body.category ||
      !body.type ||
      !body.date ||
      !body.paymentMethod
    ) {
      return Response.json(
        { error: "Missing required expense fields for metadata save." },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const item = {
      userId: body.userId,
      expenseId: body.expenseId,
      amount: body.amount,
      category: body.category,
      expenseType: body.type,
      date: body.date,
      paymentMethod: body.paymentMethod,
      note: body.note ?? null,
      receiptRequiredStatus: body.receiptRequiredStatus ?? "none",
      receiptS3Key: body.receiptS3Key ?? null,
      syncStatus: body.syncStatus ?? "synced",
      fuelLitres: body.fuelLitres ?? null,
      fuelPricePerLitre: body.fuelPricePerLitre ?? null,
      fuelTotal: body.fuelTotal ?? null,
      createdAt: body.createdAt ?? now,
      updatedAt: body.updatedAt ?? now,
      cloudSavedAt: now,
    };

    await ddbDoc.send(
      new PutCommand({
        TableName: getExpensesTableName(),
        Item: item,
      }),
    );

    if (body.receiptFileMetadata?.fileId) {
      await ddbDoc.send(
        new PutCommand({
          TableName: getExpensesTableName(),
          Item: {
            userId: body.userId,
            expenseId: `RECEIPT#${body.receiptFileMetadata.fileId}`,
            expenseRefId: body.expenseId,
            mimeType: body.receiptFileMetadata.mimeType ?? null,
            originalFilename: body.receiptFileMetadata.originalFilename ?? null,
            fileSizeBytes: body.receiptFileMetadata.fileSizeBytes ?? null,
            receiptS3Key: body.receiptS3Key ?? null,
            entityType: "receipt_file",
            createdAt: body.createdAt ?? now,
            updatedAt: body.updatedAt ?? now,
            cloudSavedAt: now,
          },
        }),
      );
    }

    return Response.json({ ok: true, expenseId: body.expenseId });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to save expense metadata.",
      },
      { status: 500 },
    );
  }
}
