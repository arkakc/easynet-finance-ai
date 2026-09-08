import { findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";
import { advanceAllocationSummary } from "@/lib/accounting/advance-allocation";
import { round2 } from "@/lib/accounting/inventory";

function addDays(date: string, days: number) {
  const d = new Date(`${String(date || "").slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return String(date || "");
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.trunc(days || 0)));
  return d.toISOString().slice(0, 10);
}

export async function ensureInvoiceCreditTerms(invoice: any) {
  const customer = (await findRecords<any>("Customers", { customerId: invoice.customerId }, 1)).rows[0];
  if (!customer) throw new Error("Sales Invoice customer does not exist");
  const terms = Math.max(0, Math.trunc(Number(customer.creditTermsDays || 0)));
  const expectedDueDate = addDays(String(invoice.invoiceDate || ""), terms);
  if (!String(invoice.dueDate || "").trim() && expectedDueDate) {
    await updateRecord("Invoices", "invoiceId", invoice.invoiceId, { dueDate: expectedDueDate }, "sales-credit-control:terms");
    invoice.dueDate = expectedDueDate;
  }
  return { customer, creditTermsDays: terms, dueDate: String(invoice.dueDate || expectedDueDate || "") };
}

export async function assertCustomerCreditPolicy(invoice: any) {
  const { customer, creditTermsDays, dueDate } = await ensureInvoiceCreditTerms(invoice);
  const creditLimit = Number(customer.creditLimit || 0);
  if (!(creditLimit > 0)) {
    return { creditLimit: 0, exposureBefore: 0, availableAdvance: 0, proposedExposure: Number(invoice.totalAmount || 0), creditTermsDays, dueDate, enforced: false };
  }

  const invoices = await listTable<any>("Invoices", 500, 0);
  const exposureBefore = round2((invoices.rows || [])
    .filter((row: any) => String(row.invoiceId || "") !== String(invoice.invoiceId || "")
      && String(row.customerId || "") === String(invoice.customerId || "")
      && !String(row.invoiceNumber || "").toUpperCase().startsWith("CN-")
      && ["POSTED", "PARTLY_PAID"].includes(String(row.status || "").toUpperCase()))
    .reduce((sum: number, row: any) => sum + Number(row.outstandingAmount ?? row.totalAmount ?? 0), 0));

  const payments = await listTable<any>("Payments", 500, 0);
  let availableAdvance = 0;
  for (const payment of payments.rows || []) {
    if (String(payment.partyType || "") !== "Customer"
      || String(payment.partyId || "") !== String(invoice.customerId || "")
      || String(payment.paymentType || "").toUpperCase() !== "RECEIVE"
      || String(payment.status || "").toUpperCase() !== "POSTED"
      || !String(payment.journalId || "").trim()
      || String(payment.againstDocumentId || "").trim()) continue;
    const summary = await advanceAllocationSummary(payment);
    availableAdvance += summary.remainingAmount;
  }
  availableAdvance = round2(availableAdvance);
  const proposedExposure = round2(Math.max(0, exposureBefore + Number(invoice.totalAmount || 0) - availableAdvance));
  if (proposedExposure > creditLimit + 0.001) {
    throw new Error(
      `Customer credit limit exceeded. Limit K${creditLimit.toFixed(2)}, current open exposure K${exposureBefore.toFixed(2)}, available customer advance K${availableAdvance.toFixed(2)}, this invoice K${Number(invoice.totalAmount || 0).toFixed(2)}, resulting exposure K${proposedExposure.toFixed(2)}. Collect/allocate funds or obtain an authorized credit-limit change before posting.`,
    );
  }
  return { creditLimit, exposureBefore, availableAdvance, proposedExposure, creditTermsDays, dueDate, enforced: true };
}
