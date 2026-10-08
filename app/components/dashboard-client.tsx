"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { completedMonthlyPeriods, monthlyAnniversaryDate, normalizeAccountingDate } from "@/lib/accounting/loan";

type DashboardKPI = { key: string; value: string | number; updatedAt: string };
type BackendStatus = { ok: boolean; version?: string; error?: string };
type DashboardPayload = {
  ok: boolean;
  rows?: DashboardKPI[];
  services?: Record<string, BackendStatus>;
  backendError?: string;
  error?: string;
  mode?: "local" | "backend";
};

const n = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/,/g, "");
    if (!cleaned) return 0;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const money = (value: unknown) => new Intl.NumberFormat("en-PG", {
  style: "currency",
  currency: "PGK",
  minimumFractionDigits: 2,
}).format(n(value));

export default function DashboardClient() {
  const [rows, setRows] = useState<DashboardKPI[]>([]);
  const [services, setServices] = useState<Record<string, BackendStatus>>({});
  const [backendError, setBackendError] = useState("");
  const [mode, setMode] = useState<"local" | "backend">("backend");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let frame = 0;

    frame = window.requestAnimationFrame(() => {
      void (async () => {
        try {
          const response = await fetch("/api/dashboard-data", {
            cache: "no-store",
            signal: controller.signal,
          });
          const body = await response.json() as DashboardPayload;
          if (!response.ok || !body.ok) throw new Error(body.error || "Dashboard data load failed");
          setRows(Array.isArray(body.rows) ? body.rows : []);
          setServices(body.services || {});
          setBackendError(String(body.backendError || ""));
          setMode(body.mode || "backend");
        } catch (error) {
          if (controller.signal.aborted) return;
          setBackendError(error instanceof Error ? error.message : "Dashboard data load failed");
        } finally {
          if (!controller.signal.aborted) setLoaded(true);
        }
      })();
    });

    return () => {
      controller.abort();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  const values = useMemo(() => new Map(rows.map((row) => [row.key, row.value])), [rows]);
  const get = (key: string, fallback: string | number = "") => values.get(key) ?? fallback;

  const cashBank = n(get("cashBank"));
  const accountsReceivable = n(get("accountsReceivable"));
  const accountsPayable = n(get("accountsPayable"));
  const gstPayable = n(get("gstPayable"));
  const revenue = n(get("revenuePosted"));
  const expenses = n(get("expensesPosted"));
  const netProfit = n(get("netProfitPosted"));
  const poCommitments = n(get("poCommitments"));
  const gstStatus = loaded ? String(get("gstStatus", "UNVERIFIED")) : "Loading…";
  const draftApprovals = n(get("draftApprovals"));
  const activeProjects = n(get("activeProjects"));
  const sourcePending = n(get("sourcePending"));
  const arSubledger = n(get("arSubledger"));
  const apSubledger = n(get("apSubledger"));
  const arDifference = n(get("arReconciliationDifference"));
  const apDifference = n(get("apReconciliationDifference"));

  const coreVersion = services.core?.version || "Unavailable";
  const reportingVersion = services.reporting?.version || "Unavailable";
  const documentVersion = services.document?.version || "Unavailable";
  const coreReady = mode === "local" || Boolean(services.core?.ok && coreVersion === "0.5.0");
  const reportingReady = mode === "local" || Boolean(services.reporting?.ok && reportingVersion === "0.4.1");
  const documentReady = mode === "local" || Boolean(services.document?.ok && documentVersion === "0.4.0");

  const activeLoan = String(get("loanStatus")).toUpperCase() === "ACTIVE";
  let nextLoanAccrual = "";
  if (activeLoan) {
    try {
      const loanDate = normalizeAccountingDate(String(get("loanDate")));
      const lastAccrued = normalizeAccountingDate(String(get("loanLastAccruedThrough", loanDate)));
      const recognizedPeriods = completedMonthlyPeriods(loanDate, lastAccrued);
      nextLoanAccrual = monthlyAnniversaryDate(loanDate, recognizedPeriods + 1);
    } catch {
      nextLoanAccrual = String(get("loanFirstAccrualDate", "Review required"));
    }
  }

  const displayValue = (value: number) => !loaded ? "—" : backendError ? "Unavailable" : money(value);
  const displayCount = (value: number) => !loaded || backendError ? "—" : value;

  const kpis = [
    ["Cash & Bank", displayValue(cashBank)],
    ["Accounts Receivable", displayValue(accountsReceivable)],
    ["Accounts Payable", displayValue(accountsPayable)],
    ["GST Payable", displayValue(gstPayable)],
    ["Revenue (Posted)", displayValue(revenue)],
    ["Expenses (Posted)", displayValue(expenses)],
    ["Net Profit (Posted)", displayValue(netProfit)],
    ["PO Commitments", displayValue(poCommitments)],
  ];


  return (
    <>
      <div className="page-head">
        <div>
          <h2>Management Dashboard</h2>
          <p className="small">Financial overview and real-time controls for Papua New Guinea SME operations.</p>
        </div>

      </div>

      {loaded && backendError && (
        <div className="warning-panel" role="alert">
          <strong>Financial data unavailable:</strong> Dashboard balances may be incomplete. Please contact your system administrator before relying on these figures.
        </div>
      )}
      {loaded && !backendError && (Math.abs(arDifference) >= 0.01 || Math.abs(apDifference) >= 0.01) && (
        <div className="warning-panel" role="alert">
          <strong>Accounts reconciliation required:</strong> Receivables difference {money(arDifference)}; payables difference {money(apDifference)}. Review subledger balances before closing the period.
        </div>
      )}

      <div className="grid dashboard-grid">
        {kpis.map(([label, value]) => <div className="card" key={label}><div className="label">{label}</div><div className="value">{value}</div></div>)}
      </div>

      <div className="two-col">
        <section className="panel">
          <h3>Control Snapshot</h3>
          <p>Pending finance approvals: <strong>{displayCount(draftApprovals)}</strong></p>
          <p>Active projects: <strong>{displayCount(activeProjects)}</strong></p>
          <p>Source files not retained: <strong>{displayCount(sourcePending)}</strong></p>
          <p>AR subledger total: <strong>{!loaded ? "—" : backendError ? "Unavailable" : money(arSubledger)}</strong></p>
          <p>AP subledger total: <strong>{!loaded ? "—" : backendError ? "Unavailable" : money(apSubledger)}</strong></p>
          <p>AR reconciliation difference: <strong>{!loaded ? "—" : backendError ? "Unavailable" : money(arDifference)}</strong></p>
          <p>AP reconciliation difference: <strong>{!loaded ? "—" : backendError ? "Unavailable" : money(apDifference)}</strong></p>
          <p>AI auto-posting: <strong>Disabled</strong></p>
          <div className="button-row"><Link prefetch={false} className="link-button" href="/controls">Open Control Centre</Link><Link prefetch={false} className="link-button secondary-link" href="/reports">Open Reports</Link></div>
        </section>


      </div>

      <div className="two-col">
        <section className="panel">
          <h3>Loan Control</h3>
          {!loaded ? <p>Loading loan control data…</p> : backendError ? <p>Loan data unavailable while the backend warning is active.</p> : activeLoan ? <>
            <p>Lender: <strong>{String(get("loanLenderName"))}</strong></p>
            <p>Original principal: <strong>{money(get("loanPrincipal"))}</strong></p>
            <p>Interest: <strong>{(n(get("loanInterestRate")) * 100).toFixed(2)}% monthly compound</strong></p>
            <p>Principal outstanding: <strong>{money(get("loanPrincipalOutstanding"))}</strong></p>
            <p>Accrued interest outstanding: <strong>{money(get("loanInterestOutstanding"))}</strong></p>
            <p>Recorded total settlement: <strong>{money(get("loanExpectedSettlement"))}</strong></p>
            <p>Next accrual: <strong>{nextLoanAccrual || "—"}</strong></p>
            <Link prefetch={false} className="link-button" href="/loans/actions">Loan Actions</Link>
          </> : <p>No active loan loaded.</p>}
        </section>

        <section className="panel">
          <h3>Accounting Policy</h3>
          <p>GST control flag: <strong>{gstStatus}</strong></p>
          <p>Posted corrections: <strong>Reversal + corrected journal only</strong></p>
          <p>Source-document duplicates: <strong>SHA-256 controlled</strong></p>
          <p>Accounting integrity: <strong>Use Control Centre reconciliation before UAT sign-off</strong></p>
        </section>
      </div>
    </>
  );
}
