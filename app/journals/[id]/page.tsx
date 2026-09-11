import Link from "next/link";
import { notFound } from "next/navigation";
import { findRecords, listTable } from "@/lib/backend/apps-script";
import { backendConfigStatus } from "@/lib/backend/apps-script";
import { requirePermission } from "@/lib/auth";
import { formatAccountingDate } from "@/lib/accounting/format-date";
import { prisma } from "@/src/lib/prisma";

const money = (value: unknown) => new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK", minimumFractionDigits: 2 }).format(Number(value || 0));

export default async function JournalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("accounts.read");
  const { id } = await params;
  const backendConfigured = Object.values(backendConfigStatus()).some((service) => service.source !== "unconfigured");
  if (!backendConfigured) {
    const header = await prisma.journalHeader.findFirst({
      where: { OR: [{ id }, { code: id }] },
      include: { lines: { orderBy: { lineNo: "asc" }, include: { account: true } } },
    });
    if (!header) notFound();
    const [customers, suppliers, projects] = await Promise.all([
      prisma.customer.findMany({ select: { id: true, name: true } }),
      prisma.supplier.findMany({ select: { id: true, name: true } }),
      prisma.project.findMany({ select: { id: true, name: true } }),
    ]);
    const customerMap = new Map(customers.map((row) => [row.id, `${row.name} (${row.id})`]));
    const supplierMap = new Map(suppliers.map((row) => [row.id, `${row.name} (${row.id})`]));
    const projectMap = new Map(projects.map((row) => [row.id, `${row.name} (${row.id})`]));
    const party = (line: typeof header.lines[number]) => line.customerId
      ? customerMap.get(line.customerId) || line.customerId
      : line.supplierId ? supplierMap.get(line.supplierId) || line.supplierId : "—";
    const debit = header.lines.reduce((sum, row) => sum + Number(row.debit), 0);
    const credit = header.lines.reduce((sum, row) => sum + Number(row.credit), 0);
    return <div className="document-page">
      <div className="document-toolbar no-print"><Link href="/journals">← Back to Posted Journals</Link></div>
      <section className="document-sheet">
        <header className="document-header"><div><div className="eyebrow">EASYNET IT SOLUTIONS LIMITED</div><h1>Journal Entry</h1><div className="document-number">{header.code}</div></div><div className="status-pill status-posted">{header.status || "POSTED"}</div></header>
        <div className="document-meta">
          <div><span>Posting Date</span><strong>{formatAccountingDate(header.date.toISOString())}</strong></div>
          <div><span>Document Type</span><strong>{header.sourceDocType || "JOURNAL"}</strong></div>
          <div><span>Document Number</span><strong>{header.sourceDocId || "—"}</strong></div>
          <div><span>Project</span><strong>—</strong></div>
          <div><span>Approved By</span><strong>{header.approvedBy || "—"}</strong></div>
          <div><span>Reference</span><strong>{header.reference || header.description || "—"}</strong></div>
        </div>
        <div className="document-lines"><table className="data-table"><thead><tr><th>#</th><th>Account</th><th>Party</th><th>Project</th><th>Description</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{header.lines.map((line) => <tr key={line.id}><td>{line.lineNo}</td><td>{line.account.code} — {line.account.name}</td><td>{party(line)}</td><td>{line.projectId ? projectMap.get(line.projectId) || line.projectId : "—"}</td><td>{line.description || "—"}</td><td>{Number(line.debit) ? money(line.debit) : "—"}</td><td>{Number(line.credit) ? money(line.credit) : "—"}</td></tr>)}</tbody><tfoot><tr><th colSpan={5}>Total</th><th>{money(debit)}</th><th>{money(credit)}</th></tr></tfoot></table></div>
      </section>
    </div>;
  }
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
