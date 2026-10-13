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
