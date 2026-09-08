import Link from "next/link";
import { listTable } from "@/lib/backend/apps-script";
import { normalizeAccountingDate } from "@/lib/accounting/loan";

export const dynamic = "force-dynamic";

type Account = { accountId: string; accountCode: string; accountName: string; accountType: string };
type JournalHeader = { journalId: string; status: string };
type JournalLine = { journalId: string; accountId: string; debit: number | string; credit: number | string; projectId?: string };
type Invoice = { invoiceId: string; invoiceNumber: string; customerId: string; dueDate: string; totalAmount: number | string; outstandingAmount: number | string; status: string; projectId?: string; journalId?: string };
type Bill = { billId: string; billNumber: string; supplierId: string; dueDate: string; totalAmount: number | string; outstandingAmount: number | string; status: string; projectId?: string; journalId?: string };

const n = (value: unknown) => Number(value || 0);
const money = (value: number) => new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK", minimumFractionDigits: 2 }).format(value);
const normalized = (value: unknown) => String(value || "").trim().toUpperCase();
const openPostedStatus = (value: unknown) => ["POSTED", "PARTLY_PAID"].includes(normalized(value));

function pngToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Port_Moresby", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function daysPastDue(value: string) {
  if (!value) return 0;
  try {
    const due = new Date(`${normalizeAccountingDate(value)}T00:00:00Z`).getTime();
    const today = new Date(`${pngToday()}T00:00:00Z`).getTime();
    return Math.max(0, Math.floor((today - due) / 86400000));
  } catch {
    return 0;
  }
}

function bucket(days: number) {
  if (days <= 0) return "Current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export default async function ReportsPage() {
  let accounts: Account[] = [];
  let headers: JournalHeader[] = [];
  let lines: JournalLine[] = [];
  let invoices: Invoice[] = [];
  let bills: Bill[] = [];
  let error = "";

  try {
    const [a, h, j, i, b] = await Promise.all([
      listTable<Account>("Accounts", 500, 0),
      listTable<JournalHeader>("JournalHeaders", 500, 0),
      listTable<JournalLine>("JournalLines", 500, 0),
      listTable<Invoice>("Invoices", 500, 0),
      listTable<Bill>("SupplierBills", 500, 0),
    ]);
    accounts = a.rows;
    headers = h.rows;
    lines = j.rows;
    invoices = i.rows;
    bills = b.rows;
  } catch (err) {
    error = err instanceof Error ? err.message : "Report load failed";
  }

  if (error) {
    return (
      <>
        <h2>Financial Reports</h2>
        <p className="small">Live finance data is unavailable until the backend connection succeeds.</p>
        <section className="panel warning-panel"><strong>Financial report data unavailable.</strong> {error}. Do not rely on zero or blank figures while this warning is active.</section>
      </>
    );
  }

  const postedJournalIds = new Set(headers.filter((row) => normalized(row.status) === "POSTED").map((row) => String(row.journalId)));
  const postedLines = lines.filter((line) => postedJournalIds.has(String(line.journalId)));
  const accountMap = new Map(accounts.map((a) => [a.accountId, a]));
  const balances = new Map<string, number>();
  for (const line of postedLines) {
    balances.set(line.accountId, (balances.get(line.accountId) || 0) + n(line.debit) - n(line.credit));
  }

  let revenue = 0;
  let expenses = 0;
  let assets = 0;
  let liabilities = 0;
  let equity = 0;
  for (const [accountId, rawBalance] of balances.entries()) {
    const account = accountMap.get(accountId);
    if (!account) continue;
    if (account.accountType === "Income") revenue += -rawBalance;
    else if (account.accountType === "Expense") expenses += rawBalance;
    else if (account.accountType === "Asset" || account.accountType === "Contra Asset") assets += rawBalance;
    else if (account.accountType === "Liability") liabilities += -rawBalance;
    else if (account.accountType === "Equity") equity += -rawBalance;
  }
  const netProfit = revenue - expenses;
  const accountBalance = (accountId: string) => n(balances.get(accountId));
  const inventory = accountBalance("ACC-1150");
  const supplierAdvances = accountBalance("ACC-1160");
  const accountsReceivable = accountBalance("ACC-1130");
  const accountsPayable = -accountBalance("ACC-2110");
  const customerAdvances = -accountBalance("ACC-2150");
  const grni = -accountBalance("ACC-2190");
  const inputGst = accountBalance("ACC-1140");
  const outputGst = -accountBalance("ACC-2120");

  const arRows = invoices
    .filter((row) => n(row.outstandingAmount) > 0 && openPostedStatus(row.status) && Boolean(String(row.journalId || "").trim()) && !String(row.invoiceNumber || "").toUpperCase().startsWith("CN-"))
    .map((row) => ({ ...row, overdueDays: daysPastDue(row.dueDate), aging: bucket(daysPastDue(row.dueDate)) }));
  const apRows = bills
    .filter((row) => n(row.outstandingAmount) > 0 && openPostedStatus(row.status) && Boolean(String(row.journalId || "").trim()))
    .map((row) => ({ ...row, overdueDays: daysPastDue(row.dueDate), aging: bucket(daysPastDue(row.dueDate)) }));

  const arAging = ["Current", "1-30", "31-60", "61-90", "90+"].map((label) => [label, arRows.filter((row) => row.aging === label).reduce((sum, row) => sum + n(row.outstandingAmount), 0)] as const);
  const apAging = ["Current", "1-30", "31-60", "61-90", "90+"].map((label) => [label, apRows.filter((row) => row.aging === label).reduce((sum, row) => sum + n(row.outstandingAmount), 0)] as const);
  const balanceCheck = assets - liabilities - equity - netProfit;

  return (
    <>
      <h2>Financial Reports</h2>
      <p className="small">Live management reports derived only from POSTED journal headers and current posted AR/AP documents. Cancelled, reversed and draft source documents are excluded.</p>

      <div className="grid">
        <div className="card"><div className="label">Revenue</div><div className="value">{money(revenue)}</div></div>
        <div className="card"><div className="label">Expenses</div><div className="value">{money(expenses)}</div></div>
        <div className="card"><div className="label">Net Profit</div><div className="value">{money(netProfit)}</div></div>
        <div className="card"><div className="label">Balance Check</div><div className="value">{money(balanceCheck)}</div></div>
      </div>

      <section className="panel table-wrap">
        <h3>Profit & Loss</h3>
        <table className="data-table"><tbody>
          <tr><th>Revenue</th><td>{money(revenue)}</td></tr>
          <tr><th>Expenses</th><td>{money(expenses)}</td></tr>
          <tr><th>Net Profit / (Loss)</th><td><strong>{money(netProfit)}</strong></td></tr>
        </tbody></table>
      </section>

      <section className="panel table-wrap">
        <h3>Balance Sheet Summary</h3>
        <table className="data-table"><tbody>
          <tr><th>Assets</th><td>{money(assets)}</td></tr>
          <tr><th>Liabilities</th><td>{money(liabilities)}</td></tr>
          <tr><th>Equity</th><td>{money(equity)}</td></tr>
          <tr><th>Current Earnings</th><td>{money(netProfit)}</td></tr>
          <tr><th>Balance Check</th><td><strong>{money(balanceCheck)}</strong></td></tr>
        </tbody></table>
      </section>

      <section className="panel table-wrap">
        <h3>Accounting 0.5 Control Balances</h3>
        <p className="small">These balances expose the perpetual-inventory, advance, GRNI and GST control accounts introduced in Accounting 0.5.</p>
        <table className="data-table"><tbody>
          <tr><th>Accounts Receivable</th><td>{money(accountsReceivable)}</td></tr>
          <tr><th>Accounts Payable</th><td>{money(accountsPayable)}</td></tr>
          <tr><th>Inventory / Project Materials</th><td>{money(inventory)}</td></tr>
          <tr><th>Stock Received But Not Billed / GRNI</th><td>{money(grni)}</td></tr>
          <tr><th>Supplier Advances</th><td>{money(supplierAdvances)}</td></tr>
          <tr><th>Customer Advances / Unearned Revenue</th><td>{money(customerAdvances)}</td></tr>
          <tr><th>Input GST</th><td>{money(inputGst)}</td></tr>
          <tr><th>Output GST</th><td>{money(outputGst)}</td></tr>
          <tr><th>Net GST Payable / (Receivable)</th><td><strong>{money(outputGst - inputGst)}</strong></td></tr>
        </tbody></table>
        <div className="button-row"><Link className="button-link secondary-link" href="/controls">Open Accounting Integrity Controls</Link></div>
      </section>

      <section className="panel table-wrap">
        <h3>Accounts Receivable Aging</h3>
        <table className="data-table"><thead><tr><th>Bucket</th><th>Outstanding</th></tr></thead><tbody>{arAging.map(([label, amount]) => <tr key={label}><td>{label}</td><td>{money(amount)}</td></tr>)}</tbody></table>
        <h4>Open Invoices</h4>
        <table className="data-table"><thead><tr><th>Invoice</th><th>Customer</th><th>Project</th><th>Due</th><th>Days</th><th>Outstanding</th></tr></thead><tbody>{arRows.map((row) => <tr key={row.invoiceId}><td><Link href={`/transactions/invoice/${encodeURIComponent(row.invoiceId)}`}><strong>{row.invoiceNumber}</strong></Link></td><td>{row.customerId}</td><td>{row.projectId || "—"}</td><td>{row.dueDate || "—"}</td><td>{row.overdueDays}</td><td>{money(n(row.outstandingAmount))}</td></tr>)}</tbody></table>
      </section>

      <section className="panel table-wrap">
        <h3>Accounts Payable Aging</h3>
        <table className="data-table"><thead><tr><th>Bucket</th><th>Outstanding</th></tr></thead><tbody>{apAging.map(([label, amount]) => <tr key={label}><td>{label}</td><td>{money(amount)}</td></tr>)}</tbody></table>
        <h4>Open Supplier Invoices</h4>
        <table className="data-table"><thead><tr><th>Supplier Invoice</th><th>Supplier</th><th>Project</th><th>Due</th><th>Days</th><th>Outstanding</th></tr></thead><tbody>{apRows.map((row) => <tr key={row.billId}><td><Link href={`/transactions/supplierBill/${encodeURIComponent(row.billId)}`}><strong>{row.billNumber}</strong></Link></td><td>{row.supplierId}</td><td>{row.projectId || "—"}</td><td>{row.dueDate || "—"}</td><td>{row.overdueDays}</td><td>{money(n(row.outstandingAmount))}</td></tr>)}</tbody></table>
      </section>
    </>
  );
}
