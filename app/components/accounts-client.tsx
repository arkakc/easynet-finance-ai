"use client";

import { useEffect, useState } from "react";

type Account = {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  parentAccount: string;
  active: boolean | string;
};

export default function AccountsClient() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => {
      void (async () => {
        try {
          const response = await fetch("/api/ui/accounts", { cache: "no-store", signal: controller.signal });
          const body = await response.json();
          if (!response.ok || !body.ok) throw new Error(body.error || "Unable to load accounts");
          setAccounts((body.accounts || []).sort((a: Account, b: Account) => String(a.accountCode).localeCompare(String(b.accountCode))));
        } catch (err) {
          if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load accounts");
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      })();
    });
    return () => { controller.abort(); window.cancelAnimationFrame(frame); };
  }, []);

  return <>
    <h2>Chart of Accounts</h2>
    <p className="small">The account page renders first; controlled accounting master values are populated from the Core API after the first paint.</p>
    {error && <section className="panel"><strong>Backend warning:</strong> {error}</section>}
    <section className="panel table-wrap">
      <table className="data-table">
        <thead><tr><th>Code</th><th>Account</th><th>Type</th><th>Parent</th><th>Status</th></tr></thead>
        <tbody>
          {accounts.map(account => <tr key={account.accountId}><td>{account.accountCode}</td><td>{account.accountName}</td><td>{account.accountType}</td><td>{account.parentAccount || "—"}</td><td>{String(account.active).toLowerCase() === "false" ? "Inactive" : "Active"}</td></tr>)}
          {loading && <tr><td colSpan={5}>Loading live account values…</td></tr>}
          {!loading && !accounts.length && !error && <tr><td colSpan={5}>No accounts found.</td></tr>}
        </tbody>
      </table>
    </section>
  </>;
}
