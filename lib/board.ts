import { randomBytes } from "crypto";
import { adjustInventory, readInventory, splitCatalog } from "./inventory/client";
import { CatalogMissError, isCookedCategory } from "./inventory/normalize";
import { isOverdue, shouldSendAutoAlert, timingLabel } from "./alerts";
import { mentionFor, postKitchenMessage, recipeSlackText } from "./slack";
import { adjustTestCook } from "./square";
import { ensureReady, loadDb, logActivity, updateDb } from "./store";
import type { BakeDayStockLine, CatalogItem, Recipe, ShortageLine, Ticket } from "./types";
import { formatChicago } from "./time";

export async function boardSnapshot(now = new Date()) {
  await ensureReady();
  const db = loadDb();
  const inventory = await readInventory();
  const today = db.tickets
    .filter((ticket) => ticket.serviceDate === chicagoServiceDate(now))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const cards = today.map((ticket) => decorate(ticket, db, inventory.items, now));
  const active = cards.filter((card) => card.ticket.status === "claimed" || card.ticket.status === "started");
  return {
    now: now.toISOString(),
    settings: db.settings,
    cards,
    onTheFloor: active.map((card) => ({
      ticketId: card.ticket.id,
      recipe: card.recipe?.name ?? card.ticket.recipeId,
      assignee: card.ticket.assignee,
      status: card.ticket.status,
      dueAt: card.ticket.dueAt,
      timing: card.timing,
    })),
    inventoryError: inventory.error,
    inventoryTransport: inventory.transport,
    activity: db.activity.slice(-80).reverse(),
    bakeDay: bakeDayStock(today, db.recipes, inventory.items),
  };
}

/** On-hand for SKUs tied to today's tickets. Not the full catalog. */
export function bakeDayStock(tickets: Ticket[], recipes: Recipe[], items: CatalogItem[]): {
  raw: BakeDayStockLine[];
  cooked: BakeDayStockLine[];
} {
  const raw = new Map<string, BakeDayStockLine>();
  const cooked = new Map<string, BakeDayStockLine>();
  for (const ticket of tickets) {
    const recipe = recipes.find((item) => item.id === ticket.recipeId);
    if (!recipe) continue;
    const open = ticket.status !== "done";
    for (const ingredient of recipe.ingredients) {
      const prev = raw.get(ingredient.sku);
      const item = items.find((row) => row.sku === ingredient.sku);
      const need = round3((prev?.need ?? 0) + (open ? ingredient.qty * ticket.batches : 0));
      const onHand = item ? item.onHand : null;
      raw.set(ingredient.sku, {
        sku: ingredient.sku,
        name: item?.name || ingredient.name,
        unit: item?.unit || ingredient.unit,
        onHand,
        need,
        kind: "raw",
        missing: !item,
        short: !item || onHand === null || onHand < need,
      });
    }
    const prev = cooked.get(recipe.finishedSku);
    const item = items.find((row) => row.sku === recipe.finishedSku);
    const need = round3((prev?.need ?? 0) + (open ? recipe.yieldQty * ticket.batches : 0));
    cooked.set(recipe.finishedSku, {
      sku: recipe.finishedSku,
      name: item?.name || recipe.finishedName,
      unit: item?.unit || "ea",
      onHand: item ? item.onHand : null,
      need,
      kind: "cooked",
      missing: !item,
      short: false,
    });
  }
  return { raw: [...raw.values()], cooked: [...cooked.values()] };
}

export async function claimTicket(ticketId: string, actor: string) {
  return updateDb((db) => {
    const ticket = mustTicket(db.tickets, ticketId);
    if (ticket.status === "done") throw new Error("That ticket is already done");
    if (ticket.status === "started" && ticket.assignee && ticket.assignee !== actor) {
      throw new Error(`${ticket.assignee} already started this. Ask them, or an owner, before taking it.`);
    }
    const previous = ticket.assignee;
    ticket.assignee = actor;
    ticket.claimedAt = ticket.claimedAt ?? new Date().toISOString();
    if (ticket.status === "open") ticket.status = "claimed";
    logActivity(db, {
      actor,
      action: previous && previous !== actor ? "transfer" : "claim",
      ticketId,
      detail: previous && previous !== actor ? `${actor} took over from ${previous}` : `${actor} claimed the ticket`,
    });
  });
}

export async function startTicket(ticketId: string, actor: string, ackShortage: boolean) {
  await ensureReady();
  const db = loadDb();
  const ticket = mustTicket(db.tickets, ticketId);
  if (ticket.status === "done") throw new Error("That ticket is already done");
  if (ticket.status === "open") throw new Error("Claim the ticket before starting");
  if (ticket.assignee && ticket.assignee !== actor) {
    throw new Error(`Claimed by ${ticket.assignee}`);
  }
  const recipe = mustRecipe(db.recipes, ticket.recipeId);
  const inventory = await readInventory();
  if (inventory.error) throw new Error(inventory.error);
  const shortages = shortageLines(recipe, ticket.batches, inventory.items);
  if (shortages.length && !ackShortage && !ticket.shortageAck) {
    return { ok: false as const, shortages };
  }
  await updateDb((next) => {
    const row = mustTicket(next.tickets, ticketId);
    row.status = "started";
    row.startedAt = row.startedAt ?? new Date().toISOString();
    row.shortageAck = shortages.length ? true : row.shortageAck;
    logActivity(next, {
      actor,
      action: "start",
      ticketId,
      detail: shortages.length
        ? `Started with shortages: ${shortages.map((s) => s.sku).join(", ")}`
        : "Started",
    });
  });
  return { ok: true as const, shortages };
}

const ticketLocks = new Set<string>();

async function lockTicket<T>(ticketId: string, job: () => Promise<T>): Promise<T> {
  if (ticketLocks.has(ticketId)) throw new Error("That ticket is already being updated");
  ticketLocks.add(ticketId);
  try {
    return await job();
  } finally {
    ticketLocks.delete(ticketId);
  }
}

export async function completeTicket(ticketId: string, actor: string) {
  return lockTicket(ticketId, () => completeTicketUnlocked(ticketId, actor));
}

async function completeTicketUnlocked(ticketId: string, actor: string) {
  await ensureReady();
  const db = loadDb();
  const ticket = mustTicket(db.tickets, ticketId);
  if (ticket.status === "done" && ticket.stockMoved) {
    return { ok: true as const, already: true, squareError: ticket.squareError };
  }
  if (ticket.status !== "started") throw new Error("Start the ticket before marking it done");
  const recipe = mustRecipe(db.recipes, ticket.recipeId);
  const inventory = await readInventory();
  if (inventory.error) throw new Error(inventory.error);
  const deltas = stockDeltas(recipe, ticket.batches);
  assertKnown(deltas, inventory.items);
  assertCookedTarget(recipe.finishedSku, inventory.items, db.recipes);
  let applied: { sku: string; onHand: number }[] = [];
  if (!ticket.stockMoved) {
    applied = await adjustInventory(deltas);
  }
  const square = ticket.squareMoved
    ? { ok: true, skipped: false, error: null as string | null }
    : await adjustTestCook(recipe.yieldQty * ticket.batches, {
        idempotencyKey: `kb-${ticket.id}-done-${ticket.squareError ? "retry" : "1"}`,
      });
  await updateDb((next) => {
    const row = mustTicket(next.tickets, ticketId);
    row.stockMoved = true;
    row.squareMoved = square.ok && !square.skipped;
    row.squareError = square.ok ? null : square.error;
    row.status = "done";
    row.doneAt = row.doneAt ?? new Date().toISOString();
    logActivity(next, {
      actor,
      action: "done",
      ticketId,
      detail: `Finished. Stock moved. Square: ${square.ok ? "updated Test Cook" : square.error}`,
    });
  });
  return { ok: true as const, already: false, applied, squareError: square.ok ? null : square.error };
}

export async function retrySquare(ticketId: string, actor: string) {
  await ensureReady();
  const db = loadDb();
  const ticket = mustTicket(db.tickets, ticketId);
  const recipe = mustRecipe(db.recipes, ticket.recipeId);
  if (!ticket.stockMoved) throw new Error("Finish the ticket so inventory moves before retrying Square");
  if (ticket.squareMoved) return { ok: true as const, error: null };
  const square = await adjustTestCook(recipe.yieldQty * ticket.batches, {
    idempotencyKey: `kb-${ticket.id}-square-${randomBytes(3).toString("hex")}`,
  });
  await updateDb((next) => {
    const row = mustTicket(next.tickets, ticketId);
    row.squareMoved = square.ok && !square.skipped;
    row.squareError = square.ok ? null : square.error;
    logActivity(next, {
      actor,
      action: "square-retry",
      ticketId,
      detail: square.ok ? "Square Test Cook adjusted" : `Square retry failed: ${square.error}`,
    });
  });
  return { ok: square.ok, error: square.error };
}

export async function nudgeTicket(ticketId: string, actor: string) {
  await ensureReady();
  const db = loadDb();
  const ticket = mustTicket(db.tickets, ticketId);
  const recipe = mustRecipe(db.recipes, ticket.recipeId);
  const text = `Manual nudge from ${actor}: *${recipe.name}* is ${ticket.status}, due ${formatChicago(ticket.dueAt)}.${mentionFor(ticket.assignee)}`;
  const sent = await postKitchenMessage(text, recipeSlackText(recipe, ticket));
  await updateDb((next) => {
    logActivity(next, {
      actor,
      action: "nudge",
      ticketId,
      detail: sent.ok ? "Slack nudge sent" : `Slack nudge failed: ${sent.error}`,
    });
  });
  if (!sent.ok) throw new Error(sent.error || "Slack nudge failed");
  return { ok: true };
}

export async function runOverdueAlerts(actor = "system") {
  await ensureReady();
  const now = new Date();
  const db = loadDb();
  const due = db.tickets.filter((ticket) => isOverdue(ticket, db.settings, now));
  const sent: string[] = [];
  for (const ticket of due) {
    const state = db.alerts.find((alert) => alert.ticketId === ticket.id);
    if (state && !shouldSendAutoAlert(state.lastSentAt, db.settings, now)) continue;
    const recipe = db.recipes.find((item) => item.id === ticket.recipeId);
    const name = recipe?.name ?? ticket.recipeId;
    const text = `Overdue: *${name}* was due ${formatChicago(ticket.dueAt)} (plus ${db.settings.overdueBufferMinutes} min). ${ticket.assignee ?? "Unassigned"} has not finished it.${mentionFor(ticket.assignee)}`;
    const result = await postKitchenMessage(text, recipe ? recipeSlackText(recipe, ticket) : undefined);
    await updateDb((next) => {
      let alert = next.alerts.find((row) => row.ticketId === ticket.id);
      if (!alert) {
        alert = { ticketId: ticket.id, count: 0, lastSentAt: null, lastError: null };
        next.alerts.push(alert);
      }
      if (result.ok) {
        alert.count += 1;
        alert.lastSentAt = new Date().toISOString();
        alert.lastError = null;
        sent.push(ticket.id);
      } else {
        alert.lastError = result.error;
      }
      logActivity(next, {
        actor,
        action: "overdue-alert",
        ticketId: ticket.id,
        detail: result.ok ? `Auto Slack overdue #${alert.count}` : `Auto Slack failed: ${result.error}`,
      });
    });
  }
  return { checked: due.length, sent };
}

export async function adjustRaw(sku: string, delta: number, actor: string) {
  const inventory = await readInventory();
  if (inventory.error) throw new Error(inventory.error);
  const item = inventory.items.find((row) => row.sku === sku);
  if (!item) throw new CatalogMissError(sku);
  if (isCookedCategory(item.category)) {
    throw new Error(`${sku} is a cooked/finished item. Use the Cooked tab so it stays out of raw.`);
  }
  const applied = await adjustInventory([{ sku, delta }]);
  await updateDb((db) => {
    logActivity(db, {
      actor,
      action: "raw-adjust",
      detail: `${delta > 0 ? "Added" : "Removed"} ${Math.abs(delta)} ${item.unit} of ${item.name} (${sku})`,
    });
  });
  return applied;
}

export async function cookedMove(
  sku: string,
  qty: number,
  mode: "add" | "remove" | "pull",
  actor: string,
) {
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("Quantity must be greater than zero");
  await ensureReady();
  const db = loadDb();
  const inventory = await readInventory();
  if (inventory.error) throw new Error(inventory.error);
  assertCookedTarget(sku, inventory.items, db.recipes);
  const delta = mode === "add" ? qty : -qty;
  const applied = await adjustInventory([{ sku, delta }]);
  const square = await adjustTestCook(delta, {
    idempotencyKey: `kb-cooked-${sku}-${mode}-${randomBytes(4).toString("hex")}`,
  });
  await updateDb((next) => {
    logActivity(next, {
      actor,
      action: mode === "add" ? "cooked-add" : mode === "remove" ? "cooked-remove" : "cooked-pull",
      detail: `${mode} ${qty} of ${sku}. Square: ${square.ok ? "Test Cook adjusted" : square.error}`,
    });
  });
  return { applied, squareError: square.ok ? null : square.error };
}

export async function linkIngredient(recipeId: string, ingredientId: string, sku: string, actor: string) {
  const inventory = await readInventory();
  if (inventory.error) throw new Error(inventory.error);
  const item = inventory.items.find((row) => row.sku === sku);
  if (!item) throw new CatalogMissError(sku);
  await updateDb((db) => {
    const recipe = mustRecipe(db.recipes, recipeId);
    const line = recipe.ingredients.find((ingredient) => ingredient.id === ingredientId);
    if (!line) throw new Error("Ingredient line not found");
    line.sku = item.sku;
    line.name = item.name;
    line.unit = item.unit || line.unit;
    logActivity(db, {
      actor,
      action: "link-sku",
      detail: `Linked ${recipe.name} ingredient to ${item.sku}`,
    });
  });
}

export async function setDue(ticketId: string, dueAt: string, actor: string) {
  const when = new Date(dueAt);
  if (Number.isNaN(when.getTime())) throw new Error("Due time is not a valid date");
  await updateDb((db) => {
    const ticket = mustTicket(db.tickets, ticketId);
    ticket.dueAt = when.toISOString();
    logActivity(db, {
      actor,
      action: "due-change",
      ticketId,
      detail: `Due time set to ${formatChicago(ticket.dueAt)}`,
    });
  });
}

export async function saveSettings(overdueBufferMinutes: number, realertMinutes: number, actor: string) {
  if (overdueBufferMinutes < 0 || realertMinutes < 1) throw new Error("Buffer must be >= 0 and re-alert >= 1 minute");
  await updateDb((db) => {
    db.settings.overdueBufferMinutes = overdueBufferMinutes;
    db.settings.realertMinutes = realertMinutes;
    logActivity(db, {
      actor,
      action: "due-change",
      detail: `Alert settings: buffer ${overdueBufferMinutes}m, re-alert every ${realertMinutes}m`,
    });
  });
}

export function shortageLines(recipe: Recipe, batches: number, items: CatalogItem[]): ShortageLine[] {
  const lines: ShortageLine[] = [];
  for (const ingredient of recipe.ingredients) {
    const item = items.find((row) => row.sku === ingredient.sku);
    const need = round3(ingredient.qty * batches);
    if (!item) {
      lines.push({
        sku: ingredient.sku,
        name: ingredient.name,
        need,
        onHand: 0,
        unit: ingredient.unit,
        missingSku: true,
      });
      continue;
    }
    if (item.onHand < need) {
      lines.push({
        sku: ingredient.sku,
        name: item.name,
        need,
        onHand: item.onHand,
        unit: item.unit || ingredient.unit,
        missingSku: false,
      });
    }
  }
  return lines;
}

export function stockDeltas(recipe: Recipe, batches: number): { sku: string; delta: number }[] {
  const deltas = recipe.ingredients.map((ingredient) => ({
    sku: ingredient.sku,
    delta: -round3(ingredient.qty * batches),
  }));
  deltas.push({ sku: recipe.finishedSku, delta: round3(recipe.yieldQty * batches) });
  return deltas;
}

function decorate(
  ticket: Ticket,
  db: ReturnType<typeof loadDb>,
  items: CatalogItem[],
  now: Date,
) {
  const recipe = db.recipes.find((item) => item.id === ticket.recipeId) ?? null;
  const shortages = recipe ? shortageLines(recipe, ticket.batches, items) : [];
  const alert = db.alerts.find((row) => row.ticketId === ticket.id) ?? null;
  return {
    ticket,
    recipe,
    shortages,
    timing: timingLabel(ticket, db.settings, now),
    overdue: isOverdue(ticket, db.settings, now),
    alert,
  };
}

function assertKnown(deltas: { sku: string }[], items: CatalogItem[]) {
  for (const delta of deltas) {
    if (!items.some((item) => item.sku === delta.sku)) throw new CatalogMissError(delta.sku);
  }
}

function assertCookedTarget(sku: string, items: CatalogItem[], recipes: Recipe[]) {
  const item = items.find((row) => row.sku === sku);
  if (!item) throw new CatalogMissError(sku);
  const recipeOutput = recipes.some((recipe) => recipe.finishedSku === sku);
  if (!isCookedCategory(item.category) && !recipeOutput) {
    throw new Error(
      `${sku} is in the catalog as "${item.category || "uncategorized"}", not a cooked/finished item. Recategorize it in inventory (finished/cooked/baked) or set it as a recipe's finished SKU. Refusing the cooked move.`,
    );
  }
}

function mustTicket(tickets: Ticket[], id: string): Ticket {
  const ticket = tickets.find((row) => row.id === id);
  if (!ticket) throw new Error("Ticket not found");
  return ticket;
}

function mustRecipe(recipes: Recipe[], id: string): Recipe {
  const recipe = recipes.find((row) => row.id === id);
  if (!recipe) throw new Error("Recipe not found");
  return recipe;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function chicagoServiceDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export async function inventoryViews(now = new Date()) {
  const snapshot = await readInventory();
  const split = splitCatalog(snapshot.items);
  await ensureReady();
  const db = loadDb();
  const today = db.tickets.filter((ticket) => ticket.serviceDate === chicagoServiceDate(now));
  const todayIds = new Set(today.map((ticket) => ticket.recipeId));
  return {
    ...snapshot,
    ...split,
    recipes: db.recipes,
    todayRecipes: db.recipes.filter((recipe) => todayIds.has(recipe.id)),
    bakeDay: bakeDayStock(today, db.recipes, snapshot.items),
  };
}

export { readTestCookCount } from "./square";
