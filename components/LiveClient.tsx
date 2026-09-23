"use client";

import { useEffect, useState } from "react";
import type { LiveFeed } from "@/lib/types";

export function LiveClient({ initial }: { initial: LiveFeed }) {
  const [feed, setFeed] = useState(initial);
  const [store, setStore] = useState(initial.storeFilter);
  const [kitchenOnly, setKitchenOnly] = useState(true);

  async function reload(nextStore = store, nextKitchen = kitchenOnly) {
    const params = new URLSearchParams({
      store: nextStore,
      kitchenOnly: nextKitchen ? "1" : "0",
    });
    const res = await fetch(`/api/live?${params.toString()}`, { cache: "no-store" });
    const body = (await res.json()) as LiveFeed;
    setFeed(body);
  }

  useEffect(() => {
    const timer = setInterval(() => void reload(), 15_000);
    return () => clearInterval(timer);
    // reload closes over the latest filters via state setters in the interval callback below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, kitchenOnly]);

  return (
    <div>
      <p className="meta">Read-only pull from the time clock. This board does not clock anyone in or out.</p>
      <div className="filters">
        <select
          aria-label="Store"
          value={store}
          onChange={(event) => {
            setStore(event.target.value);
            void reload(event.target.value, kitchenOnly);
          }}
        >
          {feed.stores.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <button
          className={kitchenOnly ? "btn" : "btn secondary"}
          type="button"
          onClick={() => {
            const next = !kitchenOnly;
            setKitchenOnly(next);
            void reload(store, next);
          }}
        >
          {kitchenOnly ? "Kitchen + untagged" : "All roles"}
        </button>
      </div>
      {feed.error ? <p className="error">{feed.error}</p> : null}
      <p className="meta">Source {feed.sourceUrl} · refreshed {new Date(feed.fetchedAt).toLocaleTimeString("en-US", { timeZone: "America/Chicago" })}</p>
      <section className="card">
        <h2>Punched in</h2>
        {feed.hiddenOtherCount > 0 ? <p className="meta">{feed.hiddenOtherCount} non-kitchen punch{feed.hiddenOtherCount === 1 ? "" : "es"} hidden.</p> : null}
        {feed.punchedIn.length === 0 ? <p>Nobody matching this filter is clocked in.</p> : null}
        {feed.punchedIn.map((person) => (
          <div className="person" key={person.punchId || person.userId}>
            <strong>{person.name}</strong>
            <div className="meta">{person.store} · {person.role || "no role on the schedule"} · {person.roleKind}</div>
            <div>In {person.clockIn}</div>
          </div>
        ))}
      </section>
      <section className="card">
        <h2>Recent punches</h2>
        {feed.recent.length === 0 ? <p>No punches in the time clock pay-period feed.</p> : null}
        {feed.recent.map((person) => (
          <div className="person" key={`${person.punchId}-recent`}>
            <strong>{person.name}</strong>
            <div className="meta">{person.store} · {person.roleKind} · {person.status}</div>
            <div>In {person.clockIn}{person.clockOut ? ` · out ${person.clockOut}` : ""}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
