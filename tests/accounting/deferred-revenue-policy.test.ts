import assert from "node:assert/strict";
import { addMonthsMonthEnd, splitEvenly } from "../../lib/accounting/inventory";
import test from "node:test";
import {
  assertInvoiceRecognitionReversible,
  assertRecognitionReversalSchedule,
  recognitionScheduleTotalsMatch,
} from "../../lib/accounting/deferred-revenue-policy";

test("invoice reversal blocks completed recognition periods", () => {
  assert.throws(
    () => assertInvoiceRecognitionReversible([{ status: "PENDING" }, { status: "COMPLETED" }]),
    /Reverse posted deferred revenue recognition journals/,
  );
  assert.doesNotThrow(() => assertInvoiceRecognitionReversible([{ status: "PENDING" }, { status: "CANCELLED" }]));
});
test("recognition journal reversal requires exactly one completed schedule", () => {
  assert.doesNotThrow(() => assertRecognitionReversalSchedule([{ status: "COMPLETED" }]));
  assert.throws(() => assertRecognitionReversalSchedule([]), /Linked completed/);
  assert.throws(() => assertRecognitionReversalSchedule([{ status: "PENDING" }]), /Linked completed/);
  assert.throws(() => assertRecognitionReversalSchedule([{ status: "COMPLETED" }, { status: "COMPLETED" }]), /Linked completed/);
});
test("monthly allocations reconcile to invoice line net amount", () => {
  assert.equal(recognitionScheduleTotalsMatch(Array(12).fill(1000), 12000), true);
  assert.equal(recognitionScheduleTotalsMatch([333.33, 333.33, 333.34], 1000), true);
  assert.equal(recognitionScheduleTotalsMatch([100, 100], 300), false);
  assert.equal(recognitionScheduleTotalsMatch([100, 100], Number.NaN), false);
});

test("month-end recognition does not skip February or shorter months", () => {
  assert.equal(addMonthsMonthEnd("2026-01-31", 0), "2026-01-31");
  assert.equal(addMonthsMonthEnd("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsMonthEnd("2026-01-31", 2), "2026-03-31");
  assert.equal(addMonthsMonthEnd("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonthsMonthEnd("2026-08-31", 1), "2026-09-30");
  assert.throws(() => addMonthsMonthEnd("2026-02-30", 1), /Invalid date/);
});
test("recognition instalments preserve cents in the last month", () => {
  const instalments = splitEvenly(1000, 12);
  assert.equal(instalments.length, 12);
  assert.equal(Math.round(instalments.reduce((sum, amount) => sum + amount, 0) * 100), 100000);
});
