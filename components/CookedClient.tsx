"use client";

import { useState } from "react";
import type { BakeDayStockLine } from "@/lib/types";

export function CookedClient({
  lines,
  error,
  transport,
  square,
}: {
  lines: BakeDayStockLine[];
  error: string | null;
  transport: string;
  square: { ok: boolean; quantity: string | null; error: string | null; label: string };
}) {
  const selectable = lines.filter((line) => !line.missing);
  const [sku, setSku] = useState(selectable[0]?.sku ?? "");
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
      <p className="meta">
        Today&apos;s finished items only, and only SKUs already in the tax-exempt catalog. Transport: {transport}. Full catalog browsing stays in sunshine-inventory-test.
      </p>
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
            {selectable.map((line) => (
              <option key={line.sku} value={line.sku}>{line.name} ({line.sku})</option>
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
        {lines.length === 0 ? <p>No finished items on today&apos;s tickets.</p> : null}
        {lines.map((line) => (
          <div className="list-item" key={line.sku}>
            <div>
              <strong>{line.name}</strong>
              <div className="meta">{line.missing ? `${line.sku} · not in catalog` : line.sku}</div>
            </div>
            <span className="qty">{line.missing || line.onHand === null ? "—" : `${line.onHand} ${line.unit}`}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
