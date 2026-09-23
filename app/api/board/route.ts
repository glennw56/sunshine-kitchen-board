import { boardSnapshot, claimTicket, completeTicket, nudgeTicket, retrySquare, startTicket } from "@/lib/board";
import { fail, isResponse, json, requireActor } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json({ ok: true, ...(await boardSnapshot()) });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(request: Request) {
  const gate = await requireActor();
  if (isResponse(gate)) return gate;
  try {
    const body = (await request.json()) as {
      action?: string;
      ticketId?: string;
      ackShortage?: boolean;
    };
    const ticketId = body.ticketId || "";
    if (!ticketId) return fail("ticketId is required");
    if (body.action === "claim") {
      await claimTicket(ticketId, gate.actor);
      return json({ ok: true });
    }
    if (body.action === "start") {
      const result = await startTicket(ticketId, gate.actor, Boolean(body.ackShortage));
      return json(result);
    }
    if (body.action === "done") {
      const result = await completeTicket(ticketId, gate.actor);
      return json(result);
    }
    if (body.action === "nudge") {
      await nudgeTicket(ticketId, gate.actor);
      return json({ ok: true });
    }
    if (body.action === "square-retry") {
      const result = await retrySquare(ticketId, gate.actor);
      return json(result);
    }
    return fail("Unknown board action");
  } catch (error) {
    return fail(error);
  }
}
