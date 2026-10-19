# Phase 2 — Approval persistence groundwork

**Status:** additive Prisma models + reviewed SQL candidate only; nothing deployed.
This branch is stacked on Phase 1 (#314), and must be rebased/retargeted after Phase 1 completes.

## Added data structures

- `ErpApprovalCase`: company/document-unique approval instance, creator, value, policy version, lifecycle state, next step.
- `ErpApprovalStep`: individually assigned sequential approval requirements and decisions.
- `ErpApprovalEvent`: audit event rows referencing the case. Application code must implement append-only writes; database permissions should disallow UPDATE/DELETE for the event relation.
- `ErpApprovalPolicyVersion`: company-scoped, versioned PGK threshold configuration.

## Important safety boundaries

1. No legacy `app/api/approvals`, `/api/erp/actions`, manual journal route, GL posting, stock valuation, or user role mapper was modified.
2. There is **no workflow execution / transition API yet**. The new tables do not make approval decisions and cannot be treated as enforcement.
3. Nothing automatically migrates existing users or document approvals.
4. SQL must be applied only after migration review, backup, verified DB target, and UAT.
5. Read/write APIs must use validated sessions, company scope, serialisable/optimistic state transition checks and immutable audit records.
6. Do not enable workflow controls until role mapping and maker/checker/approver tests have passed.

## Next integration milestones

- Authenticated role mappings and multi-role/company context.
- Transactional workflow create/submit/review/approve/reject with durable step history, idempotency and atomicity.
- AP/PO/GRN route integration one document type at a time.
- Approval Inbox and admin-configurable thresholds.
- CI + local typecheck, migration dry-run, reconciliation and browser UAT.

No local pull is required while this is a draft.
