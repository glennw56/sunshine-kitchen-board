"use client";

import { useMemo, useState } from "react";
import type { BakeDayStockLine, CatalogItem, Recipe } from "@/lib/types";

export function RawClient({
  lines,
  all,
  recipes,
  error,
  transport,
  health,
}: {
  lines: BakeDayStockLine[];
  all: CatalogItem[];
  recipes: Recipe[];
  error: string | null;
  transport: string;
  health: string | null;
}) {
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(error);
  const [pending, setPending] = useState(false);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter((line) => !q || `${line.sku} ${line.name}`.toLowerCase().includes(q));
  }, [lines, query]);

  async function adjust(sku: string, delta: number) {
    setPending(true);
    setMessage(null);
    const res = await fetch("/api/inventory/raw", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku, delta }),
    });
    const body = await res.json();
    setPending(false);
    if (!res.ok || body.ok === false) {
      setMessage(body.error || "Adjust failed");
      return;
    }
    location.reload();
  }

  async function link(recipeId: string, ingredientId: string, sku: string) {
    setPending(true);
    const res = await fetch("/api/recipes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipeId, ingredientId, sku }),
    });
    const body = await res.json();
    setPending(false);
    if (!res.ok || body.ok === false) {
      setMessage(body.error || "Could not link SKU");
      return;
    }
    location.reload();
  }

  return (
    <div>
      <p className="meta">
        Today&apos;s recipe ingredients only, from the same inventory as sunshine-inventory-test. Transport: {transport}. {health} Full catalog browsing stays in the inventory app.
      </p>
      {message ? <p className="error">{message}</p> : null}
      <input className="search" placeholder="Search today's raw SKUs" value={query} onChange={(e) => setQuery(e.target.value)} />
      <section className="card">
        <h2>On hand</h2>
        {shown.length === 0 ? <p>No raw ingredients on today&apos;s tickets.</p> : null}
        {shown.map((line) => (
          <div className="list-item" key={line.sku}>
            <div>
              <strong>{line.name}</strong>
              <div className="meta">
                {line.sku}
                {line.missing ? " · not in catalog" : ` · need ${line.need} ${line.unit}`}
              </div>
            </div>
            <div className="row">
              <span className="qty">{line.missing || line.onHand === null ? "—" : `${line.onHand} ${line.unit}`}</span>
              {line.missing ? null : (
                <>
                  <button className="btn secondary" disabled={pending} onClick={() => adjust(line.sku, -1)}>-1</button>
                  <button className="btn" disabled={pending} onClick={() => adjust(line.sku, 1)}>+1</button>
                </>
              )}
            </div>
          </div>
        ))}
      </section>
      <section className="card">
        <h2>Link recipe lines</h2>
        <p className="meta">
          Point each line at a SKU that already exists. This picker is for linking, not browsing. Unknown SKUs are refused. Open sunshine-inventory-test for the full catalog.
        </p>
        {recipes.map((recipe) => (
          <div key={recipe.id}>
            <h3>{recipe.name}</h3>
            {recipe.ingredients.map((line) => (
              <div className="list-item" key={line.id}>
                <div>
                  {line.qty} {line.unit} {line.name}
                  <div className="meta">SKU {line.sku}</div>
                </div>
                <select
                  aria-label={`Link ${line.name}`}
                  defaultValue={line.sku}
                  onChange={(event) => link(recipe.id, line.id, event.target.value)}
                >
                  {all.map((item) => (
                    <option key={item.sku} value={item.sku}>{item.sku} · {item.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
