import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { formatAccountingDate } from "@/lib/accounting/format-date";
import { prisma } from "@/src/lib/prisma";

const money = (value: unknown) =>
  new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK", minimumFractionDigits: 2 }).format(Number(value || 0));

export default async function JournalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("accounts.read");
  const { id } = await params;

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
    : line.supplierId
      ? supplierMap.get(line.supplierId) || line.supplierId
      : "—";

  const debit = header.lines.reduce((sum, row) => sum + Number(row.debit), 0);
  const credit = header.lines.reduce((sum, row) => sum + Number(row.credit), 0);

  return (
    <div className="document-page">
      <div className="document-toolbar no-print">
        <Link href="/journals">← Back to Journals</Link>
      </div>

      <section className="document-sheet">
        <header className="document-header">
          <div>
            <div className="eyebrow">EASYNET IT SOLUTIONS LIMITED</div>
            <h1>Journal Entry</h1>
            <div className="document-number">{header.code}</div>
          </div>
          <div className={`status-pill ${header.status === "POSTED" ? "status-posted" : ""}`}>{header.status || "POSTED"}</div>
        </header>

        <div className="document-meta">
          <div><span>Posting Date</span><strong>{formatAccountingDate(header.date.toISOString())}</strong></div>
          <div><span>Document Type</span><strong>{header.sourceDocType || "JOURNAL"}</strong></div>
          <div><span>Document Number</span><strong>{header.sourceDocId || "—"}</strong></div>
          <div><span>Project</span><strong>—</strong></div>
          <div><span>Approved By</span><strong>{header.approvedBy || "—"}</strong></div>
          <div><span>Reference</span><strong>{header.reference || header.description || "—"}</strong></div>
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
                <th>Debit</th>
                <th>Credit</th>
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
                  <td>{Number(line.debit) ? money(line.debit) : "—"}</td>
                  <td>{Number(line.credit) ? money(line.credit) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={5}>Total</th>
                <th>{money(debit)}</th>
                <th>{money(credit)}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}
