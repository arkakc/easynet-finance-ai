import { prisma } from "../../src/lib/prisma";
import { buildFinancialStatements } from "../../lib/accounting/financial-statements";
import { saveFinancialReconciliationSnapshot } from "../../lib/system/financial-reconciliation";

const value = (x: unknown) => Number(x || 0);
const round = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const asOf = process.argv.find((x) => x.startsWith("--as-of="))?.slice(8) || new Date().toISOString().slice(0, 10);
const end = new Date(`${asOf}T23:59:59.999+10:00`);
const exceptions: string[] = [];
const warn = (message: string) => { exceptions.push(message); console.log("FAIL:", message); };
const ok = (message: string) => console.log("PASS:", message);
const code = (text: string) => String(text || "").replace(/^ACC-/i, "");

async function main() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(end.getTime())) throw new Error("Invalid --as-of YYYY-MM-DD");
  console.log(`Read-only finance UAT audit, as of ${asOf} (PGK base amounts)`);
  const [statements, snapshot, journals, bankAccounts, invoices, bills, payments, deliveryNotes, purchaseReceipts, coa, settings] = await Promise.all([
    buildFinancialStatements({ asOf }),
    saveFinancialReconciliationSnapshot({ asOf, generatedBy: "finance-uat-audit" }),
    prisma.journalHeader.findMany({ where: { status: "POSTED", date: { lte: end } }, include: { lines: { include: { account: { select: { code: true, type: true } } } } } }),
    prisma.bankAccount.findMany({ where: { isActive: true }, include: { chartOfAccounts: { select: { code: true, id: true } } } }),
    prisma.invoice.findMany({ where: { glPosted: true, issuedDate: { lte: end }, status: { notIn: ["CANCELLED", "VOID"] } } }),
    prisma.supplierBill.findMany({ where: { glPosted: true, billDate: { lte: end }, status: { notIn: ["CANCELLED", "VOID"] } } }),
    prisma.payment.findMany({ where: { status: "CLEARED", date: { lte: end } } }),
    prisma.deliveryNote.findMany({ where: { status: "POSTED", deliveryDate: { lte: end } } }),
    prisma.purchaseReceipt.findMany({ where: { status: "POSTED", receiptDate: { lte: end } } }),
    prisma.chartOfAccounts.findMany({ select: { code: true, type: true } }),
    prisma.globalSettings.findMany({ where: { key: { in: ["default_bank_account", "default_cash_account", "default_receivable_account", "default_payable_account"] } }, select: { key: true, value: true } }),
  ]);
  const journalByRef = new Map(journals.flatMap((j) => [[j.id, j], [j.code, j]]));
  const accountByCode = new Map(coa.map((a) => [a.code, a]));
  const settingByKey = new Map(settings.map((s) => [s.key, code(String(s.value || ""))]));
  const trial = new Map<string, number>();
  for (const journal of journals) {
    if (Math.abs(value(journal.totalDebit) - value(journal.totalCredit)) > 0.01) warn(`Unbalanced journal ${journal.code}`);
    for (const line of journal.lines) trial.set(line.account.code, round((trial.get(line.account.code) || 0) + value(line.debit) - value(line.credit)));
  }
  const trialTotal = round([...trial.values()].reduce((sum, v) => sum + v, 0));
  if (Math.abs(trialTotal) < 0.01 && statements.controls.cumulativeLedger.balanced) ok(`Trial balance: debit equals credit; ${journals.length} posted journals`);
  else warn(`Trial balance: net debit/credit difference ${trialTotal}`);
  if (statements.balanceSheet.totals.balanced) ok("Balance sheet equation reconciled including earnings");
  else warn(`Balance sheet equation difference ${statements.balanceSheet.totals.difference}`);
  for (const [label, control] of [["AR", statements.controls.receivables], ["AP", statements.controls.payables]] as const) {
    if (control.matched) ok(`${label} control ${control.accountCode} equals subledger ${control.subledgerBalance}`);
    else warn(`${label} control ${control.accountCode} differs from subledger by ${control.difference}`);
  }
  const checkLinked = (kind: string, docs: Array<{ code: string; journalId: string | null }>) => {
    for (const doc of docs) {
      const journal = doc.journalId ? journalByRef.get(doc.journalId) : null;
      if (!journal) warn(`${kind} ${doc.code} missing posted linked GL journal`);
    }
  };
  checkLinked("Sales Invoice", invoices);
  checkLinked("Supplier Bill", bills);
  checkLinked("Payment", payments);
  checkLinked("Delivery Note", deliveryNotes);
  checkLinked("Purchase Receipt", purchaseReceipts);
  console.log(`Document linkage checked: ${invoices.length} invoices, ${bills.length} bills, ${payments.length} payments, ${deliveryNotes.length} deliveries, ${purchaseReceipts.length} receipts`);
  const expectedGstOutput = round(snapshot.receivables.outputGst);
  const expectedGstInput = round(snapshot.payables.inputGst);
  const gstPayable = round([...trial.entries()].filter(([k]) => /^2120$/.test(k)).reduce((sum, [,v]) => sum - v, 0));
  const gstReceivable = round([...trial.entries()].filter(([k]) => /^1140$/.test(k)).reduce((sum, [,v]) => sum + v, 0));
  console.log(`GST diagnostic (gross posted invoices/bills, not statutory return): output docs ${expectedGstOutput}, GL 2120 ${gstPayable}; input docs ${expectedGstInput}, GL 1140 ${gstReceivable}`);
  if (Math.abs(expectedGstOutput - gstPayable) > 0.01) warn("Output GST document total differs from GL 2120 (review credit notes, adjustments, timing, and custom tax ledgers)");
  else ok("Output GST diagnostic matches GL 2120");
  if (Math.abs(expectedGstInput - gstReceivable) > 0.01) warn("Input GST document total differs from GL 1140 (review refunds, adjustments, timing, and custom tax ledgers)");
  else ok("Input GST diagnostic matches GL 1140");
  const mappedCodes = new Set(bankAccounts.map((b) => b.chartOfAccounts?.code).filter(Boolean));
  for (const bank of bankAccounts) {
    if (!bank.chartOfAccounts) warn(`Bank ${bank.code} lacks ledger mapping`);
    else ok(`Bank ${bank.code} maps to GL ${bank.chartOfAccounts.code}, balance ${round(trial.get(bank.chartOfAccounts.code) || 0)}`);
  }
  for (const key of ["default_bank_account", "default_cash_account"]) {
    const account = settingByKey.get(key);
    if (!account) continue;
    const found = accountByCode.get(account);
    if (!found) warn(`${key} ${account} is missing from Chart of Accounts`);
    else if (bankAccounts.length && !mappedCodes.has(account) && Math.abs(trial.get(account) || 0) > 0.01)
      warn(`${key} GL ${account} holds ${round(trial.get(account) || 0)} but no active bank master maps to it. Review cash-vs-bank classification and bank ledger mapping.`);
  }
  if (snapshot.banking.unreconciledTransactions > 0) warn(`${snapshot.banking.unreconciledTransactions} unreconciled bank statement lines`);
  console.log(`Standard snapshot migrationReady=${snapshot.controls.migrationReady}; detailed UAT exceptions=${exceptions.length}`);
  if (exceptions.length) process.exitCode = 2;
  else ok("Read-only deep UAT checks passed (subject to external bank statement and tax filing evidence)");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
