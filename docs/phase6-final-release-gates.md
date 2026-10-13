# Phase 6 final release gates

## What is already proven
- Application compiles in Next.js production build.
- Disposable SQLite database contention and IN_REVIEW recovery passed on local Windows.
- Read-only release report previously showed zero unresolved claims.

## PostgreSQL cross-instance verification
Requires a **separately provisioned disposable QA PostgreSQL database**, not a production clone with business data.
1. Provision a dedicated DB called `easynet_phase6_test_<suffix>` and a non-public schema (e.g. `phase6qa`). Deploy the Prisma schema there using the established staging migration procedure.
2. Generate `prisma/generated/postgresql-client` with `npm run db:postgres:client`.
3. Set `EASYNET_PHASE6_POSTGRES_TEST_URL` to the disposable DB connection URL including `?schema=phase6qa`; set `EASYNET_RUN_PG_INTEGRATION=isolated`.
4. Execute `npm run db:phase6:verify-postgres`. It runs two independent Prisma clients on the same database, asserts only one unique conversion claim succeeds, validates fail-closed partial-write simulation, and deletes only test claims afterward.

This is a real PostgreSQL database claim test, **not** a multi-process HTTP/backend test. Do not mark production cross-region operation verified from this result alone.

## Real Apps Script partial-write recovery
Use an isolated Apps Script backend with disposable customer, supplier, accounts, source order and item fixtures. Deliberately inject a failure **after** the target parent append but before line append:
- Verify the target parent exists, no second target is created on retry, the associated claim stays IN_REVIEW, and the source's balances and audit trail are unchanged.
- Reconcile the incomplete parent and its lines; do not delete the guard claim until a supervised repair procedure is approved.
- Repeat for both PO-to-bill routes and Sales Quote-to-Order. Inspect source/target external ids before and after.
- These checks require isolated Apps Script credentials and a test backend; never run against live accounting records.

## Accounting workflow integration
On an isolated accounting dataset, execute draft → submit → approve → post → payment → journal → reconciliation for Sales and Purchases. Confirm double-entry balance, GST amount, AR/AP and bank control accounts, stock changes when relevant, maker-checker authorization, audit trail and duplicate rejection. Record document IDs and reconciliation differences. **Functional UAT is deferred**, so these are release gates, not completed checks.

## Release decision
No production sign-off until PostgreSQL, Apps Script, and full workflow evidence is attached. SQLite PASS is insufficient.
