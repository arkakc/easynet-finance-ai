# ERP Role Approval Workflow — Phase 1 (design and pure policy)

Status: **proposed policy library; not production-enforced**. Do not merge as a claim that role provisioning, durable approval-map routing, or document posting has been implemented.

## Compatibility findings

- Existing database user role enum provides SYSTEM_MANAGER, FINANCE_CONTROLLER, ACCOUNTS_USER, SALES_USER, PURCHASE_USER, STOCK_USER, MANAGEMENT, AUDITOR and USER.
- Existing `lib/auth.ts` translates these roles into coarse read/write/approve privileges.
- Existing `app/api/approvals/route.ts` supports DRAFT approval with direct posting for some document types. Replacing this without a data transition, persistence and UAT would change live accounting.
- Existing manual journal approval already enforces creator/checker separation.
- Phase 1 adds an isolated, pure policy that intentionally does **not** intercept legacy routes.

## Proposed job roles

Finance Officer AP, Finance Officer AR, Finance Controller, CFO, Inventory Controller, Inventory Manager, Supply Chain Officer, Supply Chain Manager and CEO. The two Finance Officer tracks share a job family but require different permissions. Thus there are **nine role identifiers for eight job families**.

## Controls

- Maker/checker/approver separation; independent review before approval.
- Risk escalation by configurable delegation of authority; initial PGK thresholds in code are illustrative, not approved final business settings.
- No direct modification or deletion of posted transactions. Posting and reversals stay in existing document-specific transactional handlers.
- Sequential approvals require distinct authenticated users with durable approval history.
- Exceptions must be resolved and evidenced, not silently bypassed.
- Administrators should not inherit business approval authority merely by being administrators.

## Required subsequent implementation

1. Agree persistent role model: extend Prisma enum and migrate users, or use user-role join model. Must preserve all existing user sessions and permissions.
2. Add company-scoped approval policy version, threshold configuration and migration/rollback.
3. Add transactionally persisted workflow records, approval steps, maker/checker identities, reviewer notes, blocked risk flags, and immutable audit events.
4. Implement state transitions with atomic backend guards; connect UI Inbox to actual pending assigned approvals.
5. Integrate each live document workflow **separately**: PR/PO, GRN, AP, payment, stock, AR, journal, bank reconciliation, close.
6. Preserve PO nonposting behavior and the existing atomic subledger/GL posting logic.
7. Complete unit, typecheck, integration, negative authorization, multitenant, accounting and browser UAT before production enablement.

Phase 1 tests: `npx tsx --test tests/workflow/erp-approval-policy.test.ts`.
