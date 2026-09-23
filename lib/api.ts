import { NextResponse } from "next/server";
import { actorName, readSession, type Session } from "./session";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : String(error);
  return json({ ok: false, error: message }, status);
}

export async function requireActor(): Promise<{ session: Session; actor: string } | NextResponse> {
  const session = await readSession();
  const actor = actorName(session);
  if (!actor) {
    return json({ ok: false, error: "Enter your name on the board before working a ticket." }, 401);
  }
  return { session, actor };
}

export async function requireAdmin(): Promise<{ session: Session; actor: string } | NextResponse> {
  const session = await readSession();
  if (!session.adminEmail) return json({ ok: false, error: "Owner login required" }, 401);
  return { session, actor: session.adminEmail };
}

export function isResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}
