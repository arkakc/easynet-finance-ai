"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import AdjustableDataTable, { type AdjustableColumn } from "@/app/components/adjustable-data-table";

export type JournalRegisterRow = {
  id: string;
  journalId: string;
  postingDate: string;
  createdAt: string;
  documentType: string;
  documentNumber: string;
  reference: string;
  status: string;
  maker: string;
  checker: string;
  debit: number;
  credit: number;
  currency: string;
};

const date = (value: string) => value ? new Date(value).toLocaleDateString("en-PG", { year: "numeric", month: "short", day: "2-digit" }) : "—";
const money = (value: number, currency: string) => new Intl.NumberFormat("en-PG", { style: "currency", currency, minimumFractionDigits: 2 }).format(value);

export default function JournalRegisterClient({ rows, error }: { rows: JournalRegisterRow[]; error?: string }) {
  const router = useRouter();
  const posted = rows.filter((row) => row.status === "POSTED");
  const pending = rows.filter((row) => row.status === "PENDING");
  const postedDebit = posted.reduce((sum, row) => sum + row.debit, 0);
  const postedCredit = posted.reduce((sum, row) => sum + row.credit, 0);

  const columns = useMemo<AdjustableColumn<JournalRegisterRow>[]>(() => [
    { key: "journalId", label: "Journal ID", mandatory: true, defaultWidth: 190, value: (row) => <strong>{row.journalId}</strong>, sortValue: (row) => row.journalId },
    { key: "createdAt", label: "Created Date", defaultWidth: 150, value: (row) => date(row.createdAt), sortValue: (row) => row.createdAt },
    { key: "postingDate", label: "Posting Date", defaultWidth: 150, value: (row) => date(row.postingDate), sortValue: (row) => row.postingDate },
    { key: "documentType", label: "Document Type", defaultWidth: 190, value: (row) => row.documentType || "—" },
    { key: "documentNumber", label: "Document No.", defaultWidth: 180, value: (row) => row.documentNumber || "—" },
    { key: "reference", label: "Reference / Narration", defaultWidth: 300, value: (row) => row.reference || "—" },
    { key: "debit", label: "Debit", defaultWidth: 150, value: (row) => money(row.debit, row.currency), sortValue: (row) => row.debit },
    { key: "credit", label: "Credit", defaultWidth: 150, value: (row) => money(row.credit, row.currency), sortValue: (row) => row.credit },
    { key: "maker", label: "Maker", defaultWidth: 210, value: (row) => row.maker || "—" },
    { key: "checker", label: "Checker", defaultWidth: 210, value: (row) => row.checker || "Pending checker" },
    { key: "status", label: "Status", mandatory: true, defaultWidth: 130, value: (row) => <span className="auto-badge">{row.status}</span>, sortValue: (row) => row.status },
  ], []);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Journal Register</h2>
          <p className="small">All journal entries in one list view. Search, sort, reorder and resize columns; open any row for full journal detail.</p>
        </div>
      </div>
      {error ? <div className="status-banner error">{error}</div> : null}
      <div className="grid">
        <div className="card"><div className="label">Total Journals</div><div className="value">{rows.length}</div></div>
        <div className="card"><div className="label">Pending</div><div className="value">{pending.length}</div></div>
        <div className="card"><div className="label">Posted</div><div className="value">{posted.length}</div></div>
        <div className="card"><div className="label">Posted Debits</div><div className="value">{money(postedDebit, "PGK")}</div></div>
        <div className="card"><div className="label">Posted Credits</div><div className="value">{money(postedCredit, "PGK")}</div></div>
      </div>
      <section className="panel">
        <div className="form-title-row">
          <div><h3>All Journal Entries</h3><p className="small">Newest and pending entries are included; only POSTED journals affect GL balances.</p></div>
          <span className="auto-badge">{rows.length} records</span>
        </div>
        <AdjustableDataTable
          rows={rows}
          columns={columns}
          emptyMessage="No journal entries found."
          loadingMessage="Loading journal entries…"
          rowKey={(row) => row.id}
          onRowClick={(row) => router.push(`/journals/${encodeURIComponent(row.journalId)}`)}
          rowAriaLabel={(row) => `Open journal ${row.journalId}`}
        />
      </section>
    </>
  );
}
