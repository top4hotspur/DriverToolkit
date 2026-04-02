import { getImportStatus } from "../../_lib/imports";

type Context = {
  params: Promise<{ importId: string }>;
};

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const { importId } = await context.params;
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    if (!importId || !userId) {
      return Response.json({ error: "importId and userId are required." }, { status: 400 });
    }

    const status = await getImportStatus({ userId, importId });
    if (!status) {
      return Response.json({ error: "Import session not found." }, { status: 404 });
    }

    return Response.json(status);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch import status.",
      },
      { status: 500 },
    );
  }
}
