"use client";

import { useEffect, useMemo, useState } from "react";
import { OverdueSound } from "./OverdueSound";

type Shortage = {
  sku: string;
  name: string;
  need: number;
  onHand: number;
  unit: string;
  missingSku: boolean;
};

type Card = {
  ticket: {
    id: string;
    status: string;
    assignee: string | null;
    dueAt: string;
    batches: number;
    stockMoved: boolean;
    squareMoved: boolean;
    squareError: string | null;
  };
  recipe: {
    name: string;
    batchSize: number;
    batchUnit: string;
    prepMinutes: number;
    ingredients: { name: string; qty: number; unit: string; sku: string }[];
    steps: { id: string; text: string; minutes: number; station: string | null; movesStock: boolean }[];
  } | null;
  shortages: Shortage[];
  timing: string;
  overdue: boolean;
  alert: { lastError: string | null; count: number } | null;
};

type StockLine = {
  sku: string;
  name: string;
  unit: string;
  onHand: number | null;
  need: number;
  missing: boolean;
  short: boolean;
};

type Snapshot = {
  cards: Card[];
  onTheFloor: { ticketId: string; recipe: string; assignee: string | null; status: string; timing: string }[];
  inventoryError: string | null;
  settings: { overdueBufferMinutes: number; realertMinutes: number };
  bakeDay: { raw: StockLine[]; cooked: StockLine[] };
};

export function BoardClient({ initial }: { initial: Snapshot }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const overdueCount = data.cards.filter((card) => card.overdue).length;

  async function reload() {
    const res = await fetch("/api/board", { cache: "no-store" });
    const body = await res.json();
    if (body.ok) setData(body);
  }

  useEffect(() => {
    const timer = setInterval(() => {
      void fetch("/api/alerts", { method: "POST" }).then(() => reload());
    }, 30_000);
    void fetch("/api/alerts", { method: "POST" }).then(() => reload());
    return () => clearInterval(timer);
  }, []);

  const floor = useMemo(() => data.onTheFloor, [data]);

  async function act(action: string, ticketId: string, extra: Record<string, unknown> = {}) {
    setPending(`${action}:${ticketId}`);
    setError(null);
    const res = await fetch("/api/board", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ticketId, ...extra }),
    });
    const body = await res.json();
    setPending(null);
    if (!res.ok || body.ok === false) {
      if (body.shortages) {
        setConfirmId(ticketId);
        setError("Short on ingredients. Start anyway only if the floor can cover it.");
        return;
      }
      setError(body.error || "Could not update the ticket");
      return;
    }
    setConfirmId(null);
    if (body.squareError) setError(`Inventory moved. Square: ${body.squareError}`);
    await reload();
  }

  return (
    <div className="board">
      <OverdueSound count={overdueCount} />
      <p className="meta">
        Late means still open {data.settings.overdueBufferMinutes} min past due. Slack re-alerts every{" "}
        {data.settings.realertMinutes} min.
      </p>
      {data.inventoryError ? <p className="error">{data.inventoryError}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {overdueCount > 0 ? (
        <div className="banner">{overdueCount} ticket{overdueCount === 1 ? "" : "s"} overdue. Sound is armed on this board.</div>
      ) : null}
      <div className="cards board-tickets">
        {data.cards.map((card) => (
          <article className="card" key={card.ticket.id} id={card.ticket.id}>
            <div className="ticket-top">
              <div>
                <div className="row">
                  {card.timing === "late" || card.timing === "early" || card.timing === "on-time" ? (
                    <span className={`badge ${card.timing === "late" ? "late" : card.timing === "early" ? "early" : ""}`}>
                      {card.timing}
                    </span>
                  ) : null}
                  <span className="badge">{card.ticket.status}</span>
                  {card.ticket.assignee ? <span className="badge">{card.ticket.assignee}</span> : null}
                </div>
                <h2>{card.recipe?.name ?? "Recipe"}</h2>
                <p className="meta">
                  {card.recipe ? `${card.recipe.batchSize} ${card.recipe.batchUnit}` : ""}
                  {" · "}prep {card.recipe?.prepMinutes ?? "?"} min
                </p>
              </div>
              <p className="due">
                {new Date(card.ticket.dueAt).toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })}
              </p>
            </div>
            {card.shortages.length > 0 && card.ticket.status !== "done" ? (
              <div className="banner">
                {card.shortages.map((line) => (
                  <div key={line.sku}>
                    {line.missingSku
                      ? `${line.sku} is not in the inventory catalog`
                      : `${line.name}: have ${line.onHand} ${line.unit}, need ${line.need}`}
                  </div>
                ))}
              </div>
            ) : null}
            {card.ticket.squareError ? <p className="error">Square: {card.ticket.squareError}</p> : null}
            {card.alert?.lastError ? <p className="error">Slack auto-alert: {card.alert.lastError}</p> : null}
            <div className="actions">
              <button className="btn" disabled={pending !== null || card.ticket.status === "done"} onClick={() => act("claim", card.ticket.id)}>
                Claim
              </button>
              <button className="btn secondary" disabled={pending !== null || card.ticket.status === "done"} onClick={() => act("start", card.ticket.id, { ackShortage: confirmId === card.ticket.id })}>
                {confirmId === card.ticket.id ? "Start anyway" : "Start"}
              </button>
              <button className="btn done" disabled={pending !== null || card.ticket.status === "done"} onClick={() => act("done", card.ticket.id)}>
                Done
              </button>
            </div>
            <div className="row extra-actions">
              <button className="btn ghost" disabled={pending !== null} onClick={() => act("nudge", card.ticket.id)}>
                Slack nudge
              </button>
              {card.ticket.stockMoved && !card.ticket.squareMoved ? (
                <button className="btn ghost" disabled={pending !== null} onClick={() => act("square-retry", card.ticket.id)}>
                  Retry Square
                </button>
              ) : null}
            </div>
            {card.recipe ? (
              <ol className="steps">
                {card.recipe.steps.map((step) => (
                  <li key={step.id}>
                    {step.text} · {step.minutes} min
                    {step.station ? ` · ${step.station}` : ""}
                    {step.movesStock ? " · moves stock" : ""}
                  </li>
                ))}
              </ol>
            ) : null}
          </article>
        ))}
      </div>
      <section className="card board-floor">
        <h2>Who&apos;s on what</h2>
        {floor.length === 0 ? <p className="meta">Nobody has a claimed ticket.</p> : null}
        {floor.map((row) => (
          <div className="list-item" key={row.ticketId}>
            <div>
              <strong>{row.assignee || "Unassigned"}</strong>
              <div className="meta">{row.recipe}</div>
            </div>
            <span className={`badge ${row.timing === "late" ? "late" : ""}`}>{row.status} · {row.timing}</span>
          </div>
        ))}
      </section>
      <p className="meta board-stock-note">
        On-hand for ingredients and finished items on today&apos;s tickets. The full catalog stays in sunshine-inventory-test.
      </p>
      <div className="stock-split board-stock" data-testid="bake-day-stock">
        <StockStrip title="Raw on hand" lines={data.bakeDay.raw} />
        <StockStrip title="Cooked on hand" lines={data.bakeDay.cooked} />
      </div>
    </div>
  );
}

function StockStrip({ title, lines }: { title: string; lines: StockLine[] }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {lines.length === 0 ? <p className="meta">Nothing on today&apos;s tickets.</p> : null}
      <div className="stock-grid">
        {lines.map((line) => (
          <div className={`stock-chip${line.short || line.missing ? " short" : ""}`} key={line.sku}>
            <strong>{line.name}</strong>
            <div className="qty">
              {line.missing || line.onHand === null ? "—" : line.onHand}
              <span className="unit">{line.unit}</span>
            </div>
            <div className="meta">{line.missing ? "not in catalog" : `need ${line.need} ${line.unit}`}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
