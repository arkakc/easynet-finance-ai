import Link from "next/link";

type FinRecord = {
  journalId?: unknown; currency?: unknown; totalAmount?: unknown; amount?: unknown;
  paidAmount?: unknown; outstandingAmount?: unknown; allocatedAmount?: unknown;
  unallocatedAmount?: unknown; netAmount?: unknown; gstAmount?: unknown;
  status?: unknown;
};
const isPresent = (value: unknown) => value !== null && value !== undefined && value !== "";
const formatted = (value: unknown, currency: string) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);
  try { return new Intl.NumberFormat("en-PG", { style: "currency", currency }).format(amount); }
  catch { return `${currency} ${amount.toFixed(2)}`; }
};
export default function DocumentFinancialPanels({ record }: { record: FinRecord }) {
  const currency = String(record.currency || "PGK");
  const settlement: Array<[string, unknown]> = [
    ["Total", record.totalAmount ?? record.amount],
    ["Paid", record.paidAmount],
    ["Outstanding", record.outstandingAmount],
    ["Allocated", record.allocatedAmount],
    ["Unallocated", record.unallocatedAmount],
  ].filter(([, value]) => isPresent(value));
  const tax: Array<[string, unknown]> = [["Net", record.netAmount], ["GST", record.gstAmount]].filter(([, value]) => isPresent(value));
  const journalId = String(record.journalId || "").trim();
  return <>
    <section className="panel phase3-document-panel" id="document-settlement" aria-label="Settlement overview">
      <h2>Settlement Overview</h2>
      {settlement.length ? <dl className="phase3-financial-grid">
        {settlement.map(([key, value]) => <div key={String(key)}><dt>{key}</dt><dd>{formatted(value, currency)}</dd></div>)}
      </dl> : <p className="small">No settlement figures recorded for this document.</p>}
      <p className="small">Read-only snapshot of saved document values. Allocations and payments remain in their existing secured workflows.</p>
    </section>
    <section className="panel phase3-document-panel" id="document-accounting" aria-label="Accounting summary">
      <h2>Accounting & GST</h2>
      {tax.length ? <dl className="phase3-financial-grid">
        {tax.map(([key, value]) => <div key={String(key)}><dt>{key}</dt><dd>{formatted(value, currency)}</dd></div>)}
      </dl> : <p className="small">No net/GST breakdown stored on this document.</p>}
      {journalId ? <p><Link prefetch={false} href={`/journals/${encodeURIComponent(journalId)}`}>Open posted Journal Entry · {journalId}</Link></p>
        : <p className="small">No journal reference recorded for this document.</p>}
      <p className="small">This is not a journal posting preview. Journal and tax authority remain in the ledger and reporting modules.</p>
    </section>
  </>;
}
