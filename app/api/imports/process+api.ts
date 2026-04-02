import { processUberImport } from "../_lib/imports";

export async function POST(request: Request): Promise<Response> {
  try {
    const authHeader = request.headers.get("authorization");
    const expectedToken = process.env.IMPORT_WORKER_TOKEN;
    if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = (await request.json()) as Partial<{ userId: string; importId: string }>;
    if (!body.userId || !body.importId) {
      return Response.json({ error: "userId and importId are required." }, { status: 400 });
    }

    await processUberImport({ userId: body.userId, importId: body.importId });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to process import.",
      },
      { status: 500 },
    );
  }
}
