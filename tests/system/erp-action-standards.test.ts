import assert from "node:assert/strict";
import test from "node:test";
import { documentActionVisible, erpActionAppearance } from "../../lib/ui/erp-action-standards";

test("drafts may be edited but never approved or posted", () => {
  assert.equal(documentActionVisible("DRAFT", "edit"), true);
  assert.equal(documentActionVisible("DRAFT", "approve"), false);
  assert.equal(documentActionVisible("DRAFT", "finalPost"), false);
});
test("posted documents allow controlled reversal but not delete or edit", () => {
  assert.equal(documentActionVisible("POSTED", "reverse"), true);
  assert.equal(documentActionVisible("POSTED", "delete"), false);
  assert.equal(documentActionVisible("POSTED", "edit"), false);
});
test("final posting appears only in approved state", () => {
  assert.equal(documentActionVisible("APPROVED", "finalPost"), true);
  assert.equal(documentActionVisible("PENDING_APPROVAL", "finalPost"), false);
});
test("destructive CTA styling is distinct from save and submit", () => {
  assert.equal(erpActionAppearance.delete.tone, "danger");
  assert.equal(erpActionAppearance.saveDraft.tone, "primary");
  assert.equal(erpActionAppearance.approve.tone, "success");
});
