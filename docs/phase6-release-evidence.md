# Phase 6 evidence and safe cleanup

## Verified locally by owner
- TypeScript check and production build: PASS at `c684dd4`.
- Isolated real SQLite claim contention and simulated recovery: PASS at `3264398`.
- In-memory fault injection and conversion claim tests: 5/5 PASS at `c684dd4`.
- The above does **not** prove production PostgreSQL, real Apps Script writes, or complete accounting lifecycle.

## Repeatable unit regression
Run `npm run test:phase6` to execute the conversion guard, partial-write, preview, next-action, and document navigation tests in one pass. This command never contacts the live finance backend.

## Blocking release evidence
- PostgreSQL: isolate a database named `easynet_phase6_test_*`, deploy the schema to a non-public schema, and execute the existing `db:phase6:verify-postgres` harness. Save database and test output evidence. Two Prisma clients are not two deployed HTTP application instances; separate deployments remain a further check.
- Apps Script: require a completely isolated backend and intentionally fail *after* target parent creation. Verify incomplete target, `IN_REVIEW` claim and absence of duplicate target on retry. Restore fixture consistency under controlled approval.
- Full accounting: reconcile an isolated invoice/bill-to-payment sample against journals, GST, AR/AP, audit events and GL, with actual backend output and zero unexplained variances.
- Production sign-off is BLOCKED until all three are evidenced.

## Vercel cleanup
Vercel project `easynet-finance-ai` belongs to deployment integration for `helloeasynet386-a11y/easynet-finance-ai`, not necessarily the development repository `arkakc/easynet-finance-ai`.
Observed non-production deployments include READY, ERROR and CANCELED states; preserve production targets.
The connected Vercel app does not expose deletion capabilities. An authorized project administrator must use Vercel dashboard Deployments to delete only confirmed QA/preview deployments. **Do not delete the project or production targets.**
