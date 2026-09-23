import { linkIngredient } from "@/lib/board";
import { fail, isResponse, json, requireActor } from "@/lib/api";

export async function POST(request: Request) {
  const gate = await requireActor();
  if (isResponse(gate)) return gate;
  try {
    const body = (await request.json()) as { recipeId?: string; ingredientId?: string; sku?: string };
    if (!body.recipeId || !body.ingredientId || !body.sku) return fail("recipeId, ingredientId, and sku are required");
    await linkIngredient(body.recipeId, body.ingredientId, body.sku, gate.actor);
    return json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
