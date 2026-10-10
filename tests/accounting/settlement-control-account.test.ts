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
