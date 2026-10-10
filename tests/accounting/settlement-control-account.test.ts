import test from "node:test";
import assert from "node:assert/strict";
import { sourceControlAccount } from "../../lib/accounting/settlement-control-account";

const invoice = [
  { accountId: "cuid-ar", account: { code: "1131" }, description: "Accounts receivable", debit: 11000, credit: 0 },
  { accountId: "cuid-revenue", account: { code: "4101" }, description: "Sales revenue", debit: 0, credit: 10000 },
  { accountId: "cuid-gst-output", account: { code: "2120" }, description: "Output GST", debit: 0, credit: 1000 },
];
const bill = [
  { accountId: "cuid-ap", account: { code: "2111" }, description: "Accounts payable", debit: 0, credit: 5500 },
  { accountId: "cuid-cost", account: { code: "5111" }, description: "Purchase cost", debit: 5000, credit: 0 },
  { accountId: "cuid-gst-input", account: { code: "1140" }, description: "Input GST", debit: 500, credit: 0 },
];

test("customer receipt settles invoice's original 1131, not current default 1130", () => {
  assert.equal(sourceControlAccount(invoice, "RECEIVABLE"), "1131");
});
test("supplier payment settles bill's original 2111, not default 2110", () => {
  assert.equal(sourceControlAccount(bill, "PAYABLE"), "2111");
});
test("ambiguous or missing source control line blocks settlement", () => {
  assert.throws(() => sourceControlAccount(invoice, "PAYABLE"), /unambiguously/);
  assert.throws(() => sourceControlAccount([...invoice, { accountId: "cuid-other-ar", account: { code: "1130" }, description: "Accounts receivable", debit: 1, credit: 0 }], "RECEIVABLE"), /unambiguously/);
});

test("missing account relation must fail closed rather than posting the FK as a GL code", () => {
  const missing = invoice.map(({ account, ...line }) => line);
  assert.throws(() => sourceControlAccount(missing, "RECEIVABLE"), /unambiguously/);
});

test("supplier advance must clear the original bill AP 2111, never a default 2110", () => {
  const selected = sourceControlAccount(bill, "PAYABLE");
  const advanceLines = [
    { accountId: selected, debit: 500, credit: 0, description: "Settle Accounts Payable from advance" },
    { accountId: "1160", debit: 0, credit: 500, description: "Apply supplier advance" },
  ];
  assert.equal(advanceLines[0].accountId, "2111");
  assert.equal(advanceLines.reduce((sum, line) => sum + line.debit - line.credit, 0), 0);
});
test("customer advance must clear the original invoice AR 1131, never a default 1130", () => {
  const selected = sourceControlAccount(invoice, "RECEIVABLE");
  const advanceLines = [
    { accountId: "customer-advances", debit: 500, credit: 0, description: "Apply customer advance" },
    { accountId: selected, debit: 0, credit: 500, description: "Settle Accounts Receivable from advance" },
  ];
  assert.equal(advanceLines[1].accountId, "1131");
  assert.equal(advanceLines.reduce((sum, line) => sum + line.debit - line.credit, 0), 0);
});
test("advance source must be unambiguous before journal lines can be prepared", () => {
  assert.throws(() => sourceControlAccount([...bill, { accountId: "other", account: { code: "2110" }, description: "Accounts payable", debit: 0, credit: 500 }], "PAYABLE"), /unambiguously/);
});
