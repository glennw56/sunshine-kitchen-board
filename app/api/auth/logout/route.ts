import { json } from "@/lib/api";
import { clearAdminCookie } from "@/lib/session";

export async function POST() {
  await clearAdminCookie();
  return json({ ok: true });
}
