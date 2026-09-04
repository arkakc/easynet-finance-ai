import { listTable } from "@/lib/backend/apps-script";

export const dynamic = "force-dynamic";

type Setting = { key: string; value: string; notes: string };
type Invoice = { invoiceId: string; invoiceNumber: string; status: string; gstAmount: number | string; totalAmount: number | string };
type Bill = { billId: string; billNumber: string; supplierId: string; projectId: string; poId: string; status: string; totalAmount: number | string };
type PO = { poId: string; poNumber: string; supplierId: string; projectId: string; status: string; totalAmount: number | string };
type Movement = { movementId: string; movementType: string; sourceDocumentId: string; itemId: string; qtyIn: number | string; projectId: string };
type Doc = { documentId: string; documentNumber: string; documentType: string; driveFileId: string; status: string };
type Audit = { auditId: string; timestamp: string; actor: string; action: string; tableName: string; recordId: string; details: string };
type ExceptionRow = { exceptionId: string; severity: string; module: string; recordType: string; recordId: string; message: string; status: string };

const n = (value: unknown) => Number(value || 0);
const money = (value: unknown) => `K${n(value).toFixed(2)}`;

export default async function ControlsPage() {
  let settings: Setting[] = [];
  let invoices: Invoice[] = [];
  let bills: Bill[] = [];
  let pos: PO[] = [];
  let movements: Movement[] = [];
  let docs: Doc[] = [];
  let audit: Audit[] = [];
  let savedExceptions: ExceptionRow[] = [];
  let error = "";

  try {
    const [s, i, b, p, m, d, a, e] = await Promise.all([
      listTable<Setting>("Settings", 500, 0),
      listTable<Invoice>("Invoices", 500, 0),
      listTable<Bill>("SupplierBills", 500, 0),
      listTable<PO>("PurchaseOrders", 500, 0),
      listTable<Movement>("StockMovements", 500, 0),
      listTable<Doc>("Documents", 500, 0),
      listTable<Audit>("AuditLog", 500, 0),
      listTable<ExceptionRow>("Exceptions", 500, 0),
    ]);
    settings = s.rows;
    invoices = i.rows;
    bills = b.rows;
    pos = p.rows;
    movements = m.rows;
    docs = d.rows;
    audit = a.rows.sort((x, y) => String(y.timestamp).localeCompare(String(x.timestamp))).slice(0, 100);
    savedExceptions = e.rows;
  } catch (err) {
    error = err instanceof Error ? err.message : "Control-centre load failed";
  }

  const setting = (key: string) => settings.find((row) => row.key === key)?.value || "";
  const poMap = new Map(pos.map((po) => [po.poId, po]));
  const purchaseReceiptsByPo = new Map<string, Movement[]>();
  for (const movement of movements.filter((row) => row.movementType === "PURCHASE_RECEIPT" && row.sourceDocumentId)) {
    const current = purchaseReceiptsByPo.get(movement.sourceDocumentId) || [];
    current.push(movement);
    purchaseReceiptsByPo.set(movement.sourceDocumentId, current);
  }

  const matchChecks = bills.filter((bill) => bill.poId).map((bill) => {
    const po = poMap.get(bill.poId);
    const receipts = purchaseReceiptsByPo.get(bill.poId) || [];
    const problems: string[] = [];
    if (!po) problems.push("Referenced PO not found");
    if (po && po.supplierId !== bill.supplierId) problems.push("Supplier mismatch");
    if (po && po.projectId !== bill.projectId) problems.push("Project mismatch");
    if (po && Math.abs(n(po.totalAmount) - n(bill.totalAmount)) > 0.01) problems.push(`Amount mismatch: PO ${money(po.totalAmount)} vs Bill ${money(bill.totalAmount)}`);
    if (!receipts.length) problems.push("No purchase receipt recorded against PO");
    if (receipts.some((receipt) => po && receipt.projectId && receipt.projectId !== po.projectId)) problems.push("Receipt project mismatch");
    return { bill, po, receipts, problems, passed: problems.length === 0 };
  });

  const pendingApproval = [
    ...invoices.filter((row) => row.status === "DRAFT").map((row) => `Invoice ${row.invoiceNumber}`),
    ...bills.filter((row) => row.status === "DRAFT").map((row) => `Supplier Bill ${row.billNumber}`),
  ];
  const missingSource = docs.filter((doc) => !doc.driveFileId);
  const gstBearingDrafts = [
    ...invoices.filter((row) => n(row.gstAmount) > 0 && row.status === "DRAFT").map((row) => row.invoiceNumber),
  ];
  const failedMatches = matchChecks.filter((row) => !row.passed);

  return (
    <>
      <h2>Finance Control Centre</h2>
      <p className="small">Exceptions, approval queues, source-document retention and purchase three-way matching controls.</p>
      {error && <section className="panel"><strong>Backend warning:</strong> {error}</section>}

      <div className="grid">
        <div className="card"><div className="label">GST Status</div><div className="value small-value">{setting("gst_status") || "UNVERIFIED"}</div></div>
        <div className="card"><div className="label">Pending Approvals</div><div className="value">{pendingApproval.length}</div></div>
        <div className="card"><div className="label">3-Way Match Exceptions</div><div className="value">{failedMatches.length}</div></div>
        <div className="card"><div className="label">Source Upload Pending</div><div className="value">{missingSource.length}</div></div>
      </div>

      {setting("gst_status") !== "VERIFIED" && gstBearingDrafts.length > 0 && (
        <section className="panel warning-panel"><h3>GST Posting Block</h3><p>GST status is not VERIFIED. GST-bearing invoices cannot be posted until evidence is recorded in Finance Settings.</p></section>
      )}

      <section className="panel table-wrap">
        <h3>PO ↔ Supplier Bill ↔ Goods Receipt Match</h3>
        <p className="small">Checks PO reference, supplier, project, PO-vs-bill total and at least one PURCHASE_RECEIPT movement linked to the PO. Service-only purchases still require manual service-completion evidence.</p>
        <table className="data-table"><thead><tr><th>Bill</th><th>PO</th><th>Supplier</th><th>Project</th><th>Bill Total</th><th>Receipts</th><th>Result</th></tr></thead><tbody>
          {matchChecks.map(({ bill, po, receipts, problems, passed }) => <tr key={bill.billId}><td>{bill.billNumber}</td><td>{po?.poNumber || bill.poId}</td><td>{bill.supplierId}</td><td>{bill.projectId || "—"}</td><td>{money(bill.totalAmount)}</td><td>{receipts.length}</td><td>{passed ? <strong>PASS</strong> : <span className="warning-text">{problems.join("; ")}</span>}</td></tr>)}
          {!matchChecks.length && <tr><td colSpan={7}>No supplier bills linked to purchase orders yet.</td></tr>}
        </tbody></table>
      </section>

      <section className="panel table-wrap">
        <h3>Pending Approval Queue</h3>
        <table className="data-table"><thead><tr><th>Document</th><th>Control</th></tr></thead><tbody>
          {pendingApproval.map((item) => <tr key={item}><td>{item}</td><td>Finance Controller review required before posting</td></tr>)}
          {!pendingApproval.length && <tr><td colSpan={2}>No draft accounting documents awaiting posting.</td></tr>}
        </tbody></table>
      </section>

      <section className="panel table-wrap">
        <h3>Source Retention Queue</h3>
        <table className="data-table"><thead><tr><th>Document</th><th>Type</th><th>Status</th></tr></thead><tbody>
          {missingSource.map((doc) => <tr key={doc.documentId}><td>{doc.documentNumber || doc.documentId}</td><td>{doc.documentType}</td><td className="warning-text">Google Drive binary upload pending</td></tr>)}
          {!missingSource.length && <tr><td colSpan={3}>All registered sources have retained Drive files.</td></tr>}
        </tbody></table>
      </section>

      <section className="panel table-wrap">
        <h3>Saved Exceptions</h3>
        <table className="data-table"><thead><tr><th>Severity</th><th>Module</th><th>Record</th><th>Message</th><th>Status</th></tr></thead><tbody>
          {savedExceptions.map((row) => <tr key={row.exceptionId}><td>{row.severity}</td><td>{row.module}</td><td>{row.recordType} {row.recordId}</td><td>{row.message}</td><td>{row.status}</td></tr>)}
          {!savedExceptions.length && <tr><td colSpan={5}>No persisted exceptions.</td></tr>}
        </tbody></table>
      </section>

      <section className="panel table-wrap">
        <h3>Recent Audit Trail</h3>
        <table className="data-table"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Table</th><th>Record</th><th>Details</th></tr></thead><tbody>
          {audit.map((row) => <tr key={row.auditId}><td>{row.timestamp}</td><td>{row.actor}</td><td>{row.action}</td><td>{row.tableName}</td><td>{row.recordId || "—"}</td><td>{row.details}</td></tr>)}
        </tbody></table>
      </section>
    </>
  );
}
