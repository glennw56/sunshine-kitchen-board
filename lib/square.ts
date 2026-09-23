import { randomUUID } from "crypto";
import { SQUARE_TEST_COOK } from "./constants";
import { squareAccessToken, squareApiBase } from "./config";

export type SquareAdjustResult = {
  ok: boolean;
  skipped: boolean;
  error: string | null;
  quantity: string | null;
  variationId: string;
  locationId: string;
};

type FetchLike = typeof fetch;

/**
 * The only Square call this process is allowed to make is an inventory
 * ADJUSTMENT on Test Cook variation HRFLTIDM2ZHZNXN4N4EN6WFQ at Irondale
 * L4CK6YWGT5XQX. No catalog creates, updates, or deletes. No other items.
 */
export async function adjustTestCook(
  delta: number,
  opts: { idempotencyKey?: string; occurredAt?: string; fetchImpl?: FetchLike } = {},
): Promise<SquareAdjustResult> {
  const base = {
    variationId: SQUARE_TEST_COOK.variationId,
    locationId: SQUARE_TEST_COOK.locationId,
    quantity: null as string | null,
  };
  if (!Number.isFinite(delta) || delta === 0) {
    return { ok: true, skipped: true, error: null, ...base, quantity: "0" };
  }
  const token = squareAccessToken();
  if (!token) {
    return {
      ok: false,
      skipped: true,
      error: "SQUARE_ACCESS_TOKEN is not set. Inventory was not sent to Square.",
      ...base,
    };
  }
  const quantity = Math.abs(delta);
  const body = buildTestCookAdjustment({
    delta,
    idempotencyKey: opts.idempotencyKey || `kb-${randomUUID()}`,
    occurredAt: opts.occurredAt || new Date().toISOString(),
  });
  const url = `${squareApiBase()}/v2/inventory/batch-change`;
  assertSquareRequest(url, body);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Square-Version": "2025-01-23",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      skipped: false,
      error: `Square inventory ${res.status}: ${text.slice(0, 400)}`,
      ...base,
      quantity: String(quantity),
    };
  }
  return { ok: true, skipped: false, error: null, ...base, quantity: String(quantity) };
}

export async function readTestCookCount(fetchImpl: FetchLike = fetch): Promise<{
  ok: boolean;
  quantity: string | null;
  error: string | null;
}> {
  const token = squareAccessToken();
  if (!token) return { ok: false, quantity: null, error: "SQUARE_ACCESS_TOKEN is not set" };
  const url = `${squareApiBase()}/v2/inventory/${SQUARE_TEST_COOK.variationId}?location_ids=${SQUARE_TEST_COOK.locationId}`;
  assertSquareRequest(url, null);
  const res = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Square-Version": "2025-01-23",
    },
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, quantity: null, error: `Square read ${res.status}: ${text.slice(0, 240)}` };
  const parsed = JSON.parse(text) as {
    counts?: { quantity?: string; state?: string; location_id?: string; catalog_object_id?: string }[];
  };
  const row = (parsed.counts || []).find(
    (c) =>
      c.state === "IN_STOCK" &&
      c.location_id === SQUARE_TEST_COOK.locationId &&
      c.catalog_object_id === SQUARE_TEST_COOK.variationId,
  );
  return { ok: true, quantity: row?.quantity ?? "0", error: null };
}

export function buildTestCookAdjustment(input: {
  delta: number;
  idempotencyKey: string;
  occurredAt: string;
}) {
  const up = input.delta > 0;
  const body = {
    idempotency_key: input.idempotencyKey,
    changes: [
      {
        type: "ADJUSTMENT",
        adjustment: {
          catalog_object_id: SQUARE_TEST_COOK.variationId,
          location_id: SQUARE_TEST_COOK.locationId,
          quantity: String(Math.abs(input.delta)),
          from_state: up ? "NONE" : "IN_STOCK",
          to_state: up ? "IN_STOCK" : "WASTE",
          occurred_at: input.occurredAt,
        },
      },
    ],
  };
  assertSquareRequest(`${squareApiBase()}/v2/inventory/batch-change`, body);
  return body;
}

export function assertSquareRequest(url: string, body: unknown) {
  const parsed = new URL(url);
  const allowedPaths = new Set([
    "/v2/inventory/batch-change",
    `/v2/inventory/${SQUARE_TEST_COOK.variationId}`,
  ]);
  if (!allowedPaths.has(parsed.pathname)) {
    throw new Error(`Square client refused path ${parsed.pathname}`);
  }
  if (parsed.pathname.includes("/catalog")) {
    throw new Error("Square catalog API is forbidden");
  }
  const loc = parsed.searchParams.get("location_ids") || parsed.searchParams.get("location_id");
  if (loc && loc !== SQUARE_TEST_COOK.locationId) {
    throw new Error("Square client refused a non-Irondale location");
  }
  // Homebased is inactive. The literal stays in this file so the guard cannot drift.
  const forbiddenLocation = "L6XDJSQS6NY54";
  if (SQUARE_TEST_COOK.forbiddenLocationId !== forbiddenLocation) {
    throw new Error("Square forbidden location constant drifted");
  }
  if (url.includes(forbiddenLocation)) {
    throw new Error("Square client refused the inactive Homebased location");
  }
  if (body == null) return;
  const serialized = JSON.stringify(body);
  if (serialized.includes(forbiddenLocation)) {
    throw new Error("Square payload included the inactive Homebased location");
  }
  if (serialized.includes(SQUARE_TEST_COOK.itemId)) {
    throw new Error("Square payload must not reference the catalog item id; use the variation only");
  }
  if (!serialized.includes(SQUARE_TEST_COOK.variationId)) {
    throw new Error("Square payload missing the Test Cook variation");
  }
  if (!serialized.includes(SQUARE_TEST_COOK.locationId)) {
    throw new Error("Square payload missing the Irondale location");
  }
  const ids = serialized.match(/[A-Z0-9]{20,}/g) || [];
  for (const id of ids) {
    if (id !== SQUARE_TEST_COOK.variationId) {
      throw new Error(`Square payload contained an unexpected id ${id}`);
    }
  }
}
