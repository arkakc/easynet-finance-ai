import { listTable } from "@/lib/backend/apps-script";

export const dynamic = "force-dynamic";

type DocumentRow = {
  documentId: string;
  sourceFileName: string;
  driveUrl: string;
  sha256: string;
  documentType: string;
  documentNumber: string;
  partyType: string;
  partyId: string;
  projectId: string;
  documentDate: string;
  netAmount: number | string;
  gstAmount: number | string;
  totalAmount: number | string;
  currency: string;
  aiConfidence: number | string;
  status: string;
  createdAt: string;
};

type Line = {
  documentLineId: string;
  documentId: string;
  lineNo: number | string;
  description: string;
  qty: number | string;
  uom: string;
  rate: number | string;
  netAmount: number | string;
  gstAmount: number | string;
  totalAmount: number | string;
};

const n = (value: unknown) => Number(value || 0);
const money = (value: unknown) => `K${n(value).toFixed(2)}`;

export default async function DocumentsPage() {
  let documents: DocumentRow[] = [];
  let lines: Line[] = [];
  let error = "";
  try {
    const [d, l] = await Promise.all([
      listTable<DocumentRow>("Documents", 500, 0),
      listTable<Line>("DocumentLines", 500, 0),
    ]);
    documents = d.rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    lines = l.rows;
  } catch (err) {
    error = err instanceof Error ? err.message : "Document register load failed";
  }

  return (
    <>
      <h2>Source Document Register</h2>
      <p className="small">AI-extracted documents remain review-only until a human confirms the commercial and accounting treatment.</p>
      {error && <section className="panel"><strong>Backend warning:</strong> {error}</section>}

      {documents.map((doc) => {
        const docLines = lines.filter((line) => line.documentId === doc.documentId);
        return (
          <section className="panel" key={doc.documentId}>
            <div className="journal-head">
              <div>
                <strong>{doc.documentType} · {doc.documentNumber || "No document number"}</strong><br />
                <span className="small">{doc.sourceFileName} · {doc.documentId}</span>
              </div>
              <div>
                <strong>{doc.status}</strong><br />
                <span className="small">AI confidence {(n(doc.aiConfidence) * 100).toFixed(1)}%</span>
              </div>
            </div>
            <div className="doc-summary">
              <span>Party: <strong>{doc.partyId || doc.partyType || "Unresolved"}</strong></span>
              <span>Project: <strong>{doc.projectId || "—"}</strong></span>
              <span>Date: <strong>{doc.documentDate || "—"}</strong></span>
              <span>Net: <strong>{money(doc.netAmount)}</strong></span>
              <span>GST: <strong>{money(doc.gstAmount)}</strong></span>
              <span>Total: <strong>{money(doc.totalAmount)}</strong></span>
            </div>
            <p className="small">SHA-256: {doc.sha256 || "—"}</p>
            {doc.driveUrl ? <p><a href={doc.driveUrl} target="_blank" rel="noreferrer">Open retained source document</a></p> : <p className="warning-text">Source binary not yet retained in Drive for this record.</p>}

            {docLines.length > 0 && (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>#</th><th>Description</th><th>Qty</th><th>UOM</th><th>Rate</th><th>Net</th><th>GST</th><th>Total</th></tr></thead>
                  <tbody>{docLines.map((line) => <tr key={line.documentLineId}><td>{line.lineNo}</td><td>{line.description}</td><td>{line.qty}</td><td>{line.uom || "—"}</td><td>{money(line.rate)}</td><td>{money(line.netAmount)}</td><td>{money(line.gstAmount)}</td><td>{money(line.totalAmount)}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
      {!documents.length && !error && <section className="panel">No source documents loaded yet.</section>}
    </>
  );
}
