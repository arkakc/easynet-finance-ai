# Phase 3 — Transaction-safe approval execution module (draft)

This branch stacks on #315, which stacks on #314. The service is **not wired to live API endpoints**.

- Adds pure lifecycle guards and a serializable Prisma transaction to persist a single approval decision, next-step change, and event together.
- Distinct maker, reviewer and approver checks are enforced through the Phase 1 policy.
- Expected current state + updateMany CAS prevents processing stale approvals. Concurrent serialization failure must be retried safely by an eventual authenticated API handler.
- Returns/rejections require a reason.
- Existing finance, stock, journal and document posting code is unchanged.

## Critical remaining work before activation

1. Persist authenticated company-scoped roles and creator identity; never accept actor IDs / roles from the request JSON.
2. Create a workflow instance and approved policy snapshot at submission, with ordered approval steps.
3. Ensure risk flags / discrepancy resolution are persisted and evaluated before approval (the current record lacks fields for them).
4. Return-to-draft must clear/reopen historical review and approval steps; reject/return cannot reuse old decision evidence.
5. Full integration tests against PostgreSQL: rollback, concurrency, cross-company access, spoofing, rejections and sequential approvals.
6. Ensure step sequencing and independent reviewer/approver identity, fully audited cancellations and posting.
7. Only after migration, tests and permissions pass, integrate PO/AP/GRN individually.

No local pull, deploy or merge until dependencies and UAT complete.
