import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHmac } from "node:crypto";
import { isOverdue, shouldSendAutoAlert, timingLabel } from "../lib/alerts";
import { bakeDayStock, claimTicket, completeTicket, cookedMove, shortageLines, startTicket, stockDeltas } from "../lib/board";
import { SQUARE_TEST_COOK } from "../lib/constants";
import { applyDeltaToDocument, CatalogMissError, extractCatalogFromText } from "../lib/inventory/normalize";
import { SEED_RECIPES } from "../lib/seed-data";
import { assertSquareRequest, buildTestCookAdjustment } from "../lib/square";
import { verifySlackSignature } from "../lib/slack";
import { ensureReady, loadDb } from "../lib/store";
import type { CatalogItem, Ticket } from "../lib/types";
import { chicagoLocalToUtc } from "../lib/time";
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
  assert.equal(source.includes("upsert"), false);
  assert.equal(source.includes(SQUARE_TEST_COOK.forbiddenLocationId), true);
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
    shortageAck: false,
    stockMoved: false,
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
  const done = await completeTicket(ticket.id, "Alex");
  assert.equal(done.ok, true);
  const items = (await import("../lib/inventory/file")).readFileCatalog().items;
  const butter = items.find((item) => item.sku === "BUTTER-UNS");
  const finished = items.find((item) => item.sku === "CROISSANT");
  assert.equal(butter?.onHand, 2 - 8);
  assert.equal(finished?.onHand, 24);
  const deltas = stockDeltas(recipe, 1);
  assert.ok(deltas.some((d) => d.sku === "CROISSANT" && d.delta === 24));
  await assert.rejects(() => cookedMove("NOT-A-SKU", 1, "add", "Alex"), CatalogMissError);
  await assert.rejects(() => cookedMove("FLOUR-AP", 1, "pull", "Alex"), /not a cooked/);
});

function stubTicket(partial: Pick<Ticket, "id" | "recipeId" | "status" | "batches">): Ticket {
  return {
    serviceDate: "2026-09-23",
    dueAt: "2026-09-23T15:00:00.000Z",
    assignee: null,
    claimedAt: null,
    startedAt: null,
    doneAt: null,
    shortageAck: false,
    stockMoved: false,
    squareMoved: false,
    squareError: null,
    createdAt: "2026-09-23T12:00:00.000Z",
    ...partial,
  };
}

test("deploy script refuses any other service name", () => {
  const script = path.join(process.cwd(), "scripts/deploy.sh");
  assert.throws(() => execFileSync("bash", [script, "sunshine-inventory-test"], { encoding: "utf8" }));
  const env = { ...process.env, SERVICE: "sunshine-kitchen-board", CLOUD_RUN_SERVICE: "" };
  assert.throws(() => execFileSync("bash", [script], { encoding: "utf8", env }));
  const text = fs.readFileSync(script, "utf8");
  assert.match(text, /sunshine-kitchen-board-test/);
  assert.match(text, /bakery-444323/);
  assert.match(text, /us-east1/);
  assert.doesNotMatch(text, /gcloud run deploy "\$\{?SERVICE:-sunshine-kitchen-board"\}/);
});
