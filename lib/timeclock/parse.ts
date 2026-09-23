import {
  DEFAULT_STORE,
  FOH_ROLE_PATTERN,
  KITCHEN_ROLE_PATTERN,
} from "../constants";
import type { LivePerson, PunchRoleKind } from "../types";

type Staff = {
  id?: string;
  name?: string;
  username?: string;
  email?: string | null;
  store?: string;
  location?: string;
  role?: string;
};

type Row = {
  punchId?: string;
  userId?: string;
  employee?: string;
  email?: string | null;
  username?: string;
  clockIn?: string;
  clockOut?: string;
  status?: string;
  hours?: string | number;
  source?: string;
  inDate?: string;
  store?: string;
  location?: string;
  role?: string;
};

type Chip = {
  date?: string;
  shift?: { userId?: string; role?: string | null; startAt?: string };
};

export function parseTimeclockFlight(flight: string, defaultStore = DEFAULT_STORE): {
  staff: Staff[];
  rows: Row[];
  chips: Chip[];
} {
  return {
    staff: extractArray<Staff>(flight, "staff"),
    rows: extractArray<Row>(flight, "rows"),
    chips: extractArray<Chip>(flight, "chips"),
  };
}

export function toLivePeople(
  parsed: { staff: Staff[]; rows: Row[]; chips: Chip[] },
  defaultStore = DEFAULT_STORE,
): LivePerson[] {
  const staffById = new Map(parsed.staff.filter((s) => s.id).map((s) => [s.id as string, s]));
  return parsed.rows.map((row) => {
    const staff = row.userId ? staffById.get(row.userId) : undefined;
    const shiftRole =
      parsed.chips.find((chip) => chip.shift?.userId && chip.shift.userId === row.userId)?.shift?.role ||
      "";
    const role = (row.role || staff?.role || shiftRole || "").trim();
    const store = (row.store || row.location || staff?.store || staff?.location || defaultStore).trim();
    const status = row.status === "open" || (!row.clockOut && row.status !== "closed") ? "open" : "closed";
    return {
      userId: row.userId || staff?.id || row.punchId || row.employee || "unknown",
      name: row.employee || staff?.name || row.username || "Unknown",
      username: row.username || staff?.username || "",
      email: row.email ?? staff?.email ?? null,
      store: store || defaultStore,
      role,
      roleKind: roleKind(role),
      clockIn: row.clockIn || "",
      status,
      clockOut: row.clockOut || "",
      hours: row.hours == null ? "" : String(row.hours),
      source: row.source || "",
      punchId: row.punchId || "",
    };
  });
}

export function roleKind(role: string): PunchRoleKind {
  const value = role.trim();
  if (!value) return "untagged";
  if (KITCHEN_ROLE_PATTERN.test(value)) return "kitchen";
  if (FOH_ROLE_PATTERN.test(value)) return "foh";
  return "other";
}

export function filterLive(
  people: LivePerson[],
  opts: { store: string; kitchenOnly: boolean },
): { punchedIn: LivePerson[]; recent: LivePerson[]; hiddenOtherCount: number; stores: string[] } {
  const stores = Array.from(new Set(people.map((p) => p.store).filter(Boolean))).sort();
  const inStore = opts.store ? people.filter((p) => p.store === opts.store) : people;
  const recent = inStore.slice(0, 40);
  const open = inStore.filter((p) => p.status === "open");
  if (!opts.kitchenOnly) {
    return { punchedIn: open, recent, hiddenOtherCount: 0, stores };
  }
  const punchedIn = open.filter((p) => p.roleKind === "kitchen" || p.roleKind === "untagged");
  const hiddenOtherCount = open.length - punchedIn.length;
  return { punchedIn, recent, hiddenOtherCount, stores };
}

function extractArray<T>(source: string, key: string): T[] {
  const token = `"${key}":`;
  const start = source.indexOf(token);
  if (start < 0) return [];
  let i = start + token.length;
  while (i < source.length && source[i] === " ") i += 1;
  if (source[i] !== "[") return [];
  const slice = sliceBalanced(source, i);
  if (!slice) return [];
  try {
    return JSON.parse(slice) as T[];
  } catch {
    return [];
  }
}

function sliceBalanced(source: string, openIndex: number): string | null {
  const open = source[openIndex];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  return null;
}
