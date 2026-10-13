import test from "node:test";
import assert from "node:assert/strict";
import { calculateBudgetActuals, summarizeCostCenters } from "../../lib/reporting/budget-performance";

const accounts = [{ accountId: "EXP", accountType: "Expense" }, { accountId: "REV", accountType: "Income" }];
const lines = [
 { accountId: "EXP", projectId: "", costCenter: "OPS", date: "2026-10-01", debit: 50, credit: 0 },
 { accountId: "EXP", projectId: "P1", costCenter: "OPS", date: "2026-10-02", debit: 90, credit: 10 },
 { accountId: "EXP", projectId: "P1", costCenter: "OPS", date: "2026-09-30", debit: 20, credit: 0 },
 { accountId: "REV", projectId: "P1", costCenter: "", date: "2026-10-03", debit: 10, credit: 150 },
];
test("company-wide and project budget actuals remain separate", () => {
 const result = calculateBudgetActuals([
  { budgetId: "A", financialYear: "2026", period: "2026-10", accountId: "EXP", projectId: "", budgetAmount: 60 },
  { budgetId: "B", financialYear: "2026", period: "2026-10", accountId: "EXP", projectId: "P1", budgetAmount: 70 },
 ], lines, accounts);
 assert.equal(result[0].actualAmount, 50);
 assert.equal(result[1].actualAmount, 80);
 assert.equal(result[1].overspent, true);
 assert.equal(result[1].variance, -10);
 assert.equal(result[1].utilizationPercent, 114.29);
});
test("annual budgets include full year and income uses credit less debit", () => {
 const [result] = calculateBudgetActuals([{ budgetId: "R", financialYear: "2026", period: "ANNUAL", accountId: "REV", projectId: "P1", budgetAmount: 200 }], lines, accounts);
 assert.equal(result.actualAmount, 140);
 assert.equal(result.variancePercent, 30);
});
test("zero budget marks ratio unavailable rather than divide-by-zero", () => {
 const [result] = calculateBudgetActuals([{ budgetId: "Z", financialYear: "2026", period: "ANNUAL", accountId: "EXP", projectId: "", budgetAmount: 0 }], lines, accounts);
 assert.equal(result.utilizationPercent, null);
 assert.equal(result.overspent, true);
});
test("cost centre grouping counts posted expense lines only", () => {
 assert.deepEqual(summarizeCostCenters(lines, accounts, "2026"), [{ costCenter: "OPS", actualAmount: 150 }]);
});
test("rejects invalid journal amounts", () => {
 assert.throws(() => calculateBudgetActuals([{ budgetId: "B", financialYear: "2026", period: "ANNUAL", accountId: "EXP", projectId: "", budgetAmount: 2 }], [{ ...lines[0], debit: NaN }], accounts), /Invalid posted/);
});
