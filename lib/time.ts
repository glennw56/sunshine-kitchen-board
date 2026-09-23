import { TIME_ZONE } from "./constants";

export function chicagoDate(date = new Date()): string {
  const parts = chicagoParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function chicagoClock(date = new Date()): string {
  const parts = chicagoParts(date);
  return `${parts.hour}:${parts.minute}`;
}

export function formatChicago(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatChicagoTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** Convert a Chicago wall-clock YYYY-MM-DD + HH:mm into a UTC Date. */
export function chicagoLocalToUtc(date: string, time: string): Date {
  const [hour, minute] = time.split(":").map((n) => Number(n));
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  const asUtc = new Date(`${date}T${hh}:${mm}:00Z`);
  const offset = chicagoOffsetMs(asUtc);
  return new Date(asUtc.getTime() - offset);
}

function chicagoOffsetMs(instant: Date): number {
  const parts = chicagoParts(instant);
  const tzAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return tzAsUtc - instant.getTime();
}

function chicagoParts(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  if (bag.hour === "24") bag.hour = "00";
  return bag as {
    year: string;
    month: string;
    day: string;
    hour: string;
    minute: string;
    second: string;
  };
}

// Fix accidental Date() type in signature - I made a syntax error. Let me check.
export function addMinutes(iso: string, minutes: number): Date {
  return new Date(new Date(iso).getTime() + minutes * 60_000);
}

export function formatSprintLabel(serviceDate: string): string {
  const noon = chicagoLocalToUtc(serviceDate, "12:00");
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(noon);
}

export function formatEstimate(hours: number, minutes: number): string {
  const h = Math.max(0, Math.floor(hours));
  const m = Math.max(0, Math.floor(minutes));
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const clock = `${m}:${String(s).padStart(2, "0")}`;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : clock;
}

export function runningElapsedMs(elapsedMs: number, runningSince: string | null, nowMs: number): number {
  const base = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  if (!runningSince) return base;
  const since = new Date(runningSince).getTime();
  if (!Number.isFinite(since)) return base;
  return base + Math.max(0, nowMs - since);
}

export function pauseTimer(
  ticket: { timerElapsedMs?: number; timerRunningSince?: string | null },
  now = new Date(),
) {
  const since = ticket.timerRunningSince;
  if (!since) {
    ticket.timerElapsedMs = ticket.timerElapsedMs ?? 0;
    return;
  }
  ticket.timerElapsedMs = runningElapsedMs(ticket.timerElapsedMs ?? 0, since, now.getTime());
  ticket.timerRunningSince = null;
}

export function resumeTimer(
  ticket: { timerElapsedMs?: number; timerRunningSince?: string | null; startedAt?: string | null },
  now = new Date(),
) {
  ticket.timerElapsedMs = ticket.timerElapsedMs ?? 0;
  if (!ticket.timerRunningSince) ticket.timerRunningSince = now.toISOString();
  if (ticket.startedAt == null) ticket.startedAt = ticket.timerRunningSince;
}
