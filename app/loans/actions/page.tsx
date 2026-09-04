"use client";

import { FormEvent, useState } from "react";

export default function LoanActionsPage() {
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");

  async function call(action: "accrue" | "repay", payload: Record<string, FormDataEntryValue>) {
    const response = await fetch("/api/loans/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, action, payload }),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "Loan action failed");
    setMessage(JSON.stringify(body.result, null, 2));
  }

  async function accrue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await call("accrue", Object.fromEntries(new FormData(event.currentTarget).entries())); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Accrual failed"); }
  }

  async function repay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await call("repay", Object.fromEntries(new FormData(event.currentTarget).entries())); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Repayment failed"); }
  }

  return (
    <>
      <h2>Loan Actions</h2>
      <p className="small">Controlled interest accrual and repayment posting. Accrual creates Dr Interest Expense / Cr Accrued Interest Payable; repayments settle accrued interest and/or principal against cash/bank.</p>
      <section className="panel"><label>APP_SECRET<input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" /></label></section>
      {message && <pre className="panel status-pre">{message}</pre>}

      <form className="panel form-grid" onSubmit={accrue}>
        <h3 className="form-title">Accrue Compound Monthly Interest</h3>
        <label>Loan ID<input name="loanId" required defaultValue="LOAN-2026-0001" /></label>
        <label>Accrue Through<input name="asOf" type="date" required /></label>
        <div className="form-wide"><button type="submit">Post Interest Accrual</button></div>
      </form>

      <form className="panel form-grid" onSubmit={repay}>
        <h3 className="form-title">Loan Repayment</h3>
        <label>Loan ID<input name="loanId" required defaultValue="LOAN-2026-0001" /></label>
        <label>Payment Date<input name="paymentDate" type="date" required /></label>
        <label>Principal Amount<input name="principalAmount" type="number" min="0" step="0.01" defaultValue="0" /></label>
        <label>Interest Amount<input name="interestAmount" type="number" min="0" step="0.01" defaultValue="0" /></label>
        <label>Cash/Bank Account<input name="cashBankAccountId" required defaultValue="ACC-1110" /></label>
        <label>Method<select name="paymentMethod"><option>Cash</option><option>Bank Transfer</option><option>Cheque</option></select></label>
        <label className="form-wide">Reference<input name="reference" /></label>
        <div className="form-wide"><button type="submit">Post Repayment</button></div>
      </form>
    </>
  );
}
