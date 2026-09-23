import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHmac } from "node:crypto";
import { isOverdue, shouldSendAutoAlert, timingLabel } from "../lib/alerts";
import { bakeDayStock, boardSnapshot, claimTicket, completeTicket, cookedMove, moveTicket, plannedStartAt, pullTemplate, retrySquare, shortageLines, startTicket, stockDeltas } from "../lib/board";
import { SQUARE_TEST_COOK } from "../lib/constants";
import { applyDeltaToDocument, CatalogMissError, extractCatalogFromText } from "../lib/inventory/normalize";
import { SEED_RECIPES } from "../lib/seed-data";
import { assertSquareRequest, buildTestCookAdjustment } from "../lib/square";
import { verifySlackSignature } from "../lib/slack";
import { ensureReady, loadDb } from "../lib/store";
import type { CatalogItem, Ticket } from "../lib/types";
import { chicagoLocalToUtc, formatEstimate, pauseTimer, resumeTimer, runningElapsedMs } from "../lib/time";
import { filterLive, parseTimeclockFlight, toLivePeople } from "../lib/timeclock/parse";

test("Chicago 10:00 in September is 15:00 UTC", () => {
  const due = chicagoLocalToUtc("2026-09-23", "10:00");
  assert.equal(due.toISOString(), "2026-09-23T15:00:00.000Z");
});

test("catalog delta updates onHand and refuses unknown SKUs", () => {
  const doc = {
    items: [
      { sku: "FLOUR-AP", name: "Flour", onHand: 5, unit: "lb", category: "dry" },
    ],
  };
  const next = applyDeltaToDocument(doc, [{ sku: "FLOUR-AP", delta: -2 }]);
  assert.equal((next.document as { items: { onHand: number }[] }).items[0].onHand, 3);
  assert.throws(() => applyDeltaToDocument(doc, [{ sku: "NOPE", delta: 1 }]), CatalogMissError);
  const scraped = extractCatalogFromText('prefix {"sku":"EGG-LARGE","name":"Eggs","onHand":4,"category":"fridge"} suffix');
  assert.equal(scraped[0]?.sku, "EGG-LARGE");
});

test("square adjustment is Test Cook at Irondale only", () => {
  const body = buildTestCookAdjustment({
    delta: 2,
    idempotencyKey: "kb-test",
    occurredAt: "2026-09-23T15:00:00.000Z",
  });
  assert.equal(body.changes[0].adjustment.catalog_object_id, SQUARE_TEST_COOK.variationId);
  assert.equal(body.changes[0].adjustment.location_id, SQUARE_TEST_COOK.locationId);
  assert.equal(body.changes[0].adjustment.to_state, "IN_STOCK");
  const down = buildTestCookAdjustment({
    delta: -1,
    idempotencyKey: "kb-down",
    occurredAt: "2026-09-23T15:00:00.000Z",
  });
  assert.equal(down.changes[0].adjustment.from_state, "IN_STOCK");
  assert.equal(down.changes[0].adjustment.to_state, "WASTE");
  assert.throws(() => assertSquareRequest("https://connect.squareup.com/v2/catalog/object", body));
  assert.throws(() =>
    assertSquareRequest("https://connect.squareup.com/v2/inventory/batch-change", {
      changes: [
        {
          type: "ADJUSTMENT",
          adjustment: {
            catalog_object_id: "OTHERITEMOTHERITEMOTHER",
            location_id: SQUARE_TEST_COOK.locationId,
          },
        },
      ],
    }),
  );
  const source = fs.readFileSync(path.join(process.cwd(), "lib/square.ts"), "utf8");
  assert.equal(source.includes("/v2/catalog"), false);
  assert.equal(source.includes("/v2/orders"), false);
  assert.equal(source.includes("upsert"), false);
  assert.equal(source.includes(SQUARE_TEST_COOK.forbiddenLocationId), true);
});

test("v1 source has no cook predictions, demand forecasts, or Square sales", () => {
  const banned = [/forecast/i, /predict/i, /auto-?order/i, /\/v2\/orders/, /sales metric/i];
  const hits: string[] = [];
  for (const root of ["app", "lib", "components"]) {
    for (const file of walkSource(path.join(process.cwd(), root))) {
      const text = fs.readFileSync(file, "utf8");
      for (const pattern of banned) {
        if (pattern.test(text)) hits.push(`${path.relative(process.cwd(), file)} matches ${pattern}`);
      }
    }
  }
  assert.deepEqual(hits, []);
});

test("overdue buffer and re-alert interval", () => {
  const settings = { overdueBufferMinutes: 10, realertMinutes: 15 };
  const dueAt = "2026-09-23T15:00:00.000Z";
  const claimed = {
    id: "t",
    recipeId: "croissant",
    serviceDate: "2026-09-23",
    dueAt,
    batches: 1,
    status: "claimed" as const,
    assignee: "Alex",
    claimedAt: dueAt,
    startedAt: null,
    doneAt: null,
    timerElapsedMs: 0,
    timerRunningSince: null,
    shortageAck: false,
    stockMoved: false,
    qtyMade: null,
    squareMoved: false,
    squareError: null,
    createdAt: dueAt,
  };
  assert.equal(isOverdue(claimed, settings, new Date("2026-09-23T15:09:00.000Z")), false);
  assert.equal(isOverdue(claimed, settings, new Date("2026-09-23T15:11:00.000Z")), true);
  assert.equal(isOverdue({ ...claimed, status: "open" }, settings, new Date("2026-09-23T16:00:00.000Z")), false);
  assert.equal(shouldSendAutoAlert(null, settings, new Date()), true);
  assert.equal(shouldSendAutoAlert("2026-09-23T15:11:00.000Z", settings, new Date("2026-09-23T15:20:00.000Z")), false);
  assert.equal(shouldSendAutoAlert("2026-09-23T15:11:00.000Z", settings, new Date("2026-09-23T15:26:00.000Z")), true);
  const early = { ...claimed, status: "done" as const, doneAt: "2026-09-23T14:00:00.000Z" };
  assert.equal(timingLabel(early, settings), "early");
});

test("timeclock feed filters store and kitchen role", () => {
  const flight = `
    "rows":[{"punchId":"p1","userId":"u1","employee":"Ada Cook","username":"ada","status":"open","clockIn":"6:00 AM","clockOut":"","hours":"1","source":"clock","store":"Irondale"},{"punchId":"p2","userId":"u2","employee":"Bea Front","username":"bea","status":"open","clockIn":"6:05 AM","clockOut":"","hours":"1","source":"clock","store":"Irondale"},{"punchId":"p3","userId":"u3","employee":"Cam","username":"cam","status":"closed","clockIn":"5:00 AM","clockOut":"9:00 AM","hours":"4","store":"Other Shop"}]
    "staff":[{"id":"u1","name":"Ada Cook","username":"ada"},{"id":"u2","name":"Bea Front","username":"bea"}]
    "chips":[{"date":"2026-09-23","shift":{"userId":"u1","role":"cook"}},{"date":"2026-09-23","shift":{"userId":"u2","role":"FOH cashier"}}]
  `;
  const parsed = parseTimeclockFlight(flight);
  const people = toLivePeople(parsed, "Irondale");
  const kitchen = filterLive(people, { store: "Irondale", kitchenOnly: true });
  assert.deepEqual(kitchen.punchedIn.map((p) => p.name), ["Ada Cook"]);
  assert.equal(kitchen.hiddenOtherCount, 1);
  const all = filterLive(people, { store: "Irondale", kitchenOnly: false });
  assert.equal(all.punchedIn.length, 2);
  const source = fs.readFileSync(path.join(process.cwd(), "lib/timeclock/client.ts"), "utf8");
  assert.equal(source.includes("clockIn"), false);
});

test("slack signature accepts a fresh valid header", () => {
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.SLACK_SIGNING_SECRET = "slack-secret";
  process.env.SLACK_CHANNEL_ID = "C123";
  const raw = "command=/recipe&text=croissant";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = `v0=${createHmac("sha256", "slack-secret").update(`v0:${timestamp}:${raw}`).digest("hex")}`;
  assert.equal(verifySlackSignature(raw, timestamp, sig), true);
  assert.equal(verifySlackSignature(raw, timestamp, "v0=nope"), false);
});

test("bake-day stock is today's recipe SKUs, with shared need and done tickets at zero", () => {
  const items: CatalogItem[] = [
    { sku: "FLOUR-AP", name: "Flour", onHand: 40, unit: "lb", category: "dry" },
    { sku: "BUTTER-UNS", name: "Butter", onHand: 2, unit: "lb", category: "dairy" },
    { sku: "CROISSANT", name: "Croissant", onHand: 0, unit: "ea", category: "finished" },
    { sku: "COOKIE-CCC", name: "Cookie", onHand: 3, unit: "ea", category: "finished" },
    { sku: "LOAF-SOUR", name: "Loaf", onHand: 1, unit: "ea", category: "cooked" },
    { sku: "SALT-KOSHER", name: "Salt", onHand: 5, unit: "lb", category: "dry" },
    { sku: "UNUSED", name: "Unused spice", onHand: 99, unit: "ea", category: "dry" },
  ];
  const tickets = [
    stubTicket({ id: "a", recipeId: "croissant", status: "open", batches: 1 }),
    stubTicket({ id: "b", recipeId: "cookie", status: "claimed", batches: 1 }),
    stubTicket({ id: "c", recipeId: "sourdough", status: "done", batches: 1 }),
  ];
  const stock = bakeDayStock(tickets, SEED_RECIPES, items);
  const flour = stock.raw.find((line) => line.sku === "FLOUR-AP");
  assert.equal(flour?.need, 3.5);
  assert.equal(flour?.onHand, 40);
  assert.equal(flour?.short, false);
  const butter = stock.raw.find((line) => line.sku === "BUTTER-UNS");
  assert.equal(butter?.need, 9);
  assert.equal(butter?.onHand, 2);
  assert.equal(butter?.short, true);
  assert.equal(stock.raw.find((line) => line.sku === "SALT-KOSHER")?.need, 0);
  assert.equal(stock.cooked.find((line) => line.sku === "CROISSANT")?.need, 24);
  assert.equal(stock.cooked.find((line) => line.sku === "COOKIE-CCC")?.onHand, 3);
  assert.equal(stock.cooked.find((line) => line.sku === "LOAF-SOUR")?.need, 0);
  assert.equal(stock.raw.some((line) => line.sku === "UNUSED"), false);
  const missing = bakeDayStock([stubTicket({ id: "m", recipeId: "croissant", status: "open", batches: 1 })], SEED_RECIPES, []);
  assert.equal(missing.raw.find((line) => line.sku === "FLOUR-AP")?.missing, true);
  assert.equal(missing.cooked.find((line) => line.sku === "CROISSANT")?.missing, true);
});

test("claim, start, done moves raw down and cooked up", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-"));
  process.env.DATA_DIR = dir;
  process.env.INVENTORY_TRANSPORT = "file";
  process.env.SQUARE_ACCESS_TOKEN = "";
  process.env.ADMIN_INITIAL_PASSWORD = "test-password-please";
  process.env.AUTH_SECRET = "test-secret-at-least-16";
  await ensureReady();
  await pullTemplate("croissant", "Alex");
  const ticket = loadDb().tickets.find((row) => row.recipeId === "croissant");
  assert.ok(ticket);
  const recipe = SEED_RECIPES[0];
  const shortages = shortageLines(recipe, 1, (await import("../lib/inventory/file")).readFileCatalog().items);
  assert.ok(shortages.some((line) => line.sku === "BUTTER-UNS"));
  await claimTicket(ticket.id, "Alex");
  const blocked = await startTicket(ticket.id, "Alex", false);
  assert.equal(blocked.ok, false);
  const started = await startTicket(ticket.id, "Alex", true);
  assert.equal(started.ok, true);
  await assert.rejects(() => completeTicket(ticket.id, "Alex", 0), /Amount made/);
  const calls: { body: string }[] = [];
  const originalFetch = globalThis.fetch;
  process.env.SQUARE_ACCESS_TOKEN = "sq-test-token";
  globalThis.fetch = async (_input, init) => {
    calls.push({ body: String(init?.body ?? "") });
    return new Response("nope", { status: 500 });
  };
  let done: Awaited<ReturnType<typeof completeTicket>>;
  try {
    done = await completeTicket(ticket.id, "Alex", 18);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(done.ok, true);
  assert.equal(done.qtyMade, 18);
  assert.match(done.squareError || "", /Square inventory 500/);
  const firstSquare = JSON.parse(calls[0].body) as {
    changes: { adjustment: { quantity: string; catalog_object_id: string; location_id: string } }[];
  };
  assert.equal(firstSquare.changes[0].adjustment.quantity, "18");
  assert.equal(firstSquare.changes[0].adjustment.catalog_object_id, SQUARE_TEST_COOK.variationId);
  assert.equal(firstSquare.changes[0].adjustment.location_id, SQUARE_TEST_COOK.locationId);
  const items = (await import("../lib/inventory/file")).readFileCatalog().items;
  const butter = items.find((item) => item.sku === "BUTTER-UNS");
  const finished = items.find((item) => item.sku === "CROISSANT");
  assert.equal(butter?.onHand, 2 - 8);
  assert.equal(finished?.onHand, 18);
  assert.equal(loadDb().tickets.find((row) => row.id === ticket.id)?.qtyMade, 18);
  calls.length = 0;
  process.env.SQUARE_ACCESS_TOKEN = "sq-test-token";
  globalThis.fetch = async (_input, init) => {
    calls.push({ body: String(init?.body ?? "") });
    return new Response("{}", { status: 200 });
  };
  try {
    const retried = await retrySquare(ticket.id, "Alex");
    assert.equal(retried.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.SQUARE_ACCESS_TOKEN = "";
  }
  const retryBody = JSON.parse(calls[0].body) as {
    changes: { adjustment: { quantity: string; catalog_object_id: string } }[];
  };
  assert.equal(retryBody.changes[0].adjustment.quantity, "18");
  assert.equal(retryBody.changes[0].adjustment.catalog_object_id, SQUARE_TEST_COOK.variationId);
  const deltas = stockDeltas(recipe, 1, 18);
  assert.ok(deltas.some((d) => d.sku === "CROISSANT" && d.delta === 18));
  assert.ok(deltas.some((d) => d.sku === "BUTTER-UNS" && d.delta === -8));
  assert.ok(stockDeltas(recipe, 1).some((d) => d.sku === "CROISSANT" && d.delta === 24));
  await assert.rejects(() => cookedMove("NOT-A-SKU", 1, "add", "Alex"), CatalogMissError);
  await assert.rejects(() => cookedMove("FLOUR-AP", 1, "pull", "Alex"), /not a cooked/);
});

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSource(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function stubTicket(partial: Pick<Ticket, "id" | "recipeId" | "status" | "batches">): Ticket {
  return {
    serviceDate: "2026-09-23",
    dueAt: "2026-09-23T15:00:00.000Z",
    assignee: null,
    claimedAt: null,
    startedAt: null,
    doneAt: null,
    timerElapsedMs: 0,
    timerRunningSince: null,
    shortageAck: false,
    stockMoved: false,
    qtyMade: null,
    squareMoved: false,
    squareError: null,
    createdAt: "2026-09-23T12:00:00.000Z",
    ...partial,
  };
}

test("tablet is its own floor layout, not a stretched phone", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
  const board = fs.readFileSync(path.join(process.cwd(), "components/BoardClient.tsx"), "utf8");
  assert.match(css, /min-width:\s*768px\) and \(min-height:\s*640px\)/);
  assert.match(css, /grid-template-columns:\s*11\.5rem/);
  assert.match(css, /--tap:\s*3\.5rem/);
  assert.match(css, /\.jira/);
  assert.match(board, /Backlog/);
  assert.match(board, /In Progress/);
  assert.match(board, /Amount made/);
  assert.match(board, /className="estimate"/);
  assert.match(board, /className="actions"/);
  assert.match(board, /className="btn done"/);
});

test("sprint keeps templates and starts the timer only in progress", async () => {
  assert.equal(formatEstimate(1, 30), "1h 30m");
  assert.equal(formatEstimate(0, 35), "35m");
  assert.equal(plannedStartAt("2026-09-23T15:00:00.000Z", 90), "2026-09-23T13:30:00.000Z");
  const running = stubTicket({ id: "timer", recipeId: "cookie", status: "started", batches: 1 });
  running.timerElapsedMs = 1000;
  running.timerRunningSince = "2026-09-23T15:00:00.000Z";
  assert.equal(runningElapsedMs(running.timerElapsedMs, running.timerRunningSince, Date.parse("2026-09-23T15:00:05.000Z")), 6000);
  pauseTimer(running, new Date("2026-09-23T15:00:05.000Z"));
  assert.equal(running.timerRunningSince, null);
  assert.equal(running.timerElapsedMs, 6000);
  resumeTimer(running, new Date("2026-09-23T15:01:00.000Z"));
  assert.equal(runningElapsedMs(running.timerElapsedMs, running.timerRunningSince, Date.parse("2026-09-23T15:01:02.000Z")), 8000);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sprint-"));
  process.env.DATA_DIR = dir;
  process.env.INVENTORY_TRANSPORT = "file";
  process.env.ADMIN_INITIAL_PASSWORD = "test-password-please";
  process.env.AUTH_SECRET = "test-secret-at-least-16";
  const snap = await boardSnapshot();
  assert.equal(snap.columns.todo.length, 1);
  assert.equal(snap.columns.todo[0]?.ticket.recipeId, "cookie");
  assert.equal(snap.columns.progress.length, 0);
  assert.equal(snap.backlog.find((row) => row.recipeId === "croissant")?.inSprint, false);
  assert.equal(snap.backlog.find((row) => row.recipeId === "cookie")?.inSprint, true);
  assert.equal(snap.backlog.find((row) => row.recipeId === "croissant")?.estimateLabel, "1h 30m");
  await pullTemplate("croissant", "Alex");
  await assert.rejects(() => pullTemplate("croissant", "Alex"), /already in today's sprint/);
  const pulled = loadDb().tickets.find((row) => row.recipeId === "croissant");
  assert.ok(pulled);
  assert.equal(loadDb().tickets.length, 2);
  const started = await moveTicket(pulled.id, "progress", "Alex", { ackShortage: true });
  assert.equal(started.ok, true);
  const inProgress = loadDb().tickets.find((row) => row.id === pulled.id);
  assert.equal(inProgress?.status, "started");
  assert.ok(inProgress?.timerRunningSince);
  await moveTicket(pulled.id, "todo", "Alex");
  const paused = loadDb().tickets.find((row) => row.id === pulled.id);
  assert.equal(paused?.status, "claimed");
  assert.equal(paused?.timerRunningSince, null);
  await boardSnapshot();
  assert.equal(loadDb().tickets.length, 2);
});

test("deploy script refuses any other service name", () => {
  const script = path.join(process.cwd(), "scripts/deploy.sh");
  assert.throws(() => execFileSync("bash", [script, "sunshine-inventory-test"], { encoding: "utf8" }));
  const env = { ...process.env, SERVICE: "sunshine-kitchen-board", CLOUD_RUN_SERVICE: "" };
  assert.throws(() => execFileSync("bash", [script], { encoding: "utf8", env }));
  const text = fs.readFileSync(script, "utf8");
  assert.match(text, /sunshine-kitchen-board-test/);
  assert.match(text, /bakery-444323/);
  assert.match(text, /us-east1/);
  assert.match(text, /INVENTORY_TRANSPORT=gcs/);
  assert.match(text, /bakery-444323-sunshine-inventory-test/);
  assert.match(text, /catalog\.json/);
  assert.doesNotMatch(text, /"INVENTORY_TRANSPORT": "http"/);
  assert.doesNotMatch(text, /gcloud run deploy "\$\{?SERVICE:-sunshine-kitchen-board"\}/);
});
