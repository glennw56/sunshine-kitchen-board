import { inventoryGcsBucket, inventoryGcsObject } from "../config";
import type { CatalogItem } from "../types";
import { applyDeltaToDocument, extractCatalog } from "./normalize";

type GcsRead = {
  document: unknown;
  items: CatalogItem[];
  generation?: string;
};

async function accessToken(): Promise<string> {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) return process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  const res = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!res.ok) {
    throw new Error(
      `GCS token unavailable (${res.status}). On Cloud Run the runtime service account needs storage access to the inventory bucket, or set GOOGLE_OAUTH_ACCESS_TOKEN for local tests.`,
    );
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("GCS token response had no access_token");
  return body.access_token;
}

function objectUrl(bucket: string, object: string, extra = ""): string {
  const name = encodeURIComponent(object);
  return `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${name}${extra}`;
}

export async function readGcsCatalog(): Promise<GcsRead> {
  const bucket = inventoryGcsBucket();
  const object = inventoryGcsObject();
  if (!bucket) throw new Error("INVENTORY_GCS_BUCKET is not set");
  const token = await accessToken();
  const metaRes = await fetch(objectUrl(bucket, object), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) {
    throw new Error(`GCS catalog metadata ${metaRes.status}: ${(await metaRes.text()).slice(0, 300)}`);
  }
  const meta = (await metaRes.json()) as { generation?: string };
  const media = await fetch(objectUrl(bucket, object, "?alt=media"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!media.ok) {
    throw new Error(`GCS catalog read ${media.status}: ${(await media.text()).slice(0, 300)}`);
  }
  const document = (await media.json()) as unknown;
  return { document, items: extractCatalog(document), generation: meta.generation };
}

export async function adjustGcsCatalog(deltas: { sku: string; delta: number }[]) {
  const bucket = inventoryGcsBucket();
  const object = inventoryGcsObject();
  const current = await readGcsCatalog();
  const next = applyDeltaToDocument(current.document, deltas);
  const token = await accessToken();
  const params = new URLSearchParams({
    uploadType: "media",
    name: object,
  });
  if (current.generation) params.set("ifGenerationMatch", current.generation);
  const res = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?${params.toString()}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(next.document),
    },
  );
  if (!res.ok) {
    throw new Error(`GCS catalog write ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  return next.applied;
}
