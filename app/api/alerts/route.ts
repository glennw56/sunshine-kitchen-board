import { runOverdueAlerts, boardSnapshot } from "@/lib/board";
import { cronSecret } from "@/lib/config";
import { fail, isResponse, json, requireActor } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  if (!(secret && cronSecret() && secret === cronSecret())) {
    const gate = await requireActor();
    if (isResponse(gate)) return gate;
  }
  try {
    const result = await runOverdueAlerts(secret ? "cron" : "board");
    const board = await boardSnapshot();
    return json({
      ok: true,
      ...result,
      overdue: board.cards.filter((card) => card.overdue).map((card) => card.ticket.id),
    });
  } catch (error) {
    return fail(error, 500);
  }
}
