"use client";

import { useState } from "react";

type Card = {
  id: string;
  name: string;
  dueAt: string;
  dueLabel: string;
  status: string;
  assignee: string | null;
  timing: string;
};

export function OwnerClient({
  settings,
  cards,
  activity,
  floor,
}: {
  settings: { overdueBufferMinutes: number; realertMinutes: number };
  cards: Card[];
  activity: { id: string; at: string; actor: string; action: string; detail: string }[];
  floor: { ticketId: string; recipe: string; assignee: string | null; status: string; timing: string }[];
}) {
  const [buffer, setBuffer] = useState(settings.overdueBufferMinutes);
  const [realert, setRealert] = useState(settings.realertMinutes);
  const [message, setMessage] = useState<string | null>(null);

  async function saveSettings() {
    const res = await fetch("/api/owner", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "settings", overdueBufferMinutes: buffer, realertMinutes: realert }),
    });
    const body = await res.json();
    setMessage(body.ok ? "Settings saved" : body.error);
  }

  async function makeOverdue(id: string) {
    const dueAt = new Date(Date.now() - 20 * 60_000).toISOString();
    const res = await fetch("/api/owner", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "due", ticketId: id, dueAt }),
    });
    const body = await res.json();
    if (!body.ok) setMessage(body.error);
    else location.reload();
  }

  return (
    <div>
      <section className="card">
        <h2>On the floor</h2>
        {floor.length === 0 ? <p>No claimed work right now.</p> : null}
        {floor.map((row) => (
          <div className="list-item" key={row.ticketId}>
            <div><strong>{row.assignee}</strong><div className="meta">{row.recipe}</div></div>
            <span className={`badge ${row.timing === "late" ? "late" : row.timing === "early" ? "early" : ""}`}>{row.status} · {row.timing}</span>
          </div>
        ))}
      </section>
      <section className="card">
        <h2>Alert settings</h2>
        <p className="meta">Defaults are a 10 minute buffer and a 15 minute Slack re-alert. One auto Slack per interval while the ticket stays overdue.</p>
        {message ? <p>{message}</p> : null}
        <div className="row">
          <label>Buffer minutes <input type="number" value={buffer} onChange={(e) => setBuffer(Number(e.target.value))} /></label>
          <label>Re-alert minutes <input type="number" value={realert} onChange={(e) => setRealert(Number(e.target.value))} /></label>
          <button className="btn" type="button" onClick={saveSettings}>Save</button>
        </div>
      </section>
      <section className="card">
        <h2>Today&apos;s due times</h2>
        {cards.map((card) => (
          <div className="list-item" key={card.id}>
            <div>
              <strong>{card.name}</strong>
              <div className="meta">{card.dueLabel} · {card.status} · {card.timing}</div>
            </div>
            {card.status !== "done" ? (
              <button className="btn secondary" type="button" onClick={() => makeOverdue(card.id)}>
                Due 20 min ago
              </button>
            ) : null}
          </div>
        ))}
      </section>
      <section className="card">
        <h2>Activity</h2>
        <ul className="log">
          {activity.map((entry) => (
            <li key={entry.id}><strong>{entry.at}</strong> · {entry.actor} · {entry.action} · {entry.detail}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
