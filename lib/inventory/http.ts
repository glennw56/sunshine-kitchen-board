import { inventoryBaseUrl, inventoryCredentials } from "../config";
import type { CatalogItem } from "../types";
import { applyDeltaToDocument, CatalogMissError, extractCatalog, extractCatalogFromText } from "./normalize";

type FetchLike = typeof fetch;

/**
 * sunshine-inventory-test integration, discovered against the live test app:
 * - GET /api/health is public and reports dataDir /data plus catalog.json.
 * - POST /api/import requires HTTP Basic (realm "Sunshine inventory") and returns
 *   401 {"ok":false,"error":"Admin sign-in required"} without credentials.
 * - The shop UI is a Next.js server-action login (email + password). After a
 *   session cookie, catalog rows are read from the authenticated RSC payload.
 * - Unknown /api routes redirect to /login, so this client does not invent
 *   extra paths beyond health, import, and the authenticated shop page.
 *
 * Writes never append SKUs. A full-document import is used only when the read
 * returned a JSON document we can round-trip. Otherwise we POST a delta body
 * and surface the server's error if the schema differs.
 */
export class InventoryHttp {
  constructor(
    private readonly base = inventoryBaseUrl(),
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async health(): Promise<{ ok: boolean; detail: string }> {
    const res = await this.fetchImpl(`${this.base}/api/health`, { cache: "no-store" });
    const text = await res.text();
    if (!res.ok) return { ok: false, detail: text.slice(0, 200) };
    return { ok: true, detail: text.slice(0, 300) };
  }

  async load(): Promise<{ items: CatalogItem[]; document: unknown | null; mode: string }> {
    const creds = inventoryCredentials();
    if (!creds) {
      throw new Error(
        "Inventory login is not configured. Set INVENTORY_EMAIL and INVENTORY_PASSWORD to the sunshine-inventory-test admin.",
      );
    }
    const health = await this.health();
    if (!health.ok) throw new Error(`Inventory health failed: ${health.detail}`);

    const basic = await this.tryJson([
      { method: "GET", path: "/api/export", auth: "basic" },
      { method: "GET", path: "/api/catalog", auth: "basic" },
    ], creds);
    if (basic) return basic;

    const cookie = await this.login(creds);
    const sessionJson = await this.tryJson(
      [
        { method: "GET", path: "/api/export", auth: "cookie" },
        { method: "GET", path: "/", auth: "cookie" },
      ],
      creds,
      cookie,
    );
    if (sessionJson && sessionJson.items.length) return sessionJson;

    const rsc = await this.fetchImpl(`${this.base}/?_rsc=kitchen`, {
      headers: { cookie, Accept: "text/x-component", RSC: "1" },
      redirect: "follow",
      cache: "no-store",
    });
    const text = await rsc.text();
    const items = extractCatalogFromText(text);
    if (!items.length) {
      throw new Error(
        "Signed into inventory but no catalog rows were found. Confirm the admin can open the shop, and that catalog.json has sku + onHand fields.",
      );
    }
    return { items, document: null, mode: "rsc" };
  }

  async adjust(deltas: { sku: string; delta: number }[]): Promise<{ sku: string; onHand: number }[]> {
    const creds = inventoryCredentials();
    if (!creds) {
      throw new Error("INVENTORY_EMAIL and INVENTORY_PASSWORD are required to write inventory.");
    }
    const loaded = await this.load();
    for (const delta of deltas) {
      if (!loaded.items.some((item) => item.sku === delta.sku)) {
        throw new CatalogMissError(delta.sku);
      }
    }

    if (loaded.document) {
      const next = applyDeltaToDocument(loaded.document, deltas);
      const posted = await this.postImport(creds, next.document);
      if (posted.ok) return next.applied;
    }

    const deltaBody = {
      adjustments: deltas.map((d) => ({ sku: d.sku, delta: d.delta, reason: "sunshine-kitchen-board" })),
    };
    const deltaPost = await this.postImport(creds, deltaBody);
    if (deltaPost.ok) {
      return deltas.map((d) => {
        const current = loaded.items.find((item) => item.sku === d.sku);
        return { sku: d.sku, onHand: (current?.onHand ?? 0) + d.delta };
      });
    }
    throw new Error(
      `Inventory write was refused. Import response: ${deltaPost.detail}. No free-floating SKU was created.`,
    );
  }

  private async postImport(
    creds: { email: string; password: string },
    body: unknown,
  ): Promise<{ ok: boolean; detail: string }> {
    const res = await this.fetchImpl(`${this.base}/api/import`, {
      method: "POST",
      headers: {
        Authorization: basicHeader(creds),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const detail = (await res.text()).slice(0, 500);
    return { ok: res.ok, detail: `${res.status} ${detail}` };
  }

  private async login(creds: { email: string; password: string }): Promise<string> {
    const loginPage = await this.fetchImpl(`${this.base}/login`, { cache: "no-store" });
    const html = await loginPage.text();
    const action = html.match(/\$ACTION_ID_([0-9a-f]{20,})/)?.[1];
    if (!action) throw new Error("Inventory login page did not expose a server action id");
    const boundary = `----kb${Math.random().toString(16).slice(2)}`;
    const chunks = [
      field(boundary, `_1_$ACTION_ID_${action}`, ""),
      field(boundary, "_1_email", creds.email),
      field(boundary, "_1_password", creds.password),
      field(boundary, "0", '["$K1"]'),
      `--${boundary}--\r\n`,
    ];
    const res = await this.fetchImpl(`${this.base}/login`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        accept: "text/x-component",
        "next-action": action,
        "next-router-state-tree": encodeURIComponent(
          '["",{"children":["login",{"children":["__PAGE__",{},null,null,4096]},null,null,4096]},null,null,4112]',
        ),
      },
      body: chunks.join(""),
    });
    const text = await res.text();
    if (text.includes("doesn't match") || text.includes("does not match")) {
      throw new Error("Inventory admin email or password was rejected");
    }
    const set = res.headers.getSetCookie?.() ?? [];
    const cookie = set
      .map((row) => row.split(";")[0])
      .filter(Boolean)
      .join("; ");
    if (!cookie) {
      throw new Error(
        `Inventory login did not set a session cookie (${res.status}). ${text.slice(0, 180)}`,
      );
    }
    return cookie;
  }

  private async tryJson(
    attempts: { method: string; path: string; auth: "basic" | "cookie" }[],
    creds: { email: string; password: string },
    cookie = "",
  ): Promise<{ items: CatalogItem[]; document: unknown; mode: string } | null> {
    for (const attempt of attempts) {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (attempt.auth === "basic") headers.Authorization = basicHeader(creds);
      if (attempt.auth === "cookie") headers.cookie = cookie;
      const res = await this.fetchImpl(`${this.base}${attempt.path}`, {
        method: attempt.method,
        headers,
        redirect: "manual",
        cache: "no-store",
      });
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !type.includes("json")) continue;
      const document = (await res.json()) as unknown;
      const items = extractCatalog(document);
      if (items.length) return { items, document, mode: attempt.path };
    }
    return null;
  }
}

function basicHeader(creds: { email: string; password: string }): string {
  return `Basic ${Buffer.from(`${creds.email}:${creds.password}`).toString("base64")}`;
}

function field(boundary: string, name: string, value: string): string {
  return `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
}
