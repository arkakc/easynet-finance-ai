"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok || !body.ok) { setError(body.error || "Login failed"); return; }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="eyebrow">EASYNET IT SOLUTIONS LIMITED</div>
        <h1>Finance ERP Login</h1>
        <p className="small">Sign in with your assigned user account. Access is controlled by role and permission.</p>
        <label>Email<input name="email" type="email" autoComplete="username" required autoFocus /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required minLength={8} /></label>
        {error && <div className="login-error">{error}</div>}
        <button disabled={busy} type="submit">{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
