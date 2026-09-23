import { inventoryGcsBucket, inventoryTransport } from "../config";
import type { CatalogItem } from "../types";
import { adjustFileCatalog, readFileCatalog } from "./file";
import { adjustGcsCatalog, readGcsCatalog } from "./gcs";
import { InventoryHttp } from "./http";
import { isCookedCategory } from "./normalize";

export type InventorySnapshot = {
  transport: string;
  items: CatalogItem[];
  error: string | null;
  health: string | null;
};

export async function readInventory(): Promise<InventorySnapshot> {
  const transport = resolveTransport();
  try {
    if (transport === "file") {
      const { items } = readFileCatalog();
      return { transport, items, error: null, health: "local dev catalog (not the live shop)" };
    }
    if (transport === "gcs") {
      const read = await readGcsCatalog();
      return { transport, items: read.items, error: null, health: "gcs catalog.json" };
    }
    const http = new InventoryHttp();
    const health = await http.health();
    const loaded = await http.load();
    return {
      transport: `http:${loaded.mode}`,
      items: loaded.items,
      error: null,
      health: health.detail,
    };
  } catch (error) {
    return {
      transport,
      items: [],
      error: error instanceof Error ? error.message : String(error),
      health: null,
    };
  }
}

export async function adjustInventory(deltas: { sku: string; delta: number }[]) {
  const nonzero = deltas.filter((d) => d.delta !== 0);
  if (!nonzero.length) return [];
  const transport = resolveTransport();
  if (transport === "file") return adjustFileCatalog(nonzero);
  if (transport === "gcs") return adjustGcsCatalog(nonzero);
  const http = new InventoryHttp();
  return http.adjust(nonzero);
}

export function splitCatalog(items: CatalogItem[]): { raw: CatalogItem[]; cooked: CatalogItem[] } {
  const raw: CatalogItem[] = [];
  const cooked: CatalogItem[] = [];
  for (const item of items) {
    if (isCookedCategory(item.category)) cooked.push(item);
    else raw.push(item);
  }
  return { raw, cooked };
}

function resolveTransport(): "file" | "http" | "gcs" {
  const mode = inventoryTransport();
  if (mode === "file" || mode === "http" || mode === "gcs") return mode;
  if (process.env.INVENTORY_EMAIL || process.env.INVENTORY_PASSWORD) return "http";
  if (inventoryGcsBucket()) return "gcs";
  if (process.env.NODE_ENV === "production") return "http";
  return "file";
}
