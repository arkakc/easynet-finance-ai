import test from "node:test";
import assert from "node:assert/strict";
import { checkAccountingFlow, type AccountingFlowEvidence } from "../../lib/accounting/phase6-flow-invariants";
const base: AccountingFlowEvidence = {
  sourceId: "SI-QA-1", net: 100, gst: 10, gross: 110,
  journal: [
    { accountId: "AR", debit: 110, credit: 0 },
    { accountId: "REV", debit: 0, credit: 100 },
    { accountId: "GST", debit: 0, credit: 10 },
  ],
  receivableOrPayableControl: 110, allocatedPayments: 65, remainingBalance: 45,
};
test("balanced GST-inclusive sales invoice and partial payment reconcile", () => {
  assert.deepEqual(checkAccountingFlow(base), []);
});
test("purchase bill flow reconciles with opposite debit-credit direction", () => {
  assert.deepEqual(checkAccountingFlow({
    ...base, sourceId: "PB-QA-1",
    journal: [
      { accountId: "COST", debit: 100, credit: 0 },
      { accountId: "GST-INPUT", debit: 10, credit: 0 },
      { accountId: "AP", debit: 0, credit: 110 },
    ],
  }), []);
});
test("detects unbalanced ledger, GST and AR/AP/payment variances", () => {
  const errors = checkAccountingFlow({
    ...base, gst: 9, receivableOrPayableControl: 100,
    remainingBalance: 44, journal: base.journal.slice(0, 2),
  });
  assert.equal(errors.length, 4);
});
test("rejects invalid negative or dual-sided entries", () => {
  assert.match(checkAccountingFlow({ ...base, journal: [{ accountId: "AR", debit: -1, credit: 1 }] }).join(" "), /Invalid/);
});

test("rejects supplier invoice overpayment and negative outstanding", () => {
  const issues = checkAccountingFlow({ ...base, allocatedPayments: 120, remainingBalance: -10 });
  assert.ok(issues.some(issue => issue.includes("Negative")));
});
test("rejects fractional-cent AP allocations before reconciliation", () => {
  const issues = checkAccountingFlow({ ...base, allocatedPayments: 65.001, remainingBalance: 44.999 });
  assert.ok(issues.some(issue => issue.includes("cent precision")));
});
test("rejects fractional-cent journal entries even when journal balances", () => {
  const issues = checkAccountingFlow({
    ...base,
    journal: [
      { accountId: "AR", debit: 110.001, credit: 0 },
      { accountId: "REV", debit: 0, credit: 100 },
      { accountId: "GST", debit: 0, credit: 10.001 },
    ],
  });
  assert.ok(issues.some(issue => issue.includes("journal line")));
});
test("permits fully paid and unpaid invoice reconciliation", () => {
  assert.deepEqual(checkAccountingFlow({ ...base, allocatedPayments: 110, remainingBalance: 0 }), []);
  assert.deepEqual(checkAccountingFlow({ ...base, allocatedPayments: 0, remainingBalance: 110 }), []);
});
