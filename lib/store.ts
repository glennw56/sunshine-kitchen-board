import fs from "fs";
import path from "path";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { alertDefaults, dataDir } from "./config";
import type { ActivityEntry, AlertState, Recipe, Settings, Ticket } from "./types";
import { SEED_RECIPES } from "./seed-data";
import { chicagoDate, chicagoLocalToUtc } from "./time";

type DB = {
  recipes: Recipe[];
  tickets: Ticket[];
  activity: ActivityEntry[];
  alerts: AlertState[];
  settings: Settings;
};

const queues = new Map<string, Promise<unknown>>();

function file(name: string): string {
  return path.join(dataDir(), name);
}

function enqueue<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(job, job);
  queues.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

function readJson<T>(name: string, fallback: T): T {
  const p = file(name);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function writeJson(name: string, value: unknown) {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const p = file(name);
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, p);
}

export async function ensureReady(): Promise<void> {
  await enqueue("seed", async () => {
    fs.mkdirSync(dataDir(), { recursive: true });
    ensureAdmin();
    if (!fs.existsSync(file("recipes.json"))) {
      writeJson("recipes.json", SEED_RECIPES);
    }
    if (!fs.existsSync(file("settings.json"))) {
      writeJson("settings.json", alertDefaults());
    }
    if (!fs.existsSync(file("activity.json"))) writeJson("activity.json", []);
    if (!fs.existsSync(file("alerts.json"))) writeJson("alerts.json", []);
    if (!fs.existsSync(file("tickets.json"))) writeJson("tickets.json", []);
    ensureTodayTickets();
  });
}

function ensureTodayTickets() {
  const recipes = readJson<Recipe[]>("recipes.json", []);
  const tickets = readJson<Ticket[]>("tickets.json", []);
  const today = chicagoDate();
  let changed = false;
  for (const recipe of recipes) {
    const exists = tickets.some((t) => t.recipeId === recipe.id && t.serviceDate === today);
    if (exists) continue;
    const due = chicagoLocalToUtc(today, recipe.defaultDueTime);
    tickets.push({
      id: `t_${randomBytes(6).toString("hex")}`,
      recipeId: recipe.id,
      serviceDate: today,
      dueAt: due.toISOString(),
      batches: 1,
      status: "open",
      assignee: null,
      claimedAt: null,
      startedAt: null,
      doneAt: null,
      shortageAck: false,
      stockMoved: false,
      squareMoved: false,
      squareError: null,
      createdAt: new Date().toISOString(),
    });
    changed = true;
  }
  if (changed) writeJson("tickets.json", tickets);
}

export function loadDb(): DB {
  return {
    recipes: readJson<Recipe[]>("recipes.json", []),
    tickets: readJson<Ticket[]>("tickets.json", []),
    activity: readJson<ActivityEntry[]>("activity.json", []),
    alerts: readJson<AlertState[]>("alerts.json", []),
    settings: { ...alertDefaults(), ...readJson<Partial<Settings>>("settings.json", {}) },
  };
}

export async function updateDb(mutator: (db: DB) => void): Promise<DB> {
  return enqueue("db", async () => {
    await ensureReady();
    const db = loadDb();
    mutator(db);
    writeJson("recipes.json", db.recipes);
    writeJson("tickets.json", db.tickets);
    writeJson("activity.json", db.activity.slice(-1000));
    writeJson("alerts.json", db.alerts);
    writeJson("settings.json", db.settings);
    return db;
  });
}

export function logActivity(db: DB, entry: Omit<ActivityEntry, "id" | "at"> & { at?: string }) {
  db.activity.push({
    id: `a_${randomBytes(6).toString("hex")}`,
    at: entry.at ?? new Date().toISOString(),
    actor: entry.actor,
    action: entry.action,
    ticketId: entry.ticketId,
    detail: entry.detail,
  });
}

type AdminRecord = {
  email: string;
  salt: string;
  hash: string;
};

export function adminPath(): string {
  return file("admin.json");
}

export function ownerPasswordPath(): string {
  return file("owner-password.txt");
}

function ensureAdmin() {
  if (fs.existsSync(adminPath())) return;
  const email = (process.env.ADMIN_EMAIL || "glenn.will799@gmail.com").trim().toLowerCase();
  const fromEnv = process.env.ADMIN_INITIAL_PASSWORD || "";
  const password = fromEnv || randomBytes(12).toString("base64url");
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  const record: AdminRecord = { email, salt, hash };
  writeJson("admin.json", record);
  const note = [
    "Sunshine kitchen board owner login",
    `email: ${email}`,
    `password: ${password}`,
    "Hand this to the owner, then delete this file. Only the scrypt hash is stored in admin.json.",
    "",
  ].join("\n");
  fs.writeFileSync(ownerPasswordPath(), note, { mode: 0o600 });
  if (!fromEnv) {
    console.log(
      `[kitchen-board] Owner password written to ${ownerPasswordPath()} (not in git). Email ${email}.`,
    );
  }
}

export function verifyAdmin(email: string, password: string): boolean {
  if (!fs.existsSync(adminPath())) return false;
  const record = readJson<AdminRecord>("admin.json", {
    email: "",
    salt: "",
    hash: "",
  });
  if (record.email.toLowerCase() !== email.trim().toLowerCase()) return false;
  const next = scryptSync(password, record.salt, 64);
  const prev = Buffer.from(record.hash, "hex");
  if (next.length !== prev.length) return false;
  return timingSafeEqual(next, prev);
}

export function resetAdminPassword(password: string, email?: string): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  const existing = fs.existsSync(adminPath())
    ? readJson<AdminRecord>("admin.json", { email: "glenn.will799@gmail.com", salt: "", hash: "" })
    : { email: "glenn.will799@gmail.com", salt: "", hash: "" };
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  const record: AdminRecord = {
    email: (email || existing.email || "glenn.will799@gmail.com").toLowerCase(),
    salt,
    hash,
  };
  writeJson("admin.json", record);
  fs.writeFileSync(
    ownerPasswordPath(),
    `email: ${record.email}\npassword: ${password}\n`,
    { mode: 0o600 },
  );
}
