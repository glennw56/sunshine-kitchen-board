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
