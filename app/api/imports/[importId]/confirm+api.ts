import { ConfirmImportUploadRequest } from "../../../../src/contracts/cloudStorage";
import { markImportUploaded, markImportUploading, processUberImport } from "../../_lib/imports";

type Context = {
  params: Promise<{ importId: string }>;
};

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { importId } = await context.params;
    const body = (await request.json()) as Partial<ConfirmImportUploadRequest>;
    if (!importId || !body.userId || body.importId !== importId) {
      return Response.json({ error: "userId and matching importId are required." }, { status: 400 });
    }

    await markImportUploading({ userId: body.userId, importId });
    await markImportUploaded({ userId: body.userId, importId });

    const runInline = process.env.IMPORT_PROCESS_INLINE !== "false";
    if (runInline) {
      // Fire and forget keeps API fast while backend processing advances.
      void processUberImport({ userId: body.userId, importId });
    }

    return Response.json({
      ok: true,
      importId,
      processingStarted: runInline,
      trigger: runInline ? "inline" : "external-worker",
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to confirm upload.",
      },
      { status: 500 },
    );
  }
}
