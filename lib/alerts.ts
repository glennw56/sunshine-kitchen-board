import type { Settings, Ticket } from "./types";
import { addMinutes } from "./time";

export function isOverdue(ticket: Ticket, settings: Settings, now = new Date()): boolean {
  if (ticket.status !== "claimed" && ticket.status !== "started") return false;
  const deadline = addMinutes(ticket.dueAt, settings.overdueBufferMinutes);
  return now.getTime() > deadline.getTime();
}

export function timingLabel(ticket: Ticket, settings: Settings, now = new Date()): "late" | "early" | "on-time" | "open" | "due" {
  if (ticket.status === "done" && ticket.doneAt) {
    const due = new Date(ticket.dueAt).getTime();
    const done = new Date(ticket.doneAt).getTime();
    if (done < due) return "early";
    if (done > addMinutes(ticket.dueAt, settings.overdueBufferMinutes).getTime()) return "late";
    return "on-time";
  }
  if (isOverdue(ticket, settings, now)) return "late";
  if (ticket.status === "open") return "open";
  return "due";
}

export function shouldSendAutoAlert(
  lastSentAt: string | null,
  settings: Settings,
  now = new Date(),
): boolean {
  if (!lastSentAt) return true;
  const next = addMinutes(lastSentAt, settings.realertMinutes);
  return now.getTime() >= next.getTime();
}
