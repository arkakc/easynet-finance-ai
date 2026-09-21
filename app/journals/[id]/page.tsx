import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { formatAccountingDate } from "@/lib/accounting/format-date";
import { prisma } from "@/src/lib/prisma";
import JournalApprovalButton from "@/app/components/journal-approval-button";
import JournalPreApprovalActions from "@/app/components/journal-preapproval-actions";
import JournalReversalButton from "@/app/components/journal-reversal-button";

const money = (value: unknown, currency: string) =>
  new Intl.NumberFormat("en-PG", { style: "currency", currency, minimumFractionDigits: 2 }).format(Number(value || 0));

export default async function JournalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("accounts.read");
  const { id } = await params;

  const header = await prisma.journalHeader.findFirst({
    where: { OR: [{ id }, { code: id }] },
    include: { lines: { orderBy: { lineNo: "asc" }, include: { account: true } } },
  });
  if (!header) notFound();

  const [customers, suppliers, projects, reversalJournal, originalJournal] = await Promise.all([
    prisma.customer.findMany({ select: { id: true, name: true } }),
    prisma.supplier.findMany({ select: { id: true, name: true } }),
    prisma.project.findMany({ select: { id: true, name: true } }),
    header.sourceDocType !== "JOURNAL_REVERSAL"
      ? prisma.journalHeader.findFirst({ where: { reversalOfJournalId: header.id }, select: { code: true, status: true, sourceDocId: true } })
      : Promise.resolve(null),
    header.sourceDocType === "JOURNAL_REVERSAL" && header.reversalOfJournalId
      ? prisma.journalHeader.findUnique({ where: { id: header.reversalOfJournalId }, select: { code: true, status: true, sourceDocType: true, sourceDocId: true } })
      : Promise.resolve(null),
  ]);

  const customerMap = new Map(customers.map((row) => [row.id, `${row.name} (${row.id})`]));
  const supplierMap = new Map(suppliers.map((row) => [row.id, `${row.name} (${row.id})`]));
  const projectMap = new Map(projects.map((row) => [row.id, `${row.name} (${row.id})`]));

  const party = (line: typeof header.lines[number]) => line.customerId
    ? customerMap.get(line.customerId) || line.customerId
    : line.supplierId
      ? supplierMap.get(line.supplierId) || line.supplierId
      : "—";

  const canEditDelete = ["DRAFT", "PENDING"].includes(header.status) && header.sourceDocType.startsWith("MANUAL_") && user.permissions.includes("accounts.write");

  const canReverse = header.status === "POSTED" && header.sourceDocType !== "JOURNAL_REVERSAL" && user.permissions.includes("post.approve");

  const canApprove = header.status === "PENDING"
    && header.sourceDocType.startsWith("MANUAL_")
    && user.permissions.includes("post.approve")
    && (user.roles.includes("System Manager") || String(header.createdBy || "").toLowerCase() !== String(user.email || "").toLowerCase());

  const baseCurrency = String(header.baseCurrency || "PGK").toUpperCase();
  const sourceCurrency = String(header.currency || baseCurrency).toUpperCase();
  const debit = header.lines.reduce((sum, row) => sum + Number(row.debit), 0);
  const credit = header.lines.reduce((sum, row) => sum + Number(row.credit), 0);
  const transactionDebit = header.lines.reduce((sum, row) => {
    const value = Number(row.transactionDebit || 0);
    return sum + (value || (String(row.transactionCurrency || row.currency || baseCurrency).toUpperCase() === baseCurrency ? Number(row.debit || 0) : 0));
  }, 0);
  const transactionCredit = header.lines.reduce((sum, row) => {
    const value = Number(row.transactionCredit || 0);
    return sum + (value || (String(row.transactionCurrency || row.currency || baseCurrency).toUpperCase() === baseCurrency ? Number(row.credit || 0) : 0));
  }, 0);

  return (
    <div className="document-page">
      <div className="document-toolbar no-print">
        <Link href="/journals">← Back to Journals</Link>
        {canEditDelete ? <JournalPreApprovalActions journalId={header.id} /> : null}
        {canApprove ? <JournalApprovalButton journalId={header.id} /> : null}
        {canReverse ? <JournalReversalButton journalId={header.id} /> : null}
      </div>

      <section className="document-sheet">
        <header className="document-header">
          <div>
            <div className="eyebrow">EASYNET IT SOLUTIONS LIMITED</div>
            <h1>Journal Entry</h1>
            <div className="document-number">{header.code}</div>
          </div>
          <div className={`status-pill ${header.status === "POSTED" ? "status-posted" : ""}`}>
            {header.status === "POSTED" ? "APPROVED AND POSTED" : header.status === "PENDING" ? "APPROVAL PENDING" : header.status || "—"}
          </div>
        </header>

        <div className="document-meta">
          <div><span>Posting Date</span><strong>{formatAccountingDate(header.date.toISOString())}</strong></div>
          <div><span>Document Type</span><strong>{header.sourceDocType || "JOURNAL"}</strong></div>
          <div><span>Document Number</span><strong>{header.sourceDocId || "—"}</strong></div>
          <div><span>Source Currency</span><strong>{sourceCurrency}</strong></div>
          <div><span>Base Currency</span><strong>{baseCurrency}</strong></div>
          <div><span>Exchange Rate</span><strong>{sourceCurrency === baseCurrency ? "1.00000000" : `1 ${sourceCurrency} = ${Number(header.exchangeRate || 0).toFixed(8).replace(/0+$/, "").replace(/\.$/, "")} ${baseCurrency}`}</strong></div>
          <div><span>Maker / Created By</span><strong>{header.createdBy || "—"}</strong></div>
          <div><span>Checker / Approved By</span><strong>{header.approvedBy || "Pending checker"}</strong></div>
          <div><span>Submitted At</span><strong>{header.createdAt.toLocaleString("en-PG", { timeZone: "Pacific/Port_Moresby" })}</strong></div>
          <div><span>Posted At</span><strong>{header.postedAt ? header.postedAt.toLocaleString("en-PG", { timeZone: "Pacific/Port_Moresby" }) : "Not posted"}</strong></div>
          <div><span>Reference</span><strong>{header.reference || header.description || "—"}</strong></div>
          {reversalJournal ? <div><span>Reversal Status</span><strong>REVERSED · <Link href={`/journals/${reversalJournal.code}`}>{reversalJournal.code}</Link></strong></div> : null}
          {originalJournal ? <div><span>Reversal Of</span><strong><Link href={`/journals/${originalJournal.code}`}>{originalJournal.code}</Link> · {originalJournal.sourceDocType || "JOURNAL"} · {originalJournal.sourceDocId || "—"}</strong></div> : null}
        </div>

        <div className="document-lines">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Account</th>
                <th>Party</th>
                <th>Project</th>
                <th>Description</th>
                <th>Txn Currency</th>
                <th>Txn Debit</th>
                <th>Txn Credit</th>
                <th>Base Debit ({baseCurrency})</th>
                <th>Base Credit ({baseCurrency})</th>
              </tr>
            </thead>
            <tbody>
              {header.lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.lineNo}</td>
                  <td>{line.account.code} — {line.account.name}</td>
                  <td>{party(line)}</td>
                  <td>{line.projectId ? projectMap.get(line.projectId) || line.projectId : "—"}</td>
                  <td>{line.description || "—"}</td>
                  <td>{String(line.transactionCurrency || line.currency || baseCurrency).toUpperCase()}</td>
                  <td>{(()=>{const currency=String(line.transactionCurrency || line.currency || baseCurrency).toUpperCase();const value=Number(line.transactionDebit || 0)||(currency===baseCurrency?Number(line.debit||0):0);return value?money(value,currency):"—";})()}</td>
                  <td>{(()=>{const currency=String(line.transactionCurrency || line.currency || baseCurrency).toUpperCase();const value=Number(line.transactionCredit || 0)||(currency===baseCurrency?Number(line.credit||0):0);return value?money(value,currency):"—";})()}</td>
                  <td>{Number(line.debit) ? money(line.debit, baseCurrency) : "—"}</td>
                  <td>{Number(line.credit) ? money(line.credit, baseCurrency) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={6}>Total</th>
                <th>{sourceCurrency === baseCurrency ? money(transactionDebit, baseCurrency) : "Per-line"}</th>
                <th>{sourceCurrency === baseCurrency ? money(transactionCredit, baseCurrency) : "Per-line"}</th>
                <th>{money(debit, baseCurrency)}</th>
                <th>{money(credit, baseCurrency)}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}
