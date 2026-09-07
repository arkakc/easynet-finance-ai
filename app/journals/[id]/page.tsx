import Link from "next/link";
import { notFound } from "next/navigation";
import { findRecords, listTable } from "@/lib/backend/apps-script";
import { requirePermission } from "@/lib/auth";
import { formatAccountingDate } from "@/lib/accounting/format-date";

const money = (value: unknown) => new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK", minimumFractionDigits: 2 }).format(Number(value || 0));

export default async function JournalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("accounts.read");
  const { id } = await params;
  const [headerResult, lineResult, accountResult, customerResult, supplierResult, projectResult] = await Promise.all([
    findRecords<any>("JournalHeaders", { journalId: id }, 1),
    findRecords<any>("JournalLines", { journalId: id }, 500),
    listTable<any>("Accounts", 500, 0),
    listTable<any>("Customers", 500, 0),
    listTable<any>("Suppliers", 500, 0),
    listTable<any>("Projects", 500, 0),
  ]);
  const header = headerResult.rows[0];
  if (!header) notFound();

  const accounts = new Map((accountResult.rows || []).map((row: any) => [String(row.accountId || ""), `${row.accountName || row.accountId} (${row.accountId}) · ${row.accountCode || ""}`]));
  const customers = new Map((customerResult.rows || []).map((row: any) => [String(row.customerId || ""), `${row.customerName || row.customerId} (${row.customerId})`]));
  const suppliers = new Map((supplierResult.rows || []).map((row: any) => [String(row.supplierId || ""), `${row.supplierName || row.supplierId} (${row.supplierId})`]));
  const projects = new Map((projectResult.rows || []).map((row: any) => [String(row.projectId || ""), `${row.projectName || row.projectId} (${row.projectId})`]));
  const lines = [...(lineResult.rows || [])].sort((a: any, b: any) => Number(a.lineNo || 0) - Number(b.lineNo || 0));
  const debit = lines.reduce((sum: number, row: any) => sum + Number(row.debit || 0), 0);
  const credit = lines.reduce((sum: number, row: any) => sum + Number(row.credit || 0), 0);

  return <div className="document-page">
    <div className="document-toolbar no-print"><Link href="/journals">← Back to Posted Journals</Link></div>
    <section className="document-sheet">
      <header className="document-header"><div><div className="eyebrow">EASYNET IT SOLUTIONS LIMITED</div><h1>Journal Entry</h1><div className="document-number">{header.journalId}</div></div><div className="status-pill status-posted">{header.status || "POSTED"}</div></header>
      <div className="document-meta">
        <div><span>Posting Date</span><strong>{formatAccountingDate(header.postingDate)}</strong></div>
        <div><span>Document Type</span><strong>{header.documentType || "—"}</strong></div>
        <div><span>Document Number</span><strong>{header.documentNumber || header.documentId || "—"}</strong></div>
        <div><span>Project</span><strong>{header.projectId ? projects.get(String(header.projectId)) || header.projectId : "—"}</strong></div>
        <div><span>Approved By</span><strong>{header.approvedBy || "—"}</strong></div>
        <div><span>Reference</span><strong>{header.reference || "—"}</strong></div>
      </div>
      <div className="document-lines"><table className="data-table"><thead><tr><th>#</th><th>Account</th><th>Party</th><th>Project</th><th>Description</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{lines.map((line: any) => {
        const party = line.customerId ? customers.get(String(line.customerId)) || line.customerId : line.supplierId ? suppliers.get(String(line.supplierId)) || line.supplierId : "—";
        return <tr key={line.journalLineId}><td>{line.lineNo}</td><td>{accounts.get(String(line.accountId)) || line.accountId}</td><td>{party}</td><td>{line.projectId ? projects.get(String(line.projectId)) || line.projectId : "—"}</td><td>{line.description || "—"}</td><td>{Number(line.debit || 0) ? money(line.debit) : "—"}</td><td>{Number(line.credit || 0) ? money(line.credit) : "—"}</td></tr>;
      })}</tbody><tfoot><tr><th colSpan={5}>Total</th><th>{money(debit)}</th><th>{money(credit)}</th></tr></tfoot></table></div>
    </section>
  </div>;
}
