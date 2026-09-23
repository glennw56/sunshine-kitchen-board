"use client";

import { useMemo, useState } from "react";
import type { CatalogItem, Recipe } from "@/lib/types";

export function RawClient({
  items,
  all,
  recipes,
  error,
  transport,
  health,
}: {
  items: CatalogItem[];
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
    return items.filter((item) => !q || `${item.sku} ${item.name} ${item.category}`.toLowerCase().includes(q));
  }, [items, query]);

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
      <p className="meta">Same inventory truth as sunshine-inventory-test. Transport: {transport}. {health}</p>
      {message ? <p className="error">{message}</p> : null}
      <input className="search" placeholder="Search raw SKUs" value={query} onChange={(e) => setQuery(e.target.value)} />
      <section className="card">
        <h2>On hand</h2>
        {shown.length === 0 ? <p>No raw items in this view.</p> : null}
        {shown.map((item) => (
          <div className="list-item" key={item.sku}>
            <div>
              <strong>{item.name}</strong>
              <div className="meta">{item.sku} · {item.category || "uncategorized"}</div>
            </div>
            <div className="row">
              <span className="qty">{item.onHand} {item.unit}</span>
              <button className="btn secondary" disabled={pending} onClick={() => adjust(item.sku, -1)}>-1</button>
              <button className="btn" disabled={pending} onClick={() => adjust(item.sku, 1)}>+1</button>
            </div>
          </div>
        ))}
      </section>
      <section className="card">
        <h2>Link recipe lines</h2>
        <p className="meta">Point each line at a SKU that already exists in the catalog. Unknown SKUs are refused.</p>
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
