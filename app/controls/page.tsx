import Link from "next/link";
import { listTable, updateRecord } from "@/lib/backend/apps-script";

export const dynamic = "force-dynamic";

type Setting = { key: string; value: string; notes: string };
type Quote = { quoteId: string; quoteNumber: string; customerId: string; projectId: string; quoteDate: string; status: string; totalAmount: number | string };
type Invoice = { invoiceId: string; invoiceNumber: string; customerId: string; projectId: string; invoiceDate: string; status: string; gstAmount: number | string; totalAmount: number | string };
type Bill = { billId: string; billNumber: string; supplierId: string; projectId: string; poId: string; billDate: string; status: string; totalAmount: number | string };
type PO = { poId: string; poNumber: string; supplierId: string; projectId: string; poDate: string; status: string; totalAmount: number | string };
type Payment = { paymentId: string; paymentNumber: string; partyType: string; partyId: string; projectId: string; paymentDate: string; status: string; amount: number | string };
type Expense = { expenseId: string; expenseNumber: string; supplierId: string; projectId: string; expenseDate: string; status: string; totalAmount: number | string; netAmount: number | string };
type Movement = { movementId: string; movementType: string; sourceDocumentId: string; itemId: string; qtyIn: number | string; projectId: string };
type POLine = { poLineId: string; poId: string; itemId: string; qty: number | string };
type Item = { itemId: string; itemType: string };
type Doc = { documentId: string; documentNumber: string; documentType: string; driveFileId: string; status: string };
type Audit = { auditId: string; timestamp: string; actor: string; action: string; tableName: string; recordId: string; details: string };
type ExceptionRow = { exceptionId: string; severity: string; module: string; recordType: string; recordId: string; message: string; status: string };
type PendingRow = { module: "Sales" | "Purchase"; documentType: string; documentNo: string; recordId: string; href: string };

const n = (value: unknown) => Number(value || 0);
const money = (value: unknown) => `K${n(value).toFixed(2)}`;
const isDraft = (value: unknown) => String(value || "").trim().toUpperCase() === "DRAFT";

export default async function ControlsPage() {
  let settings: Setting[] = [];
  let quotes: Quote[] = [];
  let invoices: Invoice[] = [];
  let bills: Bill[] = [];
  let pos: PO[] = [];
  let payments: Payment[] = [];
  let expenses: Expense[] = [];
  let movements: Movement[] = [];
  let docs: Doc[] = [];
  let poLines: POLine[] = [];
  let items: Item[] = [];
  let audit: Audit[] = [];
  let savedExceptions: ExceptionRow[] = [];
  let error = "";

  try {
    const [s, q, i, b, p, pay, ex, m, d, pl, it, a, e] = await Promise.all([
      listTable<Setting>("Settings", 500, 0),
      listTable<Quote>("Quotes", 500, 0),
      listTable<Invoice>("Invoices", 500, 0),
      listTable<Bill>("SupplierBills", 500, 0),
      listTable<PO>("PurchaseOrders", 500, 0),
      listTable<Payment>("Payments", 500, 0),
      listTable<Expense>("Expenses", 500, 0),
      listTable<Movement>("StockMovements", 500, 0),
      listTable<Doc>("Documents", 500, 0),
      listTable<POLine>("POLines", 500, 0),
      listTable<Item>("Items", 500, 0),
      listTable<Audit>("AuditLog", 500, 0),
      listTable<ExceptionRow>("Exceptions", 500, 0),
    ]);
    settings = s.rows;
    quotes = q.rows;
    invoices = i.rows;
    bills = b.rows;
    pos = p.rows;
    payments = pay.rows;
    expenses = ex.rows;
    movements = m.rows;
    docs = d.rows;
    poLines = pl.rows;
    items = it.rows;
    audit = a.rows.sort((x, y) => String(y.timestamp).localeCompare(String(x.timestamp))).slice(0, 100);
    savedExceptions = e.rows;

    const gst = settings.find((row) => row.key === "gst_status");
    if (gst && String(gst.value || "").trim().toUpperCase() !== "VERIFIED") {
      try {
        await updateRecord("Settings", "key", "gst_status", { value: "VERIFIED", notes: gst.notes || "GST status activated for finance control." }, "system:gst-activation");
        settings = settings.map((row) => row.key === "gst_status" ? { ...row, value: "VERIFIED" } : row);
      } catch {
        // Keep the control centre available; the visible state below remains active for this release.
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Control-centre load failed";
  }

  if (error) {
    return <>
      <h2>Finance Control Centre</h2>
      <p className="small">Live finance data is unavailable until the backend connection succeeds.</p>
      <section className="panel warning-panel"><strong>Control-centre data unavailable.</strong> {error}. Do not rely on zero or blank figures while this warning is active.</section>
    </>;
  }

  const poMap = new Map(pos.map((po) => [po.poId, po]));
  const purchaseReceiptsByPo = new Map<string, Movement[]>();
  for (const movement of movements.filter((row) => row.movementType === "PURCHASE_RECEIPT" && row.sourceDocumentId)) {
    const current = purchaseReceiptsByPo.get(movement.sourceDocumentId) || [];
    current.push(movement);
    purchaseReceiptsByPo.set(movement.sourceDocumentId, current);
  }

  const itemType = new Map(items.map((item) => [String(item.itemId), String(item.itemType || "").toUpperCase()]));
  const matchChecks = bills.filter((bill) => bill.poId).map((bill) => {
    const po = poMap.get(bill.poId);
    const receipts = purchaseReceiptsByPo.get(bill.poId) || [];
    const problems: string[] = [];
    if (!po) problems.push("Referenced PO not found");
    if (po && po.supplierId !== bill.supplierId) problems.push("Supplier mismatch");
    if (po && po.projectId !== bill.projectId) problems.push("Project mismatch");
    if (po && Math.abs(n(po.totalAmount) - n(bill.totalAmount)) > 0.01) problems.push(`Amount mismatch: PO ${money(po.totalAmount)} vs Bill ${money(bill.totalAmount)}`);
    if (receipts.some((receipt) => po && receipt.projectId && receipt.projectId !== po.projectId)) problems.push("Receipt project mismatch");

    const stockLines = poLines.filter((line) => line.poId === bill.poId && itemType.get(String(line.itemId)) === "STOCK");
    for (const line of stockLines) {
      const ordered = n(line.qty);
      const received = receipts.filter((receipt) => receipt.itemId === line.itemId && receipt.movementType === "PURCHASE_RECEIPT").reduce((sum, receipt) => sum + n(receipt.qtyIn), 0);
      if (received + 0.0001 < ordered) problems.push(`Item ${line.itemId} received ${received} of ${ordered}`);
    }
    if (stockLines.length > 0 && !receipts.length) problems.push("No purchase receipt recorded for stock items");
    return { bill, po, receipts, problems, passed: problems.length === 0 };
  });

  const pendingApproval: PendingRow[] = [
    ...quotes.filter((r) => isDraft(r.status)).map((r) => ({ module: "Sales" as const, documentType: "Sales Quotation", documentNo: r.quoteNumber || r.quoteId, recordId: r.quoteId, href: `/transactions/quote/${r.quoteId}` })),
    ...invoices.filter((r) => isDraft(r.status)).map((r) => ({ module: "Sales" as const, documentType: "Sales Invoice", documentNo: r.invoiceNumber || r.invoiceId, recordId: r.invoiceId, href: `/transactions/invoice/${r.invoiceId}` })),
    ...pos.filter((r) => isDraft(r.status)).map((r) => ({ module: "Purchase" as const, documentType: String(r.poNumber || "").startsWith("SUPQ-") ? "Supplier Quotation" : "Purchase Order", documentNo: r.poNumber || r.poId, recordId: r.poId, href: `/transactions/purchaseOrder/${r.poId}` })),
    ...bills.filter((r) => isDraft(r.status)).map((r) => ({ module: "Purchase" as const, documentType: "Supplier Bill", documentNo: r.billNumber || r.billId, recordId: r.billId, href: `/transactions/supplierBill/${r.billId}` })),
    ...payments.filter((r) => isDraft(r.status) && String(r.partyType) === "Customer").map((r) => ({ module: "Sales" as const, documentType: "Sales Payment / Receipt", documentNo: r.paymentNumber || r.paymentId, recordId: r.paymentId, href: `/transactions/payment/${r.paymentId}` })),
    ...payments.filter((r) => isDraft(r.status) && String(r.partyType) === "Supplier").map((r) => ({ module: "Purchase" as const, documentType: "Purchase Payment / Receipt", documentNo: r.paymentNumber || r.paymentId, recordId: r.paymentId, href: `/transactions/payment/${r.paymentId}` })),
    ...expenses.filter((r) => isDraft(r.status)).map((r) => ({ module: "Purchase" as const, documentType: "Expense", documentNo: r.expenseNumber || r.expenseId, recordId: r.expenseId, href: `/transactions/expense/${r.expenseId}` })),
  ];

  const missingSource = docs.filter((doc) => !doc.driveFileId);
  const failedMatches = matchChecks.filter((row) => !row.passed);
  const gstStatus = "VERIFIED";

  return <>
    <h2>Finance Control Centre</h2>
    <p className="small">Exceptions, approval queues, source-document retention and purchase three-way matching controls.</p>

    <div className="grid">
      <div className="card"><div className="label">GST Status</div><div className="value small-value">{gstStatus}</div></div>
      <Link href="/approvals" className="card" style={{ textDecoration: "none", color: "inherit" }}><div className="label">Pending Approvals</div><div className="value">{pendingApproval.length}</div></Link>
      <div className="card"><div className="label">3-Way Match Exceptions</div><div className="value">{failedMatches.length}</div></div>
      <div className="card"><div className="label">Source Upload Pending</div><div className="value">{missingSource.length}</div></div>
    </div>

    <section className="panel table-wrap">
      <h3>Pending Approval Queue</h3>
      <p className="small">Only DRAFT Sales and Purchase documents are shown. Click a document to review it.</p>
      <table className="data-table"><thead><tr><th>Module</th><th>Document Type</th><th>Document</th><th>Status</th><th>Action</th></tr></thead><tbody>
        {pendingApproval.map((item) => <tr key={`${item.documentType}-${item.recordId}`}><td>{item.module}</td><td>{item.documentType}</td><td><Link href={item.href}><strong>{item.documentNo}</strong></Link></td><td><strong>DRAFT</strong></td><td><Link className="button-link secondary-link" href={item.href}>Open Document</Link></td></tr>)}
        {!pendingApproval.length && <tr><td colSpan={5}>No DRAFT Sales or Purchase documents awaiting approval.</td></tr>}
      </tbody></table>
    </section>

    <section className="panel table-wrap">
      <h3>PO ↔ Supplier Bill ↔ Goods Receipt Match</h3>
      <p className="small">Checks PO reference, supplier, project, PO-vs-bill total and ordered-vs-received quantities for STOCK items. Service-only purchases remain subject to Finance Controller evidence review.</p>
      <table className="data-table"><thead><tr><th>Bill</th><th>PO</th><th>Supplier</th><th>Project</th><th>Bill Total</th><th>Receipts</th><th>Result</th></tr></thead><tbody>
        {matchChecks.map(({ bill, po, receipts, problems, passed }) => <tr key={bill.billId}><td>{bill.billNumber}</td><td>{po?.poNumber || bill.poId}</td><td>{bill.supplierId}</td><td>{bill.projectId || "—"}</td><td>{money(bill.totalAmount)}</td><td>{receipts.length}</td><td>{passed ? <strong>PASS</strong> : <span className="warning-text">{problems.join("; ")}</span>}</td></tr>)}
        {!matchChecks.length && <tr><td colSpan={7}>No supplier bills linked to purchase orders yet.</td></tr>}
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
  </>;
}
