import { ensureReady, loadDb } from "@/lib/store";
import { recipeSlackText, verifySlackSignature } from "@/lib/slack";
import { chicagoDate, formatChicago } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text();
  const ok = verifySlackSignature(
    raw,
    request.headers.get("x-slack-request-timestamp"),
    request.headers.get("x-slack-signature"),
  );
  if (!ok) {
    return new Response("Invalid signature", { status: 401 });
  }
  const params = new URLSearchParams(raw);
  const text = (params.get("text") || "").trim().toLowerCase();
  await ensureReady();
  const db = loadDb();
  const today = chicagoDate();
  const tickets = db.tickets.filter((ticket) => ticket.serviceDate === today);
  const matched = text
    ? db.recipes.find(
        (recipe) =>
          recipe.id === text ||
          recipe.name.toLowerCase().includes(text) ||
          recipe.finishedSku.toLowerCase() === text,
      )
    : null;
  if (matched) {
    const ticket = tickets.find((row) => row.recipeId === matched.id) ?? null;
    return slack({
      response_type: "ephemeral",
      text: recipeSlackText(matched, ticket),
    });
  }
  const lines = tickets.map((ticket) => {
    const recipe = db.recipes.find((item) => item.id === ticket.recipeId);
    const name = recipe?.name ?? ticket.recipeId;
    return `• *${name}* — ${ticket.status}${ticket.assignee ? ` (${ticket.assignee})` : ""} — due ${formatChicago(ticket.dueAt)}`;
  });
  const body = [
    "*Today's kitchen tickets*",
    ...(lines.length ? lines : ["No tickets for today."]),
    "",
    "Read a recipe with `/recipe croissant` (or cookie, sourdough, or part of the name).",
    "Claim, start, and done stay on the phone board.",
  ].join("\n");
  return slack({ response_type: "ephemeral", text: body });
}

function slack(payload: { response_type: string; text: string }) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
