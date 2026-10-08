import assert from "node:assert/strict";
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
