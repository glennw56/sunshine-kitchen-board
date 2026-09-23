import { fail, json } from "@/lib/api";
import { writeAdminCookie } from "@/lib/session";
import { ensureReady, verifyAdmin } from "@/lib/store";

export async function POST(request: Request) {
  try {
    await ensureReady();
    const body = (await request.json()) as { email?: string; password?: string };
    const email = body.email || "";
    const password = body.password || "";
    if (!verifyAdmin(email, password)) return json({ ok: false, error: "Email or password does not match" }, 401);
    await writeAdminCookie(email.trim().toLowerCase());
    return json({ ok: true });
  } catch (error) {
    return fail(error, 500);
  }
}
