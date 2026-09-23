import { boardSnapshot, saveSettings, setDue } from "@/lib/board";
import { fail, isResponse, json, requireAdmin } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireAdmin();
  if (isResponse(gate)) return gate;
  try {
    return json({ ok: true, ...(await boardSnapshot()) });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if (isResponse(gate)) return gate;
  try {
    const body = (await request.json()) as {
      action?: string;
      ticketId?: string;
      dueAt?: string;
      overdueBufferMinutes?: number;
      realertMinutes?: number;
    };
    if (body.action === "due" && body.ticketId && body.dueAt) {
      await setDue(body.ticketId, body.dueAt, gate.actor);
      return json({ ok: true });
    }
    if (body.action === "settings") {
      await saveSettings(Number(body.overdueBufferMinutes), Number(body.realertMinutes), gate.actor);
      return json({ ok: true });
    }
    return fail("Unknown owner action");
  } catch (error) {
    return fail(error);
  }
}
