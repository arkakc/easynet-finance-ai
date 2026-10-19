/**
 * Phase 4: read-only bridge between existing documents and opt-in ERP approvals.
 * IMPORTANT: This is not a posting adapter. Never change legacy document status
 * or call ledger/stock posting from this module.
 */
import type { DocumentKind, WorkflowStatus } from "./erp-approval-policy";

export const LEGACY_DOCUMENT_MAP = {
  purchaseOrder: "PURCHASE_ORDER",
  supplierBill: "SUPPLIER_BILL",
  invoice: "SALES_INVOICE",
} as const satisfies Record<string, DocumentKind>;

export type LegacyDocumentType = keyof typeof LEGACY_DOCUMENT_MAP;

export type LegacyDocumentSnapshot = {
  recordType: LegacyDocumentType;
  recordId: string;
  status: string;
  amount: number;
  companyId: string;
  creatorUserId: string | null;
  isCreditNote?: boolean;
  hasLinkedPosting?: boolean;
};

/** Excludes payment (both supplier and customer), expense and credit notes:
 * their routing needs subtype-aware handling and independent audit controls.
 */
export function readLegacyApprovalCandidate(snapshot: LegacyDocumentSnapshot):
  | { eligible: true; documentKind: DocumentKind; expectedLegacyStatus: "DRAFT"; amountPgk: number }
  | { eligible: false; reason: string } {
  if (!snapshot.companyId.trim() || !snapshot.recordId.trim())
    return { eligible: false, reason: "Company and document identity are required" };
  if (!snapshot.creatorUserId?.trim())
    return { eligible: false, reason: "Persisted creator identity is required for maker/checker separation" };
  if (!Number.isFinite(snapshot.amount) || snapshot.amount < 0)
    return { eligible: false, reason: "Invalid document amount" };
  if (snapshot.status.trim().toUpperCase() !== "DRAFT")
    return { eligible: false, reason: "Only legacy DRAFT documents can enter the new approval process" };
  if (snapshot.isCreditNote)
    return { eligible: false, reason: "Credit notes require a dedicated return and posting workflow" };
  if (snapshot.hasLinkedPosting)
    return { eligible: false, reason: "Existing posting or settlement linkage prevents workflow migration" };
  return {
    eligible: true,
    documentKind: LEGACY_DOCUMENT_MAP[snapshot.recordType],
    expectedLegacyStatus: "DRAFT",
    amountPgk: snapshot.amount,
  };
}

/** Explicit external-state mapping; never infer a new approval from legacy APPROVED. */
export function readLegacyDisplayStatus(status: string): WorkflowStatus | null {
  switch (status.trim().toUpperCase()) {
    case "DRAFT": return "DRAFT";
    case "CANCELLED": return "CANCELLED";
    case "POSTED": return "POSTED";
    case "CLOSED": return "CLOSED";
    default: return null;
  }
}

/** Requires both workflow and legacy state to be independently eligible.
 * This gate alone is not authorisation to release or post a transaction.
 */
export function canOfferLegacyApprovalHandoff(
  workflowStatus: WorkflowStatus,
  legacyStatus: string,
  approvedStepCount: number,
  requiredStepCount: number,
): boolean {
  return workflowStatus === "APPROVED"
    && legacyStatus.trim().toUpperCase() === "DRAFT"
    && Number.isInteger(approvedStepCount)
    && Number.isInteger(requiredStepCount)
    && requiredStepCount > 0
    && approvedStepCount === requiredStepCount;
}
