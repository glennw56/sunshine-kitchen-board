import { defaultStore, timeclockBaseUrl, timeclockIdentity } from "../config";
import type { LiveFeed } from "../types";
import { filterLive, parseTimeclockFlight, toLivePeople } from "./parse";

/**
 * Read-only pull from sunshine-timeclock.
 * Discovered routes: GET /api/health, NextAuth /api/auth/*, pages / /login /register
 * /admin /admin/schedule /admin/labor.
 * Punches are server-rendered on /admin as `rows` plus `staff`. Shifts on
 * /admin/schedule carry an optional `role`. There is no clock-in call here.
 */
export async function loadLiveFeed(opts: {
  store?: string;
  kitchenOnly?: boolean;
  fetchImpl?: typeof fetch;
} = {}): Promise<LiveFeed> {
  const base = timeclockBaseUrl();
  const fetchedAt = new Date().toISOString();
  const identity = timeclockIdentity();
  const store = opts.store || defaultStore();
  const kitchenOnly = opts.kitchenOnly !== false;
  if (!identity) {
    return empty(base, store, fetchedAt, "Set TIMECLOCK_IDENTIFIER and TIMECLOCK_PASSWORD (admin recommended) to pull punches. This board does not clock anyone in.");
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const health = await fetchImpl(`${base}/api/health`, { cache: "no-store" });
    if (!health.ok) {
      return empty(base, store, fetchedAt, `Time clock health failed (${health.status})`);
    }
    const cookie = await signIn(base, identity, fetchImpl);
    const [adminFlight, scheduleFlight] = await Promise.all([
      fetchRsc(base, "/admin", cookie, fetchImpl),
      fetchRsc(base, "/admin/schedule", cookie, fetchImpl),
    ]);
    const admin = parseTimeclockFlight(adminFlight, defaultStore());
    const schedule = parseTimeclockFlight(scheduleFlight, defaultStore());
    if (!adminFlight.includes('"rows"') && adminFlight.includes("NEXT_REDIRECT")) {
      return empty(
        base,
        store,
        fetchedAt,
        "Time clock signed in, but the timesheet payload was empty. Use an admin login so /admin returns punches.",
      );
    }
    const people = toLivePeople(
      { staff: admin.staff.length ? admin.staff : schedule.staff, rows: admin.rows, chips: schedule.chips },
      defaultStore(),
    );
    const filtered = filterLive(people, { store, kitchenOnly });
    const stores = Array.from(new Set([defaultStore(), ...filtered.stores])).sort();
    return {
      ok: true,
      error: null,
      sourceUrl: base,
      fetchedAt,
      storeFilter: store,
      stores,
      punchedIn: filtered.punchedIn,
      recent: filtered.recent,
      hiddenOtherCount: filtered.hiddenOtherCount,
    };
  } catch (error) {
    return empty(base, store, fetchedAt, error instanceof Error ? error.message : String(error));
  }
}

async function signIn(
  base: string,
  identity: { identifier: string; password: string },
  fetchImpl: typeof fetch,
): Promise<string> {
  const csrfRes = await fetchImpl(`${base}/api/auth/csrf`, { cache: "no-store" });
  const csrfJson = (await csrfRes.json()) as { csrfToken?: string };
  const csrf = csrfJson.csrfToken;
  if (!csrf) throw new Error("Time clock did not return a CSRF token");
  const csrfCookie = cookieHeader(csrfRes.headers.getSetCookie?.() ?? []);
  const body = new URLSearchParams({
    csrfToken: csrf,
    identifier: identity.identifier,
    password: identity.password,
    callbackUrl: `${base}/admin`,
    json: "true",
  });
  const res = await fetchImpl(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: csrfCookie,
    },
    body,
    redirect: "manual",
  });
  const text = await res.text();
  const cookies = [
    ...splitCookies(csrfCookie),
    ...(res.headers.getSetCookie?.() ?? []).map((row) => row.split(";")[0]),
  ];
  const cookie = Array.from(new Set(cookies.filter(Boolean))).join("; ");
  if (!cookie.includes("session-token")) {
    throw new Error(`Time clock sign-in failed (${res.status}). ${text.slice(0, 180)}`);
  }
  return cookie;
}

async function fetchRsc(base: string, path: string, cookie: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(`${base}${path}`, {
    headers: { cookie, Accept: "text/x-component", RSC: "1" },
    redirect: "follow",
    cache: "no-store",
  });
  return res.text();
}

function cookieHeader(rows: string[]): string {
  return rows.map((row) => row.split(";")[0]).filter(Boolean).join("; ");
}

function splitCookies(header: string): string[] {
  return header.split(";").map((part) => part.trim()).filter((part) => part.includes("="));
}

function empty(sourceUrl: string, store: string, fetchedAt: string, error: string): LiveFeed {
  return {
    ok: false,
    error,
    sourceUrl,
    fetchedAt,
    storeFilter: store,
    stores: [store],
    punchedIn: [],
    recent: [],
    hiddenOtherCount: 0,
  };
}
