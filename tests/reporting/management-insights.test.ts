import assert from "node:assert/strict";
import test from "node:test";
import { deriveFinanceInsights } from "../../lib/reporting/management-insights";
const input = { revenue: 1000, expenses: 800, cashBank: 300, receivables: 250, payables: 400, purchaseCommitments: 100, arDifference: 0, apDifference: 0 };
test("posted revenue yields net margin and indicative liquidity", () => {
 const result = deriveFinanceInsights(input);
 assert.equal(result.find(x => x.key === "profitMargin")?.value, 20);
 assert.equal(result.find(x => x.key === "workingCapital")?.value, 150);
 assert.equal(result.find(x => x.key === "afterCommitments")?.value, 50);
});
test("zero revenue does not invent margin", () => {
 const result = deriveFinanceInsights({ ...input, revenue: 0 });
 assert.equal(result[0].value, null);
 assert.equal(result[0].status, "unavailable");
});
test("negative liquidity and reconciliation variance flag review", () => {
 const result = deriveFinanceInsights({ ...input, cashBank: 0, arDifference: -0.05 });
 assert.equal(result.find(x => x.key === "workingCapital")?.status, "warning");
 assert.equal(result.find(x => x.key === "reconciliation")?.status, "warning");
});
test("invalid values fail closed", () => {
 assert.throws(() => deriveFinanceInsights({ ...input, payables: Number.NaN }), /valid numbers/);
});
