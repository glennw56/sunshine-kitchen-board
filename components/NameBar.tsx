"use client";

import { useState } from "react";
import Link from "next/link";

export function NameBar({ name, admin }: { name: string | null; admin: string | null }) {
  const [value, setValue] = useState(name ?? "");
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    await fetch("/api/auth/staff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: value }),
    });
    setPending(false);
    location.reload();
  }

  return (
    <div className="namebar">
      <input
        aria-label="Your name"
        placeholder="Your name"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button className="btn secondary" type="button" onClick={save} disabled={pending}>
        {name ? "Update" : "I'm here"}
      </button>
      <Link href={admin ? "/owner" : "/login"}>{admin ? "Owner" : "Owner login"}</Link>
    </div>
  );
}
