import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { authSecret } from "./config";

export type Session = {
  staffName: string | null;
  adminEmail: string | null;
};

const STAFF = "kb_staff";
const ADMIN = "kb_admin";

function sign(payload: string): string {
  const mac = createHmac("sha256", authSecret()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

function unsign(token: string | undefined): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const payload = token.slice(0, i);
  const mac = token.slice(i + 1);
  const expected = createHmac("sha256", authSecret()).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return payload;
}

export async function readSession(): Promise<Session> {
  const jar = await cookies();
  const staff = unsign(jar.get(STAFF)?.value);
  const adminRaw = unsign(jar.get(ADMIN)?.value);
  let adminEmail: string | null = null;
  if (adminRaw) {
    try {
      const parsed = JSON.parse(adminRaw) as { email?: string; exp?: number };
      if (parsed.email && parsed.exp && parsed.exp > Date.now()) adminEmail = parsed.email;
    } catch {
      adminEmail = null;
    }
  }
  return { staffName: staff, adminEmail };
}

export async function writeStaffCookie(name: string) {
  const jar = await cookies();
  jar.set(STAFF, sign(name.trim()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 18,
  });
}

export async function writeAdminCookie(email: string) {
  const jar = await cookies();
  const payload = JSON.stringify({ email, exp: Date.now() + 1000 * 60 * 60 * 12 });
  jar.set(ADMIN, sign(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function clearAdminCookie() {
  const jar = await cookies();
  jar.delete(ADMIN);
}

export function actorName(session: Session): string | null {
  return session.adminEmail || session.staffName;
}
