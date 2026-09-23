import { adjustRaw, inventoryViews } from "@/lib/board";
import { fail, isResponse, json, requireActor } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const view = await inventoryViews();
    return json({ ok: true, ...view, items: view.raw });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(request: Request) {
  const gate = await requireActor();
  if (isResponse(gate)) return gate;
  try {
    const body = (await request.json()) as { sku?: string; delta?: number };
    if (!body.sku || typeof body.delta !== "number") return fail("sku and delta are required");
    const applied = await adjustRaw(body.sku, body.delta, gate.actor);
    return json({ ok: true, applied });
  } catch (error) {
    return fail(error);
  }
}
