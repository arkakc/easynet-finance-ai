import Link from "next/link";
import { listTable } from "@/lib/backend/apps-script";
import { round2, signedMovementValue } from "@/lib/accounting/inventory";
import { buildFinancialReconciliationSnapshot } from "@/lib/system/financial-reconciliation";
import { prisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";

type Setting = { key: string; value: string; notes: string };
type Quote = { quoteId: string; quoteNumber: string; customerId: string; projectId: string; quoteDate: string; status: string; totalAmount: number | string };
type Invoice = { invoiceId: string; invoiceNumber: string; customerId: string; projectId: string; invoiceDate: string; status: string; gstAmount: number | string; totalAmount: number | string; outstandingAmount?: number | string; journalId?: string };
type Bill = { billId: string; billNumber: string; supplierId: string; projectId: string; poId: string; sourceDocumentId?: string; billDate: string; status: string; totalAmount: number | string; outstandingAmount?: number | string; journalId?: string };
type PO = { poId: string; poNumber: string; supplierId: string; projectId: string; poDate: string; status: string; totalAmount: number | string };
type Payment = { paymentId: string; paymentNumber: string; paymentType?: string; partyType: string; partyId: string; projectId: string; paymentDate: string; status: string; amount: number | string; journalId?: string; againstDocumentId?: string; sourceDocumentId?: string };
type Expense = { expenseId: string; expenseNumber: string; supplierId: string; projectId: string; expenseDate: string; status: string; totalAmount: number | string; netAmount: number | string };
type Movement = { movementId: string; movementType: string; sourceDocumentId: string; itemId: string; qtyIn: number | string; qtyOut?: number | string; value?: number | string; valueAdjustment?: number | string; projectId: string };
type POLine = { poLineId: string; poId: string; itemId: string; qty: number | string; rate?: number | string; netAmount?: number | string };
type BillLine = { billLineId: string; billId: string; itemId: string; qty: number | string; rate?: number | string; netAmount?: number | string; gstAmount?: number | string; totalAmount?: number | string };
type Item = { itemId: string; itemCode?: string; itemName?: string; itemType: string; uom?: string };
type Doc = { documentId: string; documentNumber: string; documentType: string; driveFileId: string; status: string };
type Audit = { auditId: string; timestamp: string; actor: string; action: string; tableName: string; recordId: string; details: string };
type ExceptionRow = { exceptionId: string; severity: string; module: string; recordType: string; recordId: string; message: string; status: string };
type JournalHeader = { journalId: string; status: string };
type JournalLine = { journalLineId: string; journalId: string; accountId: string; debit: number | string; credit: number | string };
type PaymentSchedule = { scheduleId: string; sourceType: string; sourceId: string; amount: number | string; status: string };
type PendingRow = { module: "Sales" | "Purchase"; documentType: string; documentNo: string; recordId: string; href: string };
type MatchCheck = { bill: Bill; po?: PO; lineSummary: string[]; problems: string[]; passed: boolean };

const n = (value: unknown) => Number(value || 0);
const money = (value: unknown) => `K${n(value).toFixed(2)}`;
const currencyMoney = (value: unknown, currency: string) =>
  new Intl.NumberFormat("en-PG", {
    style: "currency",
    currency: currency || "PGK",
    minimumFractionDigits: 2,
  }).format(n(value));
const normalized = (value: unknown) => String(value || "").trim().toUpperCase();
const isDraft = (value: unknown) => normalized(value) === "DRAFT";
const isExcluded = (value: unknown) => ["CANCELLED", "REVERSED"].includes(normalized(value));
const tolerance = 0.0001;

function aggregateQty(rows: Array<{ itemId: string; qty: number | string }>) {
  const result = new Map<string, number>();
  for (const row of rows) {
    const itemId = String(row.itemId || "");
    if (!itemId) continue;
    result.set(itemId, (result.get(itemId) || 0) + n(row.qty));
  }
  return result;
}

export default async function ControlsPage() {
  // Core operational data is Prisma-only. Optional Apps Script integrations
    // must never switch this route away from the authoritative database.
    const backendConfigured = false;

  if (!backendConfigured) {
    const asOf = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Pacific/Port_Moresby",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    const [snapshot, purchaseOrders, expenses] = await Promise.all([
      buildFinancialReconciliationSnapshot({
        asOf,
        generatedBy: "finance-control-centre",
        source: "local-sqlite",
      }),
      prisma.purchaseOrder.findMany({
        where: { status: { notIn: ["BILLED", "CLOSED", "Cancelled"] } },
        select: { total: true },
      }),
      prisma.expense.findMany({ select: { total: true } }),
    ]);

    const poCommitments = purchaseOrders.reduce((sum, row) => sum + n(row.total), 0);
    const expenseTotal = expenses.reduce((sum, row) => sum + n(row.total), 0);
    const reconciliationRows = [
      {
        label: `Accounts Receivable (${snapshot.receivables.controlAccount})`,
        gl: snapshot.receivables.glBalance,
        comparison: snapshot.receivables.outstanding,
        difference: snapshot.receivables.difference,
        matched: snapshot.receivables.matched,
      },
      {
        label: `Accounts Payable (${snapshot.payables.controlAccount})`,
        gl: snapshot.payables.glBalance,
        comparison: snapshot.payables.outstanding,
        difference: snapshot.payables.difference,
        matched: snapshot.payables.matched,
      },
      {
        label: `Inventory (${snapshot.inventory.controlAccount})`,
        gl: snapshot.inventory.glBalance,
        comparison: snapshot.inventory.estimatedValue,
        difference: snapshot.inventory.difference,
        matched: snapshot.inventory.matched,
      },
    ];
    const reconciliationExceptions = reconciliationRows.filter((row) => !row.matched).length
      + (snapshot.banking.reconciliationsMatched ? 0 : 1);

    return <>
      <div className="page-head">
        <div>
          <h2>Finance Control Centre</h2>
          <p className="small">Posted-ledger reconciliation and reporting integrity as at {snapshot.asOf}.</p>
        </div>
        <div className="page-head-actions">
          <Link className="button-link secondary-link" href="/reports">Financial Statements</Link>
          <Link className="button-link secondary-link" href="/banking">Bank Reconciliation</Link>
          <span className="badge">{snapshot.currency}</span>
        </div>
      </div>

      <div className="grid">
        <div className="card"><div className="label">Ledger Status</div><div className="value small-value">{snapshot.controls.ledgerBalanced ? "BALANCED" : "REVIEW"}</div><div className="small">{snapshot.ledger.postedJournals} journals · {snapshot.ledger.journalLines} lines</div></div>
        <div className="card"><div className="label">AR Outstanding</div><div className="value">{currencyMoney(snapshot.receivables.outstanding, snapshot.currency)}</div><div className="small">{snapshot.receivables.documents} documents</div></div>
        <div className="card"><div className="label">AP Outstanding</div><div className="value">{currencyMoney(snapshot.payables.outstanding, snapshot.currency)}</div><div className="small">{snapshot.payables.documents} documents</div></div>
        <div className="card"><div className="label">Inventory Value</div><div className="value">{currencyMoney(snapshot.inventory.estimatedValue, snapshot.currency)}</div><div className="small">{snapshot.inventory.stockLines} warehouse/item positions</div></div>
        <div className="card"><div className="label">Bank GL</div><div className="value">{currencyMoney(snapshot.banking.glBookBalance, snapshot.currency)}</div><div className="small">{snapshot.banking.mappedAccounts}/{snapshot.banking.activeAccounts} accounts mapped</div></div>
        <div className="card"><div className="label">Reconciliation Exceptions</div><div className="value">{reconciliationExceptions}</div></div>
        <div className="card"><div className="label">Unreconciled Bank Rows</div><div className="value">{snapshot.banking.unreconciledTransactions}</div></div>
        <div className="card"><div className="label">PO Commitments</div><div className="value">{currencyMoney(poCommitments, snapshot.currency)}</div></div>
        <div className="card"><div className="label">Expenses</div><div className="value">{currencyMoney(expenseTotal, snapshot.currency)}</div></div>
      </div>

      <section className="panel table-wrap">
        <div className="form-title-row">
          <div>
            <h3>Subledger ↔ General Ledger Controls</h3>
            <p className="small">These controls are reconstructed at the selected snapshot date from posted journals and dated operational events.</p>
          </div>
          <span className="auto-badge">{snapshot.controls.migrationReady ? "ALL CLEAR" : "REVIEW REQUIRED"}</span>
        </div>
        <table className="data-table">
          <thead><tr><th>Control</th><th>GL Balance</th><th>Operational Value</th><th>Difference</th><th>Result</th></tr></thead>
          <tbody>
            {reconciliationRows.map((row) => <tr key={row.label}>
              <td><strong>{row.label}</strong></td>
              <td>{currencyMoney(row.gl, snapshot.currency)}</td>
              <td>{currencyMoney(row.comparison, snapshot.currency)}</td>
              <td>{currencyMoney(row.difference, snapshot.currency)}</td>
              <td>{row.matched ? <strong>PASS</strong> : <span className="warning-text">REVIEW</span>}</td>
            </tr>)}
          </tbody>
        </table>
      </section>

      <section className="panel table-wrap">
        <div className="form-title-row">
          <div><h3>Bank Reconciliation Integrity</h3><p className="small">A completed reconciliation is rechecked against the ledger at its original period end. Backdated postings create drift and are flagged.</p></div>
          <span className="auto-badge">{snapshot.banking.reconciliationsMatched ? "PASS" : "REVIEW"}</span>
        </div>
        <table className="data-table">
          <thead><tr><th>Bank</th><th>Currency</th><th>GL Account</th><th>Last Reconciled</th><th>Stored Book</th><th>Recomputed Book</th><th>Drift</th><th>Result</th></tr></thead>
          <tbody>
            {snapshot.banking.accounts.map((row) => <tr key={row.bankAccountId}>
              <td><strong>{row.bankCode}</strong></td>
              <td>{row.currency}</td>
              <td>{row.mappedAccountCode || "—"}</td>
              <td>{row.latestPeriodEnd || "—"}</td>
              <td>{row.storedBookBalance === null ? "—" : currencyMoney(row.storedBookBalance, row.currency)}</td>
              <td>{row.recomputedBookBalance === null ? "—" : currencyMoney(row.recomputedBookBalance, row.currency)}</td>
              <td>{currencyMoney(row.drift, row.currency)}</td>
              <td>{row.matched ? <strong>PASS</strong> : <span className="warning-text">REVIEW</span>}</td>
            </tr>)}
            {!snapshot.banking.accounts.length && <tr><td colSpan={8}>No active bank accounts configured.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h3>Control Exceptions</h3>
        {snapshot.controls.exceptions.length
          ? <ul>{snapshot.controls.exceptions.map((message) => <li key={message}>{message}</li>)}</ul>
          : <p>No reconciliation exceptions detected.</p>}
        <div className="button-row">
          <Link className="link-button" href="/dashboard">Back to Dashboard</Link>
          <Link className="link-button secondary-link" href="/journals">Open Journals</Link>
        </div>
      </section>
    </>;
  }

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
  let billLines: BillLine[] = [];
  let items: Item[] = [];
  let audit: Audit[] = [];
  let savedExceptions: ExceptionRow[] = [];
  let journalHeaders: JournalHeader[] = [];
  let journalLines: JournalLine[] = [];
  let paymentSchedules: PaymentSchedule[] = [];
  let error = "";

  try {
    const [s, q, i, b, p, pay, ex, m, d, pl, bl, it, a, e, jh, jl, ps] = await Promise.all([
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
      listTable<BillLine>("SupplierBillLines", 500, 0),
      listTable<Item>("Items", 500, 0),
      listTable<Audit>("AuditLog", 500, 0),
      listTable<ExceptionRow>("Exceptions", 500, 0),
      listTable<JournalHeader>("JournalHeaders", 500, 0),
      listTable<JournalLine>("JournalLines", 500, 0),
      listTable<PaymentSchedule>("PaymentSchedules", 500, 0),
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
    billLines = bl.rows;
    items = it.rows;
    audit = a.rows.sort((x, y) => String(y.timestamp).localeCompare(String(x.timestamp))).slice(0, 100);
    savedExceptions = e.rows;
    journalHeaders = jh.rows;
    journalLines = jl.rows;
    paymentSchedules = ps.rows;
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

  const poMap = new Map(pos.map((po) => [String(po.poId), po]));
  const itemMap = new Map(items.map((item) => [String(item.itemId), item]));
  const itemType = new Map(items.map((item) => [String(item.itemId), normalized(item.itemType)]));
  const activeBillIds = new Set(bills.filter((bill) => !isExcluded(bill.status)).map((bill) => String(bill.billId)));
  const billLinesByBill = new Map<string, BillLine[]>();
  for (const line of billLines) {
    const current = billLinesByBill.get(String(line.billId)) || [];
    current.push(line);
    billLinesByBill.set(String(line.billId), current);
  }

  const poLinesByPo = new Map<string, POLine[]>();
  for (const line of poLines) {
    const current = poLinesByPo.get(String(line.poId)) || [];
    current.push(line);
    poLinesByPo.set(String(line.poId), current);
  }

  const purchaseReceiptsByPo = new Map<string, Movement[]>();
  for (const movement of movements.filter((row) => normalized(row.movementType) === "PURCHASE_RECEIPT" && row.sourceDocumentId)) {
    const current = purchaseReceiptsByPo.get(String(movement.sourceDocumentId)) || [];
    current.push(movement);
    purchaseReceiptsByPo.set(String(movement.sourceDocumentId), current);
  }

  const matchChecks: MatchCheck[] = bills.filter((bill) => String(bill.poId || bill.sourceDocumentId || "")).map((bill) => {
    const poId = String(bill.poId || bill.sourceDocumentId || "");
    const po = poMap.get(poId);
    const receipts = purchaseReceiptsByPo.get(poId) || [];
    const currentBillLines = billLinesByBill.get(String(bill.billId)) || [];
    const problems: string[] = [];
    const lineSummary: string[] = [];

    if (!po) problems.push("Referenced PO not found");
    if (po && String(po.supplierId || "") !== String(bill.supplierId || "")) problems.push("Supplier mismatch");
    if (po && String(po.projectId || "") !== String(bill.projectId || "")) problems.push("Project mismatch");
    if (!currentBillLines.length) problems.push("Supplier Invoice has no lines");

    const orderedByItem = aggregateQty((poLinesByPo.get(poId) || []).map((line) => ({ itemId: line.itemId, qty: line.qty })));
    const currentBilledByItem = aggregateQty(currentBillLines.map((line) => ({ itemId: line.itemId, qty: line.qty })));
    const receivedByItem = new Map<string, number>();
    for (const receipt of receipts) {
      const itemId = String(receipt.itemId || "");
      receivedByItem.set(itemId, (receivedByItem.get(itemId) || 0) + n(receipt.qtyIn));
    }

    const cumulativeBilledByItem = new Map<string, number>();
    for (const line of billLines) {
      if (!activeBillIds.has(String(line.billId))) continue;
      const linkedBill = bills.find((candidate) => String(candidate.billId) === String(line.billId));
      const linkedPoId = String(linkedBill?.poId || linkedBill?.sourceDocumentId || "");
      if (linkedPoId !== poId) continue;
      const itemId = String(line.itemId || "");
      cumulativeBilledByItem.set(itemId, (cumulativeBilledByItem.get(itemId) || 0) + n(line.qty));
    }

    for (const [itemId, currentQty] of currentBilledByItem.entries()) {
      const ordered = n(orderedByItem.get(itemId));
      const received = n(receivedByItem.get(itemId));
      const cumulativeBilled = n(cumulativeBilledByItem.get(itemId));
      const stock = itemType.get(itemId) === "STOCK";
      const item = itemMap.get(itemId);
      const label = String(item?.itemCode || item?.itemName || itemId);

      if (ordered <= tolerance) problems.push(`${label}: item is not on the linked Purchase Order`);
      if (cumulativeBilled > ordered + tolerance) problems.push(`${label}: cumulative billed qty ${cumulativeBilled} exceeds ordered qty ${ordered}`);
      if (stock && cumulativeBilled > received + tolerance) problems.push(`${label}: cumulative billed qty ${cumulativeBilled} exceeds received qty ${received}`);

      lineSummary.push(stock
        ? `${label}: this bill ${currentQty}; cumulative billed ${cumulativeBilled}; received ${received}; ordered ${ordered}`
        : `${label}: this bill ${currentQty}; cumulative billed ${cumulativeBilled}; ordered ${ordered} (non-stock/service)`);
    }

    const lineTotal = round2(currentBillLines.reduce((sum, line) => sum + n(line.totalAmount ?? (n(line.netAmount) + n(line.gstAmount))), 0));
    if (currentBillLines.length && Math.abs(lineTotal - n(bill.totalAmount)) > 0.01) {
      problems.push(`Supplier Invoice header total ${money(bill.totalAmount)} does not match line total ${money(lineTotal)}`);
    }

    return { bill, po, lineSummary, problems, passed: problems.length === 0 };
  });

  const pendingApproval: PendingRow[] = [
    ...quotes.filter((r) => isDraft(r.status)).map((r) => ({ module: "Sales" as const, documentType: "Sales Quotation", documentNo: r.quoteNumber || r.quoteId, recordId: r.quoteId, href: `/transactions/quote/${r.quoteId}` })),
    ...invoices.filter((r) => isDraft(r.status)).map((r) => ({ module: "Sales" as const, documentType: String(r.invoiceNumber || "").toUpperCase().startsWith("CN-") ? "Sales Credit Note / Return" : "Sales Invoice", documentNo: r.invoiceNumber || r.invoiceId, recordId: r.invoiceId, href: `/transactions/invoice/${r.invoiceId}` })),
    ...pos.filter((r) => isDraft(r.status)).map((r) => ({ module: "Purchase" as const, documentType: String(r.poNumber || "").startsWith("SUPQ-") ? "Supplier Quotation" : "Purchase Order", documentNo: r.poNumber || r.poId, recordId: r.poId, href: `/transactions/purchaseOrder/${r.poId}` })),
    ...bills.filter((r) => isDraft(r.status)).map((r) => ({ module: "Purchase" as const, documentType: "Supplier Invoice", documentNo: r.billNumber || r.billId, recordId: r.billId, href: `/transactions/supplierBill/${r.billId}` })),
    ...payments.filter((r) => isDraft(r.status) && String(r.partyType) === "Customer").map((r) => ({ module: "Sales" as const, documentType: "Sales Payment / Receipt", documentNo: r.paymentNumber || r.paymentId, recordId: r.paymentId, href: `/transactions/payment/${r.paymentId}` })),
    ...payments.filter((r) => isDraft(r.status) && String(r.partyType) === "Supplier").map((r) => ({ module: "Purchase" as const, documentType: "Purchase Payment / Receipt", documentNo: r.paymentNumber || r.paymentId, recordId: r.paymentId, href: `/transactions/payment/${r.paymentId}` })),
    ...expenses.filter((r) => isDraft(r.status)).map((r) => ({ module: "Purchase" as const, documentType: "Expense", documentNo: r.expenseNumber || r.expenseId, recordId: r.expenseId, href: `/transactions/expense/${r.expenseId}` })),
  ];

  const postedJournalIds = new Set(journalHeaders.filter((row) => normalized(row.status) === "POSTED").map((row) => String(row.journalId)));
  const postedJournalLines = journalLines.filter((row) => postedJournalIds.has(String(row.journalId)));
  const glBalance = (accountId: string) => round2(postedJournalLines.filter((line) => String(line.accountId) === accountId).reduce((sum, line) => sum + n(line.debit) - n(line.credit), 0));

  const unbalancedJournals = journalHeaders.filter((header) => normalized(header.status) === "POSTED").filter((header) => {
    const difference = journalLines.filter((line) => String(line.journalId) === String(header.journalId)).reduce((sum, line) => sum + n(line.debit) - n(line.credit), 0);
    return Math.abs(difference) > 0.01;
  });

  const postedInvoices = invoices.filter((row) => Boolean(String(row.journalId || "").trim()) && !isExcluded(row.status));
  const postedBills = bills.filter((row) => Boolean(String(row.journalId || "").trim()) && !isExcluded(row.status));
  const arGl = glBalance("ACC-1130");
  const apGl = round2(-glBalance("ACC-2110"));
  const inventoryGl = glBalance("ACC-1150");
  const customerAdvancesGl = round2(-glBalance("ACC-2150"));
  const supplierAdvancesGl = glBalance("ACC-1160");
  const grniGl = round2(-glBalance("ACC-2190"));
  const arSubledger = round2(postedInvoices.reduce((sum, row) => sum + n(row.outstandingAmount), 0));
  const apSubledger = round2(postedBills.reduce((sum, row) => sum + n(row.outstandingAmount), 0));
  const inventoryLedger = round2(movements.reduce((sum, row) => sum + signedMovementValue(row), 0));

  const allocationByPayment = new Map<string, number>();
  for (const row of paymentSchedules) {
    if (normalized(row.status) !== "POSTED") continue;
    if (!["CUSTOMER_ADVANCE_ALLOCATION", "SUPPLIER_ADVANCE_ALLOCATION"].includes(normalized(row.sourceType))) continue;
    allocationByPayment.set(String(row.sourceId), (allocationByPayment.get(String(row.sourceId)) || 0) + n(row.amount));
  }
  const advanceSubledger = (partyType: "Customer" | "Supplier") => round2(payments
    .filter((row) => String(row.partyType) === partyType
      && normalized(row.status) === "POSTED"
      && Boolean(String(row.journalId || "").trim())
      && !String(row.againstDocumentId || "").trim()
      && normalized(row.paymentType) === (partyType === "Customer" ? "RECEIVE" : "PAY"))
    .reduce((sum, row) => sum + Math.max(0, n(row.amount) - n(allocationByPayment.get(String(row.paymentId)))), 0));

  const customerAdvanceSubledger = advanceSubledger("Customer");
  const supplierAdvanceSubledger = advanceSubledger("Supplier");

  const reconciliationRows = [
    { label: "Accounts Receivable", gl: arGl, subledger: arSubledger, difference: round2(arGl - arSubledger) },
    { label: "Accounts Payable", gl: apGl, subledger: apSubledger, difference: round2(apGl - apSubledger) },
    { label: "Inventory", gl: inventoryGl, subledger: inventoryLedger, difference: round2(inventoryGl - inventoryLedger) },
    { label: "Customer Advances", gl: customerAdvancesGl, subledger: customerAdvanceSubledger, difference: round2(customerAdvancesGl - customerAdvanceSubledger) },
    { label: "Supplier Advances", gl: supplierAdvancesGl, subledger: supplierAdvanceSubledger, difference: round2(supplierAdvancesGl - supplierAdvanceSubledger) },
  ];

  const missingSource = docs.filter((doc) => !doc.driveFileId && !["DELETED", "CANCELLED"].includes(normalized(doc.status)));
  const failedMatches = matchChecks.filter((row) => !row.passed);
  const gstStatus = normalized(settings.find((row) => row.key === "gst_status")?.value || "UNVERIFIED");
  const reconciliationExceptions = reconciliationRows.filter((row) => Math.abs(row.difference) > 0.01).length;

  return <>
    <h2>Finance Control Centre</h2>
    <p className="small">Exceptions, approval queues, subledger-to-GL reconciliation, source-document retention and partial-aware purchase three-way matching controls.</p>

    <div className="grid">
      <div className="card"><div className="label">GST Status</div><div className="value small-value">{gstStatus}</div></div>
      <Link href="/approvals" className="card" style={{ textDecoration: "none", color: "inherit" }}><div className="label">Pending Approvals</div><div className="value">{pendingApproval.length}</div></Link>
      <div className="card"><div className="label">3-Way Match Exceptions</div><div className="value">{failedMatches.length}</div></div>
      <div className="card"><div className="label">Reconciliation Exceptions</div><div className="value">{reconciliationExceptions}</div></div>
      <div className="card"><div className="label">Unbalanced Posted Journals</div><div className="value">{unbalancedJournals.length}</div></div>
      <div className="card"><div className="label">Source Upload Pending</div><div className="value">{missingSource.length}</div></div>
    </div>

    <section className="panel table-wrap">
      <div className="form-title-row"><div><h3>Accounting Integrity Snapshot</h3><p className="small">Posted GL balances are compared with operational subledgers. A non-zero difference requires review before production sign-off.</p></div><span className="auto-badge">GRNI {money(grniGl)}</span></div>
      <table className="data-table"><thead><tr><th>Control</th><th>GL Balance</th><th>Operational Subledger</th><th>Difference</th><th>Result</th></tr></thead><tbody>
        {reconciliationRows.map((row) => <tr key={row.label}><td><strong>{row.label}</strong></td><td>{money(row.gl)}</td><td>{money(row.subledger)}</td><td>{money(row.difference)}</td><td>{Math.abs(row.difference) <= 0.01 ? <strong>PASS</strong> : <span className="warning-text">REVIEW</span>}</td></tr>)}
      </tbody></table>
    </section>

    <section className="panel table-wrap">
      <h3>Pending Approval Queue</h3>
      <p className="small">Only DRAFT Sales and Purchase documents are shown. Click a document to review it.</p>
      <table className="data-table"><thead><tr><th>Module</th><th>Document Type</th><th>Document</th><th>Status</th><th>Action</th></tr></thead><tbody>
        {pendingApproval.map((item) => <tr key={`${item.documentType}-${item.recordId}`}><td>{item.module}</td><td>{item.documentType}</td><td><Link href={item.href}><strong>{item.documentNo}</strong></Link></td><td><strong>DRAFT</strong></td><td><Link className="button-link secondary-link" href={item.href}>Open Document</Link></td></tr>)}
        {!pendingApproval.length && <tr><td colSpan={5}>No DRAFT Sales or Purchase documents awaiting approval.</td></tr>}
      </tbody></table>
    </section>

    <section className="panel table-wrap">
      <h3>PO ↔ Supplier Invoice ↔ Purchase Receipt Match</h3>
      <p className="small">Partial receipts and partial Supplier Invoices are valid. The control checks source PO, supplier/project, item linkage, cumulative billed quantity versus ordered quantity, and STOCK billed quantity versus actually received quantity. Purchase-price differences are handled separately through PPV accounting and are not treated as a three-way-match failure.</p>
      <table className="data-table"><thead><tr><th>Supplier Invoice</th><th>PO</th><th>Supplier</th><th>Project</th><th>Invoice Total</th><th>Quantity Control</th><th>Result</th></tr></thead><tbody>
        {matchChecks.map(({ bill, po, lineSummary, problems, passed }) => <tr key={bill.billId}><td><Link href={`/transactions/supplierBill/${encodeURIComponent(bill.billId)}`}><strong>{bill.billNumber || bill.billId}</strong></Link></td><td>{po?.poNumber || bill.poId || bill.sourceDocumentId}</td><td>{bill.supplierId}</td><td>{bill.projectId || "—"}</td><td>{money(bill.totalAmount)}</td><td>{lineSummary.length ? lineSummary.map((line) => <div className="small" key={line}>{line}</div>) : "—"}</td><td>{passed ? <strong>PASS</strong> : <span className="warning-text">{problems.join("; ")}</span>}</td></tr>)}
        {!matchChecks.length && <tr><td colSpan={7}>No Supplier Invoices linked to Purchase Orders yet.</td></tr>}
      </tbody></table>
    </section>

    <section className="panel table-wrap">
      <h3>Source Retention Queue</h3>
      <table className="data-table"><thead><tr><th>Document</th><th>Type</th><th>Status</th></tr></thead><tbody>
        {missingSource.map((doc) => <tr key={doc.documentId}><td>{doc.documentNumber || doc.documentId}</td><td>{doc.documentType}</td><td className="warning-text">Google Drive binary upload pending</td></tr>)}
        {!missingSource.length && <tr><td colSpan={3}>All active registered sources have retained Drive files.</td></tr>}
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
