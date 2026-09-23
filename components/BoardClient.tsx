"use client";

import { useEffect, useState } from "react";
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
    qtyMade: number | null;
    stockMoved: boolean;
    squareMoved: boolean;
    squareError: string | null;
  };
  recipe: {
    name: string;
    yieldQty: number;
    batchSize: number;
    batchUnit: string;
    prepMinutes: number;
    ingredients: { name: string; qty: number; unit: string; sku: string }[];
    steps: { id: string; text: string; minutes: number; station: string | null; movesStock: boolean }[];
  } | null;
  shortages: Shortage[];
  startAt: string;
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
  inventoryError: string | null;
  settings: { overdueBufferMinutes: number; realertMinutes: number };
  bakeDay: { raw: StockLine[]; cooked: StockLine[] };
};

export function BoardClient({ initial }: { initial: Snapshot }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [qtyPrompt, setQtyPrompt] = useState<string | null>(null);
  const [qty, setQty] = useState("");
  const [cooks, setCooks] = useState<string[]>([]);
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

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/live?kitchenOnly=1", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: { punchedIn?: { name?: string }[] }) => {
        if (cancelled || !Array.isArray(body.punchedIn)) return;
        const names = body.punchedIn
          .map((person) => person.name?.trim())
          .filter((name): name is string => Boolean(name));
        setCooks([...new Set(names)]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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
    if (action === "done") setQtyPrompt(null);
    if (body.squareError) setError(`Inventory moved. Square: ${body.squareError}`);
    await reload();
  }

  function askDone(ticketId: string) {
    setOpenId(ticketId);
    setQtyPrompt(ticketId);
    setQty("");
    setError(null);
  }

  function confirmDone(ticketId: string) {
    const amount = Number(qty);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter how many you made.");
      return;
    }
    void act("done", ticketId, { qtyMade: amount });
  }

  return (
    <div className="board">
      <OverdueSound count={overdueCount} />
      <h2 className="today-heading">Today</h2>
      {cooks.length > 0 ? (
        <div className="clocked-in" aria-label="Cooks clocked in">
          {cooks.map((name) => (
            <span className="badge" key={name}>{name}</span>
          ))}
        </div>
      ) : null}
      {data.inventoryError ? <p className="error">{data.inventoryError}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {overdueCount > 0 ? (
        <div className="banner">{overdueCount} task{overdueCount === 1 ? "" : "s"} overdue.</div>
      ) : null}
      <ul className="schedule" data-testid="day-schedule">
        {data.cards.length === 0 ? <li className="meta schedule-empty">Nothing on today's board.</li> : null}
        {data.cards.map((card) => {
          const open = openId === card.ticket.id;
          const name = card.recipe?.name ?? "Task";
          const planned = card.recipe ? card.recipe.yieldQty * card.ticket.batches : null;
          return (
            <li key={card.ticket.id} id={card.ticket.id}>
              <button
                type="button"
                className={`schedule-row${open ? " open" : ""}${card.overdue ? " late" : ""}`}
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : card.ticket.id)}
              >
                <span className="due">{clockLabel(card.startAt)}</span>
                <span className="schedule-name">{name}</span>
                <span className={`badge ${card.overdue || card.timing === "late" ? "late" : ""}`}>{card.ticket.status}</span>
              </button>
              {open ? (
                <div className="schedule-detail">
                  <p className="meta">
                    Start {clockLabel(card.startAt)}
                    {" · "}due {clockLabel(card.ticket.dueAt)}
                    {card.recipe ? ` · ${card.recipe.batchSize} ${card.recipe.batchUnit}` : ""}
                    {planned != null ? ` · plan ${planned}` : ""}
                    {card.ticket.assignee ? ` · ${card.ticket.assignee}` : ""}
                    {card.ticket.qtyMade != null ? ` · made ${card.ticket.qtyMade}` : ""}
                  </p>
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
                  {qtyPrompt === card.ticket.id ? (
                    <form
                      className="qty-prompt"
                      onSubmit={(event) => {
                        event.preventDefault();
                        confirmDone(card.ticket.id);
                      }}
                    >
                      <label htmlFor={`qty-${card.ticket.id}`}>
                        Amount made
                        {planned != null ? <span className="meta"> Plan was {planned}.</span> : null}
                      </label>
                      <input
                        id={`qty-${card.ticket.id}`}
                        aria-label="Amount made"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        value={qty}
                        placeholder="How many"
                        onChange={(event) => setQty(event.target.value)}
                        autoFocus
                      />
                      <div className="actions">
                        <button className="btn secondary" type="button" disabled={pending !== null} onClick={() => setQtyPrompt(null)}>
                          Back
                        </button>
                        <button className="btn done" type="submit" disabled={pending !== null}>
                          Finish
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="actions">
                      <button className="btn" disabled={pending !== null || card.ticket.status === "done"} onClick={() => act("claim", card.ticket.id)}>
                        Claim
                      </button>
                      <button className="btn secondary" disabled={pending !== null || card.ticket.status === "done"} onClick={() => act("start", card.ticket.id, { ackShortage: confirmId === card.ticket.id })}>
                        {confirmId === card.ticket.id ? "Start anyway" : "Start"}
                      </button>
                      <button className="btn done" disabled={pending !== null || card.ticket.status === "done"} onClick={() => askDone(card.ticket.id)}>
                        Done
                      </button>
                    </div>
                  )}
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
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="meta board-stock-note">
        On-hand for ingredients and finished items on today&apos;s tasks.
      </p>
      <div className="stock-split board-stock" data-testid="bake-day-stock">
        <StockStrip title="Raw on hand" lines={data.bakeDay.raw} />
        <StockStrip title="Cooked on hand" lines={data.bakeDay.cooked} />
      </div>
    </div>
  );
}

function clockLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  });
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
