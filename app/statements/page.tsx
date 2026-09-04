import { listTable } from "@/lib/backend/apps-script";

export const dynamic = "force-dynamic";

type Customer = { customerId: string; customerName: string };
type Supplier = { supplierId: string; supplierName: string };
type Invoice = { invoiceId: string; invoiceNumber: string; customerId: string; invoiceDate: string; dueDate: string; totalAmount: number | string; paidAmount: number | string; outstandingAmount: number | string; status: string };
type Bill = { billId: string; billNumber: string; supplierId: string; billDate: string; dueDate: string; totalAmount: number | string; paidAmount: number | string; outstandingAmount: number | string; status: string };
type Payment = { paymentId: string; paymentNumber: string; paymentType: string; partyType: string; partyId: string; paymentDate: string; amount: number | string; reference: string; status: string };

const n = (value: unknown) => Number(value || 0);
const money = (value: unknown) => `K${n(value).toFixed(2)}`;

export default async function StatementsPage() {
  let customers: Customer[] = [];
  let suppliers: Supplier[] = [];
  let invoices: Invoice[] = [];
  let bills: Bill[] = [];
  let payments: Payment[] = [];
  let error = "";

  try {
    const [c, s, i, b, p] = await Promise.all([
      listTable<Customer>("Customers", 500, 0),
      listTable<Supplier>("Suppliers", 500, 0),
      listTable<Invoice>("Invoices", 500, 0),
      listTable<Bill>("SupplierBills", 500, 0),
      listTable<Payment>("Payments", 500, 0),
    ]);
    customers = c.rows;
    suppliers = s.rows;
    invoices = i.rows;
    bills = b.rows;
    payments = p.rows.filter((row) => row.status === "POSTED");
  } catch (err) {
    error = err instanceof Error ? err.message : "Statement load failed";
  }

  const customerRows = customers.map((customer) => {
    const docs = invoices.filter((row) => row.customerId === customer.customerId && row.status !== "DRAFT");
    const receipts = payments.filter((row) => row.partyType === "Customer" && row.partyId === customer.customerId && row.paymentType === "RECEIVE");
    return {
      ...customer,
      invoiced: docs.reduce((sum, row) => sum + n(row.totalAmount), 0),
      received: receipts.reduce((sum, row) => sum + n(row.amount), 0),
      outstanding: docs.reduce((sum, row) => sum + n(row.outstandingAmount), 0),
      docs,
      receipts,
    };
  });

  const supplierRows = suppliers.map((supplier) => {
    const docs = bills.filter((row) => row.supplierId === supplier.supplierId && row.status !== "DRAFT");
    const paid = payments.filter((row) => row.partyType === "Supplier" && row.partyId === supplier.supplierId && row.paymentType === "PAY");
    return {
      ...supplier,
      billed: docs.reduce((sum, row) => sum + n(row.totalAmount), 0),
      paid: paid.reduce((sum, row) => sum + n(row.amount), 0),
      outstanding: docs.reduce((sum, row) => sum + n(row.outstandingAmount), 0),
      docs,
      payments: paid,
    };
  });

  return (
    <>
      <h2>Customer & Supplier Statements</h2>
      <p className="small">Live receivable and payable statement summaries from posted documents and payments.</p>
      {error && <section className="panel"><strong>Backend warning:</strong> {error}</section>}

      <section className="panel table-wrap">
        <h3>Customer Balances</h3>
        <table className="data-table"><thead><tr><th>Customer</th><th>Invoiced</th><th>Receipts</th><th>Outstanding</th></tr></thead><tbody>
          {customerRows.map((row) => <tr key={row.customerId}><td>{row.customerName}<br/><span className="small">{row.customerId}</span></td><td>{money(row.invoiced)}</td><td>{money(row.received)}</td><td><strong>{money(row.outstanding)}</strong></td></tr>)}
          {!customerRows.length && <tr><td colSpan={4}>No customers found.</td></tr>}
        </tbody></table>
      </section>

      {customerRows.filter((row) => row.docs.length || row.receipts.length).map((row) => (
        <section className="panel table-wrap" key={`customer-${row.customerId}`}>
          <h3>{row.customerName} — Statement</h3>
          <table className="data-table"><thead><tr><th>Date</th><th>Reference</th><th>Type</th><th>Debit</th><th>Credit</th><th>Open</th></tr></thead><tbody>
            {[...row.docs.map((doc) => ({ date: doc.invoiceDate, ref: doc.invoiceNumber, type: "Invoice", debit: n(doc.totalAmount), credit: 0, open: n(doc.outstandingAmount) })), ...row.receipts.map((p) => ({ date: p.paymentDate, ref: p.paymentNumber, type: "Receipt", debit: 0, credit: n(p.amount), open: 0 }))].sort((a, b) => String(a.date).localeCompare(String(b.date))).map((entry, index) => <tr key={`${entry.ref}-${index}`}><td>{entry.date}</td><td>{entry.ref}</td><td>{entry.type}</td><td>{entry.debit ? money(entry.debit) : "—"}</td><td>{entry.credit ? money(entry.credit) : "—"}</td><td>{entry.open ? money(entry.open) : "—"}</td></tr>)}
          </tbody></table>
        </section>
      ))}

      <section className="panel table-wrap">
        <h3>Supplier Balances</h3>
        <table className="data-table"><thead><tr><th>Supplier</th><th>Billed</th><th>Payments</th><th>Outstanding</th></tr></thead><tbody>
          {supplierRows.map((row) => <tr key={row.supplierId}><td>{row.supplierName}<br/><span className="small">{row.supplierId}</span></td><td>{money(row.billed)}</td><td>{money(row.paid)}</td><td><strong>{money(row.outstanding)}</strong></td></tr>)}
          {!supplierRows.length && <tr><td colSpan={4}>No suppliers found.</td></tr>}
        </tbody></table>
      </section>

      {supplierRows.filter((row) => row.docs.length || row.payments.length).map((row) => (
        <section className="panel table-wrap" key={`supplier-${row.supplierId}`}>
          <h3>{row.supplierName} — Statement</h3>
          <table className="data-table"><thead><tr><th>Date</th><th>Reference</th><th>Type</th><th>Debit</th><th>Credit</th><th>Open</th></tr></thead><tbody>
            {[...row.docs.map((doc) => ({ date: doc.billDate, ref: doc.billNumber, type: "Supplier Bill", debit: 0, credit: n(doc.totalAmount), open: n(doc.outstandingAmount) })), ...row.payments.map((p) => ({ date: p.paymentDate, ref: p.paymentNumber, type: "Payment", debit: n(p.amount), credit: 0, open: 0 }))].sort((a, b) => String(a.date).localeCompare(String(b.date))).map((entry, index) => <tr key={`${entry.ref}-${index}`}><td>{entry.date}</td><td>{entry.ref}</td><td>{entry.type}</td><td>{entry.debit ? money(entry.debit) : "—"}</td><td>{entry.credit ? money(entry.credit) : "—"}</td><td>{entry.open ? money(entry.open) : "—"}</td></tr>)}
          </tbody></table>
        </section>
      ))}
    </>
  );
}
