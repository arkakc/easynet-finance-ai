import assert from "node:assert/strict";
import test from "node:test";
import { canOfferLegacyApprovalHandoff, readLegacyApprovalCandidate, readLegacyDisplayStatus } from "../../lib/workflow/erp-document-integration";

const draft = {
  recordType: "purchaseOrder" as const,
  recordId: "PO-123",
  status: "DRAFT",
  amount: 12500,
  companyId: "company-1",
  creatorUserId: "user-1",
};
test("only supported unposted draft documents qualify for opt-in workflow", () => {
  assert.deepEqual(readLegacyApprovalCandidate(draft), {
    eligible: true, documentKind: "PURCHASE_ORDER", expectedLegacyStatus: "DRAFT", amountPgk: 12500,
  });
  assert.equal(readLegacyApprovalCandidate({...draft, recordType: "supplierBill"}).eligible, true);
  assert.equal(readLegacyApprovalCandidate({...draft, recordType: "invoice"}).eligible, true);
});
test("reject missing maker and missing company identity", () => {
  assert.equal(readLegacyApprovalCandidate({...draft, creatorUserId: null}).eligible, false);
  assert.equal(readLegacyApprovalCandidate({...draft, companyId: ""}).eligible, false);
});
test("reject legacy posted or settled documents and credit notes", () => {
  for (const status of ["APPROVED", "POSTED", "PAID", "CANCELLED"])
    assert.equal(readLegacyApprovalCandidate({...draft,status}).eligible, false);
  assert.equal(readLegacyApprovalCandidate({...draft,isCreditNote:true}).eligible, false);
  assert.equal(readLegacyApprovalCandidate({...draft,hasLinkedPosting:true}).eligible, false);
});
test("reject invalid PGK amounts", () => {
  assert.equal(readLegacyApprovalCandidate({...draft,amount:NaN}).eligible, false);
  assert.equal(readLegacyApprovalCandidate({...draft,amount:-1}).eligible, false);
});
test("approved workflow does not imply legacy posting", () => {
  assert.equal(canOfferLegacyApprovalHandoff("UNDER_REVIEW","DRAFT",2,2), false);
  assert.equal(canOfferLegacyApprovalHandoff("APPROVED","POSTED",2,2), false);
  assert.equal(canOfferLegacyApprovalHandoff("APPROVED","DRAFT",1,2), false);
  assert.equal(canOfferLegacyApprovalHandoff("APPROVED","DRAFT",2,2), true);
  assert.equal(canOfferLegacyApprovalHandoff("APPROVED","DRAFT",0,0), false);
});
test("legacy approved status is not proof of new workflow approval", () => {
  assert.equal(readLegacyDisplayStatus("APPROVED"), null);
  assert.equal(readLegacyDisplayStatus("POSTED"), "POSTED");
});
