import fs from "fs";
import path from "path";
import { dataDir } from "../config";
import type { CatalogItem } from "../types";
import { applyDeltaToDocument, extractCatalog } from "./normalize";

function catalogPath(): string {
  return path.join(dataDir(), "dev-catalog.json");
}

function seedFile(): string {
  return path.join(process.cwd(), "fixtures", "dev-catalog.json");
}

export function ensureFileCatalog() {
  const target = catalogPath();
  if (fs.existsSync(target)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const source = seedFile();
  if (fs.existsSync(source)) fs.copyFileSync(source, target);
  else fs.writeFileSync(target, JSON.stringify({ items: [] }, null, 2));
}

export function readFileCatalog(): { items: CatalogItem[]; document: unknown } {
  ensureFileCatalog();
  const document = JSON.parse(fs.readFileSync(catalogPath(), "utf8")) as unknown;
  return { items: extractCatalog(document), document };
}

export function adjustFileCatalog(deltas: { sku: string; delta: number }[]) {
  const { document } = readFileCatalog();
  const next = applyDeltaToDocument(document, deltas);
  fs.writeFileSync(catalogPath(), JSON.stringify(next.document, null, 2));
  return next.applied;
}
