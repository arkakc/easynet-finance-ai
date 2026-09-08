import Link from "next/link";
import { listTable } from "@/lib/backend/apps-script";

export const dynamic = "force-dynamic";

type Setting = { key: string; value: string; notes: string };
type Header = { journalId: string; postingDate: string; documentType: string; documentNumber: string; status: string };
type Line = { journalId: string; accountId: string; debit: number | string; credit: number | string; taxCode: string; description: string };

const n = (value: unknown) => Number(value || 0);
const money = (value: unknown) => new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK", minimumFractionDigits: 2 }).format(n(value));
const normalized = (value: unknown) => String(value || "").trim().toUpperCase();

export default async function GstReportPage() {
  let settings: Setting[] = [];
  let headers: Header[] = [];
  let lines: Line[] = [];
  let error = "";
  try {
    const [s, h, l] = await Promise.all([
      listTable<Setting>("Settings", 500, 0),
      listTable<Header>("JournalHeaders", 500, 0),
      listTable<Line>("JournalLines", 500, 0),
    ]);
    settings = s.rows;
    headers = h.rows.filter((row) => normalized(row.status) === "POSTED");
    lines = l.rows;
  } catch (err) {
    error = err instanceof Error ? err.message : "GST report load failed";
  }

  if (error) {
    return (
      <>
        <h2>GST Control Report</h2>
        <p className="small">Live finance data is unavailable until the backend connection succeeds.</p>
        <section className="panel warning-panel"><strong>GST report data unavailable.</strong> {error}. Do not rely on zero or blank figures while this warning is active.</section>
      </>
    );
  }

  const status = normalized(settings.find((row) => row.key === "gst_status")?.value || "UNVERIFIED");
  const gstNumber = settings.find((row) => row.key === "gst_number")?.value || "";
  const header = new Map(headers.map((row) => [String(row.journalId), row]));
  const gstLines = lines
    .filter((line) => ["ACC-1140", "ACC-2120"].includes(String(line.accountId)) && header.has(String(line.journalId)))
    .sort((a, b) => String(header.get(String(a.journalId))?.postingDate || "").localeCompare(String(header.get(String(b.journalId))?.postingDate || "")));
  const inputGst = gstLines.filter((line) => line.accountId === "ACC-1140").reduce((sum, line) => sum + n(line.debit) - n(line.credit), 0);
  const outputGst = gstLines.filter((line) => line.accountId === "ACC-2120").reduce((sum, line) => sum + n(line.credit) - n(line.debit), 0);
  const netPayable = outputGst - inputGst;

  return (
    <>
      <h2>GST Control Report</h2>
      <p className="small">Management GST ledger derived only from POSTED journal entries. The configured GST status is an ERP control flag; formal tax filing still requires reconciliation to registration evidence and source documents.</p>
      {status !== "VERIFIED" && <section className="panel warning-panel"><strong>GST control status: {status}.</strong> GST posting/reporting should be reviewed before relying on this control report.</section>}

      <div className="grid">
        <div className="card"><div className="label">GST Control Status</div><div className="value small-value">{status}</div></div>
        <div className="card"><div className="label">Output GST</div><div className="value">{money(outputGst)}</div></div>
        <div className="card"><div className="label">Input GST</div><div className="value">{money(inputGst)}</div></div>
        <div className="card"><div className="label">Net GST {netPayable >= 0 ? "Payable" : "Receivable"}</div><div className="value">{money(Math.abs(netPayable))}</div></div>
      </div>
      <section className="panel"><p>GST Number: <strong>{gstNumber || "Not recorded"}</strong></p><p className="small">A VERIFIED system flag does not by itself prove tax registration or filing compliance.</p></section>

      <section className="panel table-wrap">
        <h3>GST Ledger Detail</h3>
        <table className="data-table"><thead><tr><th>Date</th><th>Document</th><th>Type</th><th>GST Type</th><th>Debit</th><th>Credit</th><th>Description</th><th>Journal</th></tr></thead><tbody>
          {gstLines.map((line, index) => {
            const h = header.get(String(line.journalId))!;
            return <tr key={`${line.journalId}-${index}`}><td>{h.postingDate}</td><td>{h.documentNumber}</td><td>{h.documentType}</td><td>{line.accountId === "ACC-1140" ? "Input GST" : "Output GST"}</td><td>{n(line.debit) ? money(line.debit) : "—"}</td><td>{n(line.credit) ? money(line.credit) : "—"}</td><td>{line.description}</td><td><Link href={`/journals/${encodeURIComponent(String(line.journalId))}`}>View</Link></td></tr>;
          })}
          {!gstLines.length && <tr><td colSpan={8}>No posted GST transactions.</td></tr>}
        </tbody></table>
      </section>
    </>
  );
}
