# Phase 4 — Legacy document integration safety bridge (draft)

PR #317 is stacked on Phase 3 PR #316, which depends on Phase 2 #315 and Phase 1 #314.

## Repository review

`app/api/approvals/route.ts` currently approves legacy `DRAFT` documents directly and calls atomic posting for supplier bills, sales invoices and expenses. Credit notes have a dedicated atomic posting path. Replacing these functions during gradual rollout could change GL/stock balances; the existing routes are intentionally untouched.

## Scope of this phase

- Add a **pure read-only candidate mapping** for purchase orders, supplier bills and ordinary sales invoices.
- Deny workflow enrolment if document is not DRAFT, linked to posting, company/creator identity is absent, credit note, or amount invalid.
- Add an explicit handoff gate requiring APPROVED workflow with all approval steps complete and legacy document still DRAFT.
- Add non-database unit tests.

## Not yet implemented

- No real document route integration, no UI buttons, no shared approval handoff and no posting.
- No mapping for supplier payment, customer receipt, GRN, expense or return: these need subtype-specific controls.
- No persisted case creation and no rollout feature flag.
- No permission escalation or company identity verification: the future API must derive them from authenticated database session, not input.
- No reconciliation between legacy approval and new approval state, no automatic rollback or posting.
- Phase 3's unresolved return/reject step-reset and unresolved-risk handling still block live integration.

## Required live integration contract

1. Validate user session, tenant/company context and database-derived role membership.
2. Fetch underlying legacy document, lock/read authoritative status, amount, creator and any posting links.
3. Create approval case/ordered steps atomically, with policy snapshot and audit, idempotent duplicate suppression.
4. On final approval, recheck authoritative legacy document data and its current status in the same trusted posting operation; no unguarded status mutation.
5. Route posting to **existing** transaction-specific atomic accounting entry points. Do not duplicate accounting algorithms.
6. Deny on policy drift, mismatched amount, missing approver, inconsistent state, unresolved flags or concurrent updates.
7. Roll out per document type with migration tests, rollback switch and complete UAT.

Do not pull or merge until reviewed and tested.
