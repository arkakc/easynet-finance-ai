"use client";

import { FormEvent, useState } from "react";

export default function FinanceSetupPage() {
  const [result, setResult] = useState("");
  const [running, setRunning] = useState(false);

  async function runSetup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRunning(true);
    setResult("Verifying Chart of Accounts…");
    try {
      const r = await fetch("/api/erp/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "setupFinance", body: {} }),
      });
      const b = await r.json();
      setResult(JSON.stringify(b, null, 2));
    } catch (x) {
      setResult(x instanceof Error ? x.message : "Setup request failed");
    } finally {
      setRunning(false);
    }
  }

  return <>
    <h2>Finance Initialization</h2>
    <p className="small">
      Configuration-only initialization. This verifies the Chart of Accounts and does not create opening balances, loans, journals or transaction data.
      System Manager / Settings permission is required.
    </p>
    <form className="panel" onSubmit={runSetup}>
      <button type="submit" disabled={running}>{running ? "Verifying…" : "Verify / Initialize Chart of Accounts"}</button>
    </form>
    {result && <pre className="panel" style={{ whiteSpace: "pre-wrap" }}>{result}</pre>}
  </>;
}
