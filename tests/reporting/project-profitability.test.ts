import assert from "node:assert/strict";
import test from "node:test";
import { projectFinancialBreakdown } from "../../lib/reporting/project-profitability";
const accounts = [
  { accountId: "REV", accountType: "Income", accountName: "Sales" },
  { accountId: "LAB", accountType: "Expense", accountName: "Labour" },
  { accountId: "MAT", accountType: "Expense", accountName: "Materials" },
  { accountId: "AR", accountType: "Asset" },
];
test("posted project lines produce revenue, direct cost, profit and account breakdown", () => {
  const result = projectFinancialBreakdown([
    { projectId: "P1", accountId: "REV", debit: 0, credit: 500 },
    { projectId: "P1", accountId: "LAB", debit: 120, credit: 0 },
    { projectId: "P1", accountId: "MAT", debit: 80, credit: 0 },
    { projectId: "P1", accountId: "AR", debit: 500, credit: 0 },
  ], accounts).get("P1");
  assert.equal(result?.revenue, 500);
  assert.equal(result?.cost, 200);
  assert.equal(result?.profit, 300);
  assert.equal(result?.margin, 60);
  assert.deepEqual(result?.expenses.map(x => x.accountName), ["Labour", "Materials"]);
});
test("refunds and reversals net against their original account totals", () => {
  const result = projectFinancialBreakdown([
    { projectId: "P2", accountId: "REV", debit: 20, credit: 100 },
    { projectId: "P2", accountId: "LAB", debit: 40, credit: 5 },
  ], accounts).get("P2");
  assert.equal(result?.revenue, 80);
  assert.equal(result?.cost, 35);
});
test("unassigned lines excluded and no-revenue margin unavailable", () => {
  const result = projectFinancialBreakdown([
    { projectId: "", accountId: "REV", debit: 0, credit: 999 },
    { projectId: "P3", accountId: "LAB", debit: 7, credit: 0 },
  ], accounts);
  assert.equal(result.has(""), false);
  assert.equal(result.get("P3")?.margin, null);
});
test("invalid journal numbers are rejected", () => {
  assert.throws(() => projectFinancialBreakdown([{ projectId: "P1", accountId: "LAB", debit: NaN, credit: 0 }], accounts), /Invalid posted/);
});
