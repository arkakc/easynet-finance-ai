# Easynet Finance AI — Go-Live Runbook

The application must show **READY** at `/go-live` before production cutover. The page is the authoritative release gate and checks the current local Prisma database without posting or changing financial transactions.

## Required sequence

1. Create and verify a fresh backup: `npm run db:backup`.
2. Generate a dated reconciliation snapshot: `npm run db:reconcile:snapshot -- --as-of=YYYY-MM-DD`.
3. Import the signed opening AR and AP aged schedules from `/migration/opening-subledger`. Use the supplied template, preview first, then confirm only after the verified backup check passes.
4. Reconcile the historical payroll journal shown in `/payroll` (`PAY-2026-0003`) to a controlled payroll register/source note. Do not repost or reverse it automatically.
5. Configure production secrets and database URL outside source control:
   - `DATABASE_URL_POSTGRES` (TLS, private database, PITR and encrypted backups)
   - `AUTH_SECRET` (at least 32 random characters)
   - `SESSION_SECRET` (at least 32 random characters)
   - `APP_SECRET` (at least 32 random characters when compatibility/Apps Script routes are enabled)
6. Run `npm run db:postgres:validate`, then `npm run db:postgres:preflight`. The preflight must use the latest migration-ready snapshot.
7. Rehearse transfer into a new empty PostgreSQL schema with `npm run db:postgres:transfer -- --confirm=TRANSFER_TO_EMPTY_POSTGRES` and review the fingerprinted report.
8. Obtain Finance Controller approval for AR/AP, payroll, GST/SWT and the final backup. Repeat the transfer during the maintenance window, then switch the application datasource.

## Release checks

Run `npm run typecheck`, `npm run lint`, `npm run build`, and the UAT scripts in `package.json`. Lint warnings in legacy components are non-blocking; lint errors, failed UATs, an unbalanced ledger, or any `/go-live` blocking check stop the release.

Never resolve a reconciliation exception by editing or deleting posted journals. Use the controlled opening import, reversal workflow, or documented migration correction with audit evidence.
