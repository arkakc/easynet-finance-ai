"use client";

import { FormEvent, useState } from "react";

export default function FinanceSetupPage() {
  const [secret, setSecret] = useState("");
  const [result, setResult] = useState("");
  const [running, setRunning] = useState(false);

  async function runSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRunning(true);
    setResult("Initializing finance master data...");

    try {
      const response = await fetch("/api/setup/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      const body = await response.json();
      setResult(JSON.stringify(body, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Setup request failed");
    } finally {
      setRunning(false);
      setSecret("");
    }
  }

  return (
    <>
      <h2>Finance Initialization</h2>
      <p className="small">
        One-time, idempotent initialization for the Chart of Accounts, opening loan and opening journal. The setup secret is sent only to the server for verification and is not stored by this page.
      </p>

      <form className="panel" onSubmit={runSetup}>
        <label htmlFor="secret">APP_SECRET</label>
        <input
          id="secret"
          type="password"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          required
          autoComplete="off"
        />
        <div style={{ height: 12 }} />
        <button type="submit" disabled={running}>
          {running ? "Initializing..." : "Initialize Finance Data"}
        </button>
      </form>

      {result && (
        <pre className="panel" style={{ whiteSpace: "pre-wrap" }}>
          {result}
        </pre>
      )}
    </>
  );
}
