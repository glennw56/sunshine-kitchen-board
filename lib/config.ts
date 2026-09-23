import path from "path";
import {
  DEFAULT_OVERDUE_BUFFER_MINUTES,
  DEFAULT_REALERT_MINUTES,
  DEFAULT_STORE,
  INVENTORY_TEST_URL,
  TIMECLOCK_LIVE_URL,
} from "./constants";

export function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set to at least 16 characters in production");
  }
  return "dev-only-sunshine-kitchen-board-secret";
}

export function publicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
}

export function inventoryBaseUrl(): string {
  return (process.env.INVENTORY_BASE_URL || INVENTORY_TEST_URL).replace(/\/$/, "");
}

export function timeclockBaseUrl(): string {
  return (process.env.TIMECLOCK_BASE_URL || TIMECLOCK_LIVE_URL).replace(/\/$/, "");
}

export function timeclockIdentity(): { identifier: string; password: string } | null {
  const identifier = process.env.TIMECLOCK_IDENTIFIER || "";
  const password = process.env.TIMECLOCK_PASSWORD || "";
  if (!identifier || !password) return null;
  return { identifier, password };
}

export function inventoryCredentials(): { email: string; password: string } | null {
  const email = process.env.INVENTORY_EMAIL || process.env.INVENTORY_BASIC_USER || "";
  const password = process.env.INVENTORY_PASSWORD || process.env.INVENTORY_BASIC_PASSWORD || "";
  if (!email || !password) return null;
  return { email, password };
}

export type InventoryTransport = "file" | "http" | "gcs" | "auto";

export function inventoryTransport(): InventoryTransport {
  const raw = (process.env.INVENTORY_TRANSPORT || "auto").toLowerCase();
  if (raw === "file" || raw === "http" || raw === "gcs" || raw === "auto") return raw;
  return "auto";
}

export function inventoryGcsBucket(): string {
  return process.env.INVENTORY_GCS_BUCKET || "";
}

export function inventoryGcsObject(): string {
  return process.env.INVENTORY_GCS_OBJECT || "data/catalog.json";
}

export function defaultStore(): string {
  return process.env.TIMECLOCK_DEFAULT_STORE || DEFAULT_STORE;
}

export function slackConfig(): {
  botToken: string;
  signingSecret: string;
  channelId: string;
} | null {
  const botToken = process.env.SLACK_BOT_TOKEN || "";
  const signingSecret = process.env.SLACK_SIGNING_SECRET || "";
  const channelId = process.env.SLACK_CHANNEL_ID || "";
  if (!botToken || !signingSecret || !channelId) return null;
  return { botToken, signingSecret, channelId };
}

export function slackAssigneeMap(): Record<string, string> {
  const raw = process.env.SLACK_ASSIGNEE_MAP || "";
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function squareAccessToken(): string {
  return process.env.SQUARE_ACCESS_TOKEN || "";
}

export function squareApiBase(): string {
  return (process.env.SQUARE_API_BASE || "https://connect.squareup.com").replace(/\/$/, "");
}

export function cronSecret(): string {
  return process.env.CRON_SECRET || "";
}

export function alertDefaults(): { overdueBufferMinutes: number; realertMinutes: number } {
  return {
    overdueBufferMinutes: numberFromEnv(
      "OVERDUE_BUFFER_MINUTES",
      DEFAULT_OVERDUE_BUFFER_MINUTES,
    ),
    realertMinutes: numberFromEnv("REALERT_MINUTES", DEFAULT_REALERT_MINUTES),
  };
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
