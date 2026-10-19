# ERP Workflow Phase 6 — security and UAT gate

Status: **IN PROGRESS / NOT SIGNED OFF**. PRs #314 through #318 are draft, stacked and not active in main.

## Review finding and initial mitigation
- Phase 3 previously collected every historical REVIEW event as current-cycle evidence.
- Phase 6 now scopes review events to the latest SUBMIT event.
- Return/Reject is blocked once any approval step has changed from PENDING. A proper reset/revision mechanism must be built and tested before enabling these workflows.

## Required automated checks (not yet executed)
- `npx tsx --test tests/workflow/*.test.ts`
- `npm run typecheck` (generates Prisma runtime client, may require PostgreSQL env)
- PostgreSQL integration tests: create/submit/review/approve, rollback, concurrency, repeated idempotency, assignment, exceptions, review-cycle reset.
- `npx prisma validate` using a secure test DATABASE_URL_POSTGRES.
- CI must use supported Node 24 and a valid non-production DATABASE_URL_POSTGRES for client generation.

## Mandatory production-blocking findings
1. No authenticated workflow API yet. Current execution service accepts caller-provided actor roles; **must never** expose it directly.
2. Company membership / multitenancy is not integrated with current user roles.
3. Phase 3 does not persist risk flags, frozen policy snapshots or exception evidence.
4. Approval history lifecycle lacks revision-safe step reset and robust cancellation.
5. No bridge to a real document approval/posting route; UI remains demonstration-only.
6. `ErpApprovalEvent` is append-only by convention only; database privileges/constraints need hardening.
7. Default limits (PGK) are illustrative and must be company-approved, not hardcoded operational limits.
8. No migration dry-run or accounting/stock balance reconciliation executed.

## UAT scenarios before any merge / deployment
- Finance Officer AP drafts bill → independent Controller check → CFO approval threshold → existing atomic GL post.
- Supply Chain Officer creates PO → SCM reviews → CFO/CEO threshold route → PO itself does not create AP/Inventory.
- Inventory Controller receives GRN → Inventory Manager validates quantities/lot/warehouse → financial valuation & GRNI stay correct.
- Returns, stock writeoffs, refunds and supplier bank changes trigger exception handling.
- Creator/reviewer/approver separation, mixed roles, cross-company denial, stale approvals, concurrent approvals and retry.
- Posted document deletion and cancelled/closed-period edits denied; reversal audit preserved.
- Existing AR/AP, GST, inventory valuation, general ledger tests unchanged and passing.

## Rollout control
Keep all stacked PRs draft until bugs are closed, compile/integration tests pass and company UAT signs off. Merge in dependency order #314→#315→#316→#317→#318→Phase 6 after correcting branch targets. Only then instruct a **single local pull**.
