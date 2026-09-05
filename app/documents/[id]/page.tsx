import Link from "next/link";
import { notFound } from "next/navigation";
import { findRecords } from "@/lib/backend/apps-script";
import { requirePermission } from "@/lib/auth";
import PrintButton from "@/app/components/print-button";

const money = (value: unknown) => `K${Number(value || 0).toFixed(2)}`;

export default async function SourceDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("accounts.read");

  const [docResult, lineResult] = await Promise.all([
    findRecords<any>("Documents", { documentId: id }, 1),
    findRecords<any>("DocumentLines", { documentId: id }, 500),
  ]);
  const doc = docResult.rows[0];
  if (!doc) notFound();
  const lines = lineResult.rows;

  return <div className="document-page">
    <div className="document-toolbar no-print">
      <Link href="/documents">← Source Documents</Link>
      <div className="row-actions">
        {doc.driveUrl && <a className="button-link secondary-link" href={doc.driveUrl} target="_blank" rel="noreferrer">Open Original</a>}
        <PrintButton />
      </div>
    </div>

    <section className="document-sheet">
      <header className="document-header">
        <div>
          <div className="eyebrow">SOURCE DOCUMENT / AI EVIDENCE</div>
          <h1>{doc.documentType || "Source Document"}</h1>
          <div className="document-number">{doc.documentNumber || doc.documentId}</div>
        </div>
        <div className={`status-pill status-${String(doc.status || "review").toLowerCase()}`}>{doc.status || "REVIEW"}</div>
      </header>

      <div className="document-meta">
        <div><span>File</span><strong>{doc.sourceFileName || "—"}</strong></div>
        <div><span>Party</span><strong>{doc.partyId || doc.partyType || "Unresolved"}</strong></div>
        <div><span>Project</span><strong>{doc.projectId || "—"}</strong></div>
        <div><span>Date</span><strong>{doc.documentDate || "—"}</strong></div>
        <div><span>Net</span><strong>{money(doc.netAmount)}</strong></div>
        <div><span>GST</span><strong>{money(doc.gstAmount)}</strong></div>
        <div><span>Total</span><strong>{money(doc.totalAmount)}</strong></div>
        <div><span>Currency</span><strong>{doc.currency || "PGK"}</strong></div>
        <div><span>AI Confidence</span><strong>{(Number(doc.aiConfidence || 0) * 100).toFixed(1)}%</strong></div>
      </div>

      {lines.length > 0 && <div className="document-lines">
        <table className="data-table">
          <thead><tr><th>#</th><th>Description</th><th>Qty</th><th>UOM</th><th>Rate</th><th>Net</th><th>GST</th><th>Total</th></tr></thead>
          <tbody>{lines.map((line: any) => <tr key={line.documentLineId}>
            <td>{line.lineNo}</td><td>{line.description}</td><td>{line.qty}</td><td>{line.uom || "—"}</td><td>{money(line.rate)}</td><td>{money(line.netAmount)}</td><td>{money(line.gstAmount)}</td><td><strong>{money(line.totalAmount)}</strong></td>
          </tr>)}</tbody>
        </table>
      </div>}

      <div className="evidence-block">
        <span>SHA-256 Evidence Fingerprint</span>
        <code>{doc.sha256 || "—"}</code>
      </div>
      <div className="document-footer"><span>Human review required before accounting action.</span><span>Record ID: {doc.documentId}</span></div>
    </section>
  </div>;
}
