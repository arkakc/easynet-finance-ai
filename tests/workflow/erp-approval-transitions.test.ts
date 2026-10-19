import test from "node:test";
import assert from "node:assert/strict";
import { nextApprovalStatus } from "../../lib/workflow/erp-approval-transitions";

test("draft submit / review", () => {
  assert.equal(nextApprovalStatus("DRAFT", "SUBMIT"), "SUBMITTED");
  assert.equal(nextApprovalStatus("SUBMITTED", "REVIEW"), "UNDER_REVIEW");
});
test("multi-stage approval remains in review until final approver", () => {
  assert.equal(nextApprovalStatus("UNDER_REVIEW", "APPROVE", 1), "UNDER_REVIEW");
  assert.equal(nextApprovalStatus("UNDER_REVIEW", "APPROVE", 0), "APPROVED");
});
test("return and rejection transitions", () => {
  assert.equal(nextApprovalStatus("UNDER_REVIEW", "RETURN"), "DRAFT");
  assert.equal(nextApprovalStatus("SUBMITTED", "REJECT"), "CANCELLED");
});
test("invalid and posted transitions fail closed", () => {
  assert.throws(() => nextApprovalStatus("POSTED", "APPROVE", 0));
  assert.throws(() => nextApprovalStatus("DRAFT", "APPROVE", 0));
  assert.throws(() => nextApprovalStatus("UNDER_REVIEW", "APPROVE", -1));
});
