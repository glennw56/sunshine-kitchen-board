"use client";

import { useState } from "react";

export function LoginForm() {
  const [email, setEmail] = useState("glenn.will799@gmail.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!res.ok || body.ok === false) {
      setError(body.error || "Login failed");
      return;
    }
    location.href = "/owner";
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Owner login</h2>
      <p className="meta">The password is generated on first boot and stored only as a scrypt hash.</p>
      {error ? <p className="error">{error}</p> : null}
      <div className="field"><input aria-label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="field" style={{ marginTop: "0.5rem" }}>
        <input aria-label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <button className="btn" style={{ marginTop: "0.75rem" }} type="submit">Sign in</button>
    </form>
  );
}
