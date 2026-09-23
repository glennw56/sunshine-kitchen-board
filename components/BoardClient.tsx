"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatDuration, runningElapsedMs } from "@/lib/time";
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
    timerElapsedMs: number;
    timerRunningSince: string | null;
    startedAt: string | null;
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
  column: "todo" | "progress" | "done";
  estimateLabel: string;
  timing: string;
  overdue: boolean;
  alert: { lastError: string | null; count: number } | null;
};

type TemplateCard = {
  recipeId: string;
  name: string;
  estimateLabel: string;
  inSprint: boolean;
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
  sprint: { id: string; serviceDate: string; label: string };
  backlog: TemplateCard[];
  columns: { todo: Card[]; progress: Card[]; done: Card[] };
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
  const [nowMs, setNowMs] = useState(() => Date.now());
  const overdueCount = data.cards.filter((card) => card.overdue).length;
  const timing = data.columns.progress.some((card) => runningSince(card));

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
    if (!timing) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [timing]);

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
    setPending(`${action}:${ticketId || extra.recipeId || ""}`);
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
        setError("Short on ingredients. Move it anyway only if the floor can cover it.");
        return;
      }
      setError(body.error || "Could not update the card");
      return;
    }
    setConfirmId(null);
    if (action === "move" && extra.column === "done") setQtyPrompt(null);
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
    void act("move", ticketId, { column: "done", qtyMade: amount });
  }

  return (
    <div className="board">
      <OverdueSound count={overdueCount} />
      <h2 className="today-heading">Sprint</h2>
      <p className="meta">{data.sprint.label}</p>
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
        <div className="banner">{overdueCount} card{overdueCount === 1 ? "" : "s"} overdue.</div>
      ) : null}
      <div className="jira" data-testid="sprint-board">
        <section className="jira-col" aria-label="Backlog">
          <header className="jira-head">
            <h3>Backlog</h3>
            <span className="badge">{data.backlog.length}</span>
          </header>
          {data.backlog.length === 0 ? <p className="meta">No templates yet.</p> : null}
          {data.backlog.map((template) => (
            <article className="issue" key={template.recipeId}>
              <div className="issue-top">
                <strong>{template.name}</strong>
                <span className="estimate">{template.estimateLabel}</span>
              </div>
              <button
                className="btn"
                type="button"
                disabled={pending !== null || template.inSprint}
                onClick={() => act("pull", "", { recipeId: template.recipeId })}
              >
                {template.inSprint ? "In sprint" : "Add to sprint"}
              </button>
            </article>
          ))}
        </section>
        <SprintColumn title="To Do" cards={data.columns.todo} openId={openId} setOpenId={setOpenId} pending={pending} onNudge={(id) => act("nudge", id)} onRetry={(id) => act("square-retry", id)}>
          {(card) => (
            <button
              className="btn"
              type="button"
              disabled={pending !== null}
              onClick={() => act("move", card.ticket.id, { column: "progress", ackShortage: confirmId === card.ticket.id })}
            >
              {confirmId === card.ticket.id ? "Start anyway" : "In Progress"}
            </button>
          )}
        </SprintColumn>
        <SprintColumn title="In Progress" cards={data.columns.progress} nowMs={nowMs} openId={openId} setOpenId={setOpenId} pending={pending} onNudge={(id) => act("nudge", id)} onRetry={(id) => act("square-retry", id)}>
          {(card) =>
            qtyPrompt === card.ticket.id ? (
              <form
                className="qty-prompt"
                onSubmit={(event) => {
                  event.preventDefault();
                  confirmDone(card.ticket.id);
                }}
              >
                <label htmlFor={`qty-${card.ticket.id}`}>
                  Amount made
                  {card.recipe ? <span className="meta"> Plan was {card.recipe.yieldQty * card.ticket.batches}.</span> : null}
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
                <button className="btn secondary" type="button" disabled={pending !== null} onClick={() => act("move", card.ticket.id, { column: "todo" })}>
                  To Do
                </button>
                <button className="btn done" type="button" disabled={pending !== null} onClick={() => askDone(card.ticket.id)}>
                  Done
                </button>
              </div>
            )
          }
        </SprintColumn>
        <SprintColumn title="Done" cards={data.columns.done} nowMs={nowMs} openId={openId} setOpenId={setOpenId} pending={pending} onNudge={(id) => act("nudge", id)} onRetry={(id) => act("square-retry", id)} />
      </div>
      <p className="meta board-stock-note">On-hand for ingredients and finished items on today&apos;s sprint.</p>
      <div className="stock-split board-stock" data-testid="bake-day-stock">
        <StockStrip title="Raw on hand" lines={data.bakeDay.raw} />
        <StockStrip title="Cooked on hand" lines={data.bakeDay.cooked} />
      </div>
    </div>
  );
}

function SprintColumn({
  title,
  cards,
  nowMs,
  openId,
  setOpenId,
  pending,
  onNudge,
  onRetry,
  children,
}: {
  title: string;
  cards: Card[];
  nowMs?: number;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  pending: string | null;
  onNudge: (id: string) => void;
  onRetry: (id: string) => void;
  children?: (card: Card) => ReactNode;
}) {
  return (
    <section className="jira-col" aria-label={title}>
      <header className="jira-head">
        <h3>{title}</h3>
        <span className="badge">{cards.length}</span>
      </header>
      {cards.length === 0 ? <p className="meta">Nothing here.</p> : null}
      {cards.map((card) => (
        <article className={`issue${card.overdue ? " late" : ""}`} key={card.ticket.id} id={card.ticket.id}>
          <div className="issue-top">
            <strong>{card.recipe?.name ?? "Task"}</strong>
            <span className="estimate">{card.estimateLabel}</span>
          </div>
          <Timer card={card} nowMs={nowMs ?? Date.now()} />
          <button className="text-btn" type="button" onClick={() => setOpenId(openId === card.ticket.id ? null : card.ticket.id)}>
            {openId === card.ticket.id ? "Hide steps" : "Steps"}
          </button>
          {openId === card.ticket.id ? (
            <div>
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
              {card.alert?.lastError ? <p className="error">Slack auto-alert: {card.alert.lastError}</p> : null}
              <div className="row extra-actions">
                <button className="btn ghost" type="button" disabled={pending !== null} onClick={() => onNudge(card.ticket.id)}>
                  Slack nudge
                </button>
                {card.ticket.stockMoved && !card.ticket.squareMoved ? (
                  <button className="btn ghost" type="button" disabled={pending !== null} onClick={() => onRetry(card.ticket.id)}>
                    Retry Square
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          <p className="meta issue-meta">
            {card.ticket.assignee ? card.ticket.assignee : "Unassigned"}
            {card.ticket.qtyMade != null ? ` · made ${card.ticket.qtyMade}` : ""}
            {card.overdue ? " · late" : ""}
          </p>
          {card.shortages.length > 0 && card.column !== "done" ? (
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
          {children ? children(card) : null}
        </article>
      ))}
    </section>
  );
}

function Timer({ card, nowMs }: { card: Card; nowMs: number }) {
  const since = runningSince(card);
  const elapsed = runningElapsedMs(card.ticket.timerElapsedMs ?? 0, since, nowMs);
  if (!since && elapsed <= 0) return null;
  const stopped = card.column === "done";
  return (
    <p className={`timer${since ? " live" : ""}`} aria-label={since ? "Timer running" : stopped ? "Timer stopped" : "Timer paused"}>
      {formatDuration(elapsed)}
      {since || stopped ? "" : " paused"}
    </p>
  );
}

function runningSince(card: Card): string | null {
  if (card.column !== "progress") return null;
  return card.ticket.timerRunningSince || card.ticket.startedAt;
}

function StockStrip({ title, lines }: { title: string; lines: StockLine[] }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {lines.length === 0 ? <p className="meta">Nothing on today&apos;s sprint.</p> : null}
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
