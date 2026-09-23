import { COOKED_CATEGORY_PATTERN } from "../constants";
import type { CatalogItem } from "../types";

const QTY_KEYS = ["onHand", "on_hand", "qtyOnHand", "quantityOnHand", "inStock", "count", "qty", "quantity"];

export function isCookedCategory(category: string): boolean {
  return COOKED_CATEGORY_PATTERN.test(category || "");
}

export function normalizeItem(input: Record<string, unknown>): CatalogItem | null {
  const sku = stringField(input, ["sku", "SKU", "id", "code", "itemSku"]);
  if (!sku) return null;
  const name = stringField(input, ["name", "title", "description", "itemName"]) || sku;
  const category = stringField(input, ["category", "cat", "department", "group", "location", "bin"]) || "";
  const unit = stringField(input, ["unit", "uom", "units"]) || "";
  const qtyKey = QTY_KEYS.find((key) => typeof input[key] === "number" || isNumericString(input[key]));
  const onHand = qtyKey ? Number(input[qtyKey]) : 0;
  return {
    sku,
    name,
    onHand: Number.isFinite(onHand) ? onHand : 0,
    unit,
    category,
    qtyKey: qtyKey || "onHand",
  };
}

export function extractCatalog(payload: unknown): CatalogItem[] {
  const found: CatalogItem[] = [];
  const seen = new Set<string>();
  walk(payload, (obj) => {
    const item = normalizeItem(obj);
    if (!item || seen.has(item.sku)) return;
    seen.add(item.sku);
    found.push(item);
  });
  return found;
}

export function extractCatalogFromText(text: string): CatalogItem[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return extractCatalog(JSON.parse(trimmed));
    } catch {
      /* fall through to scan */
    }
  }
  const items: CatalogItem[] = [];
  const seen = new Set<string>();
  const re = /\{[^{}]*"(?:sku|SKU|onHand|on_hand)"[^{}]*\}/g;
  for (const match of text.matchAll(re)) {
    try {
      const obj = JSON.parse(match[0]) as Record<string, unknown>;
      const item = normalizeItem(obj);
      if (!item || seen.has(item.sku)) continue;
      seen.add(item.sku);
      items.push(item);
    } catch {
      /* ignore fragments */
    }
  }
  return items;
}

/**
 * Apply a delta to the original catalog document.
 * Refuses SKUs that are not already present. Does not append items.
 */
export function applyDeltaToDocument(
  document: unknown,
  deltas: { sku: string; delta: number }[],
): { document: unknown; applied: { sku: string; onHand: number }[] } {
  const clone = structuredClone(document);
  const applied: { sku: string; onHand: number }[] = [];
  for (const change of deltas) {
    const hit = findSkuObject(clone, change.sku);
    if (!hit) {
      throw new CatalogMissError(change.sku);
    }
    const key =
      QTY_KEYS.find((k) => typeof hit[k] === "number" || isNumericString(hit[k])) || "onHand";
    const current = Number(hit[key] ?? 0);
    const next = roundQty(current + change.delta);
    hit[key] = next;
    applied.push({ sku: change.sku, onHand: next });
  }
  return { document: clone, applied };
}

export class CatalogMissError extends Error {
  sku: string;
  constructor(sku: string) {
    super(
      `SKU "${sku}" is not in the tax-exempt inventory catalog. Add it in sunshine-inventory-test first. This move was refused.`,
    );
    this.sku = sku;
    this.name = "CatalogMissError";
  }
}

function findSkuObject(node: unknown, sku: string): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const entry of node) {
      const hit = findSkuObject(entry, sku);
      if (hit) return hit;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  const item = normalizeItem(obj);
  if (item && item.sku === sku) return obj;
  for (const value of Object.values(obj)) {
    const hit = findSkuObject(value, sku);
    if (hit) return hit;
  }
  return null;
}

function walk(node: unknown, visit: (obj: Record<string, unknown>) => void) {
  if (Array.isArray(node)) {
    for (const entry of node) walk(entry, visit);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  visit(obj);
  for (const value of Object.values(obj)) walk(value, visit);
}

function stringField(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function isNumericString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
}

function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000;
}
