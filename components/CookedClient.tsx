"use client";

import { useState } from "react";
import type { CatalogItem } from "@/lib/types";

export function CookedClient({
  items,
  error,
  transport,
  square,
}: {
  items: CatalogItem[];
  error: string | null;
  transport: string;
  square: { ok: boolean; quantity: string | null; error: string | null; label: string };
}) {
  const [sku, setSku] = useState(items[0]?.sku ?? "");
  const [qty, setQty] = useState(1);
  const [message, setMessage] = useState<string | null>(error);
  const [pending, setPending] = useState(false);

  async function move(mode: "add" | "remove" | "pull") {
    setPending(true);
    setMessage(null);
    const res = await fetch("/api/inventory/cooked", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku, qty, mode }),
    });
    const body = await res.json();
    setPending(false);
    if (!res.ok || body.ok === false) {
      setMessage(body.error || "Cooked move refused");
      return;
    }
    if (body.squareError) setMessage(`Catalog updated. Square: ${body.squareError}`);
    else location.reload();
  }

  return (
    <div>
      <p className="meta">Cooked goods only, and only SKUs already in the tax-exempt catalog. Transport: {transport}.</p>
      <section className="card">
        <h2>Square Test Cook</h2>
        <p>{square.label}</p>
        <p className="qty">{square.quantity ?? "—"} in stock at Irondale</p>
        {square.error ? <p className="error">{square.error}</p> : null}
        <p className="meta">Adds, removes, and pulls also adjust this one variation. Nothing else in Square is touched.</p>
      </section>
      {message ? <p className="error">{message}</p> : null}
      <section className="card">
        <h2>Move cooked stock</h2>
        <div className="row">
          <select aria-label="Cooked SKU" value={sku} onChange={(e) => setSku(e.target.value)}>
            {items.map((item) => (
              <option key={item.sku} value={item.sku}>{item.name} ({item.sku})</option>
            ))}
          </select>
          <input aria-label="Quantity" type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
          <button className="btn" disabled={pending || !sku} onClick={() => move("add")}>Add cooked</button>
          <button className="btn secondary" disabled={pending || !sku} onClick={() => move("remove")}>Remove cooked</button>
          <button className="btn ghost" disabled={pending || !sku} onClick={() => move("pull")}>Pull</button>
        </div>
      </section>
      <section className="card">
        <h2>Finished on hand</h2>
        {items.length === 0 ? <p>No cooked/finished category in the catalog yet. Add the SKU in inventory first.</p> : null}
        {items.map((item) => (
          <div className="list-item" key={item.sku}>
            <div>
              <strong>{item.name}</strong>
              <div className="meta">{item.sku} · {item.category}</div>
            </div>
            <span className="qty">{item.onHand} {item.unit}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
