import { json } from "@/lib/api";
import { writeStaffCookie } from "@/lib/session";

export async function POST(request: Request) {
  const body = (await request.json()) as { name?: string };
  const name = (body.name || "").trim();
  if (name.length < 2) return json({ ok: false, error: "Name needs at least 2 characters" }, 400);
  await writeStaffCookie(name.slice(0, 40));
  return json({ ok: true, name: name.slice(0, 40) });
}
