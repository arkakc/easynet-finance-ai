import { listTable } from "@/lib/backend/apps-script";

export const dynamic = "force-dynamic";

type Setting = { key: string; value: string; notes: string };
type Header = { journalId: string; postingDate: string; documentType: string; documentNumber: string; status: string };
type Line = { journalId: string; accountId: string; debit: number | string; credit: number | string; taxCode: string; description: string };

const n = (value: unknown) => Number(value || 0);
const money = (value: unknown) => new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK", minimumFractionDigits: 2 }).format(n(value));

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
    headers = h.rows.filter((row) => row.status === "POSTED");
    lines = l.rows;
  } catch (err) {
    error = err instanceof Error ? err.message : "GST report load failed";
  }

  const status = settings.find((row) => row.key === "gst_status")?.value || "UNVERIFIED";
  const gstNumber = settings.find((row) => row.key === "gst_number")?.value || "";
  const header = new Map(headers.map((row) => [row.journalId, row]));
  const gstLines = lines.filter((line) => ["ACC-1140", "ACC-2120"].includes(line.accountId) && header.has(line.journalId));
  const inputGst = gstLines.filter((line) => line.accountId === "ACC-1140").reduce((sum, line) => sum + n(line.debit) - n(line.credit), 0);
  const outputGst = gstLines.filter((line) => line.accountId === "ACC-2120").reduce((sum, line) => sum + n(line.credit) - n(line.debit), 0);
  const netPayable = outputGst - inputGst;

  return (
    <>
      <h2>GST Control Report</h2>
      <p className="small">Management GST ledger derived only from posted journal entries. Formal tax filing should be reconciled to source evidence before submission.</p>
      {error && <section className="panel"><strong>Backend warning:</strong> {error}</section>}
      {status !== "VERIFIED" && <section className="panel warning-panel"><strong>GST status: {status}.</strong> Do not treat this report as a tax filing until registration evidence is verified.</section>}

      <div className="grid">
        <div className="card"><div className="label">GST Status</div><div className="value small-value">{status}</div></div>
        <div className="card"><div className="label">Output GST</div><div className="value">{money(outputGst)}</div></div>
        <div className="card"><div className="label">Input GST</div><div className="value">{money(inputGst)}</div></div>
        <div className="card"><div className="label">Net GST Payable</div><div className="value">{money(netPayable)}</div></div>
      </div>
      <section className="panel"><p>GST Number: <strong>{gstNumber || "Not recorded"}</strong></p></section>

      <section className="panel table-wrap">
        <h3>GST Ledger Detail</h3>
        <table className="data-table"><thead><tr><th>Date</th><th>Document</th><th>Type</th><th>GST Type</th><th>Debit</th><th>Credit</th><th>Description</th></tr></thead><tbody>
          {gstLines.map((line, index) => {
            const h = header.get(line.journalId)!;
            return <tr key={`${line.journalId}-${index}`}><td>{h.postingDate}</td><td>{h.documentNumber}</td><td>{h.documentType}</td><td>{line.accountId === "ACC-1140" ? "Input GST" : "Output GST"}</td><td>{n(line.debit) ? money(line.debit) : "—"}</td><td>{n(line.credit) ? money(line.credit) : "—"}</td><td>{line.description}</td></tr>;
          })}
          {!gstLines.length && <tr><td colSpan={7}>No posted GST transactions.</td></tr>}
        </tbody></table>
      </section>
    </>
  );
}
