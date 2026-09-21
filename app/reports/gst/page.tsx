import Link from "next/link";
import { listTable } from "@/lib/backend/apps-script";
import { prisma } from "@/src/lib/prisma";

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
    // Core operational data is Prisma-only. Optional Apps Script integrations
    // must never switch this route away from the authoritative database.
    const backendConfigured = false;
    if (!backendConfigured) {
      const [storedSettings, journalHeaders, journalLines] = await Promise.all([
        prisma.globalSettings.findMany({ where: { key: { in: ["gst_status", "gst_number"] } } }),
        prisma.journalHeader.findMany({ where: { status: "POSTED" } }),
        prisma.journalLine.findMany({ include: { account: true } }),
      ]);
      settings = storedSettings.map((row) => ({ key: row.key, value: row.value || "", notes: row.description || "" }));
      headers = journalHeaders.map((row) => ({
        journalId: row.id,
        postingDate: row.date.toISOString(),
        documentType: row.sourceDocType || "JOURNAL",
        documentNumber: row.sourceDocId || "",
        status: row.status,
      }));
      const accountById = new Map(journalLines.map((row) => [row.accountId, row.account.code]));
      lines = journalLines.map((row) => ({
        journalId: row.journalId,
        accountId: `ACC-${accountById.get(row.accountId) || ""}`,
        debit: Number(row.debit),
        credit: Number(row.credit),
        taxCode: row.taxCode || "",
        description: row.description,
      }));
    } else {
      const [s, h, l] = await Promise.all([
        listTable<Setting>("Settings", 500, 0),
        listTable<Header>("JournalHeaders", 500, 0),
        listTable<Line>("JournalLines", 500, 0),
      ]);
      settings = s.rows; headers = h.rows.filter((row) => normalized(row.status) === "POSTED"); lines = l.rows;
    }
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
  // The controlled PNG COA uses 2121 for output GST and 2122 for input GST.
  // Do not use the legacy 1140/2120 parent codes: 1140 is inventory and 2120
  // is a statutory-tax parent, so either would misstate the GST return.
  const gstLines = lines
    .filter((line) => ["ACC-2121", "ACC-2122"].includes(String(line.accountId)) && header.has(String(line.journalId)))
    .sort((a, b) => String(header.get(String(a.journalId))?.postingDate || "").localeCompare(String(header.get(String(b.journalId))?.postingDate || "")));
  const inputGst = gstLines.filter((line) => line.accountId === "ACC-2122").reduce((sum, line) => sum + n(line.debit) - n(line.credit), 0);
  const outputGst = gstLines.filter((line) => line.accountId === "ACC-2121").reduce((sum, line) => sum + n(line.credit) - n(line.debit), 0);
  const netPayable = outputGst - inputGst;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>GST Control Report</h2>
          <p className="small">Management GST ledger derived only from POSTED journal entries according to PNG IRC tax rules.</p>
        </div>
        <div className="page-head-actions">
          {status !== "VERIFIED" && (
            <details className="system-notice-tab">
              <summary>
                <span>ℹ️ System Notice</span>
                <span className="notice-arrow">▾</span>
              </summary>
              <div className="system-notice-dropdown">
                <strong>GST control status: {status}.</strong> GST posting/reporting should be reviewed before relying on this control report. Formal tax filing still requires reconciliation to registration evidence and source documents.
              </div>
            </details>
          )}
        </div>
      </div>

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
            return <tr key={`${line.journalId}-${index}`}><td>{h.postingDate}</td><td>{h.documentNumber}</td><td>{h.documentType}</td><td>{line.accountId === "ACC-2122" ? "Input GST" : "Output GST"}</td><td>{n(line.debit) ? money(line.debit) : "—"}</td><td>{n(line.credit) ? money(line.credit) : "—"}</td><td>{line.description}</td><td><Link href={`/journals/${encodeURIComponent(String(line.journalId))}`}>View</Link></td></tr>;
          })}
          {!gstLines.length && <tr><td colSpan={8}>No posted GST transactions.</td></tr>}
        </tbody></table>
      </section>
    </>
  );
}
