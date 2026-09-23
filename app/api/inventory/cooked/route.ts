import { cookedMove, inventoryViews, readTestCookCount } from "@/lib/board";
import { fail, isResponse, json, requireActor } from "@/lib/api";
import { SQUARE_TEST_COOK } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const view = await inventoryViews();
    const square = await readTestCookCount().catch((error: unknown) => ({
      ok: false,
      quantity: null,
      error: error instanceof Error ? error.message : String(error),
    }));
    return json({
      ok: true,
      transport: view.transport,
      error: view.error,
      items: view.cooked,
      all: view.items,
      recipes: view.recipes,
      square: { ...square, ...SQUARE_TEST_COOK },
    });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(request: Request) {
  const gate = await requireActor();
  if (isResponse(gate)) return gate;
  try {
    const body = (await request.json()) as { sku?: string; qty?: number; mode?: "add" | "remove" | "pull" };
    if (!body.sku || !body.mode || typeof body.qty !== "number") return fail("sku, qty, and mode are required");
    if (body.mode !== "add" && body.mode !== "remove" && body.mode !== "pull") return fail("mode must be add, remove, or pull");
    const result = await cookedMove(body.sku, body.qty, body.mode, gate.actor);
    return json({ ok: true, ...result });
  } catch (error) {
    return fail(error);
  }
}
