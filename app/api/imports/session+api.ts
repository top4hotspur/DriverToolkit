import { CreateImportSessionRequest, CreateImportSessionResponse } from "../../../src/contracts/cloudStorage";
import { createUberImportSession } from "../_lib/imports";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as Partial<CreateImportSessionRequest>;
    if (!body.userId || !body.sourceFileName || body.provider !== "uber") {
      return Response.json(
        { error: "userId, provider=uber, and sourceFileName are required." },
        { status: 400 },
      );
    }

    const session = await createUberImportSession({
      userId: body.userId,
      sourceFileName: body.sourceFileName,
      mimeType: body.mimeType ?? "application/zip",
    });

    const response: CreateImportSessionResponse = {
      importId: session.importId,
      objectKey: session.objectKey,
      uploadUrl: session.uploadUrl,
      expiresInSeconds: session.expiresInSeconds,
      stage: session.stage,
    };

    return Response.json(response);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to create import session.",
      },
      { status: 500 },
    );
  }
}
