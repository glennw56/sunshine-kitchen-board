import { verifySlackSignature } from "@/lib/slack";
import { json } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text();
  let body: { type?: string; challenge?: string };
  try {
    body = JSON.parse(raw) as { type?: string; challenge?: string };
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }
  if (body.type === "url_verification" && body.challenge) {
    return json({ challenge: body.challenge });
  }
  const ok = verifySlackSignature(
    raw,
    request.headers.get("x-slack-request-timestamp"),
    request.headers.get("x-slack-signature"),
  );
  if (!ok) return json({ ok: false, error: "Invalid Slack signature" }, 401);
  return json({ ok: true });
}
