# Easynet Finance AI — Production Go-Live Runbook

Production cutover is blocked until the application itself is running on PostgreSQL and the accounting controls are reconciled.

## Required production configuration

```text
DATABASE_PROVIDER=postgresql
DATABASE_URL_POSTGRES=<private TLS PostgreSQL URL>
APP_ENV=production
AUTH_SECRET=<32+ random characters>
SESSION_SECRET=<32+ random characters>
AUDIT_LOG_SECRET=<separate stable 32+ random characters>
APP_SECRET=<32+ random characters>
```

Never commit production credentials or secrets. Keep `AUDIT_LOG_SECRET` stable for a database whose audit chain has already been sealed.

## Release sequence

1. Stop writes and take a verified backup: `npm run db:backup`.
2. Create the final reconciliation snapshot: `npm run db:reconcile:snapshot -- --as-of=YYYY-MM-DD`.
3. Resolve all blocking AR, AP, inventory, bank, payroll and ledger reconciliation exceptions.
4. Validate PostgreSQL tooling: `npm run db:postgres:validate`.
5. Run preflight: `npm run db:postgres:preflight`.
6. Transfer to a new empty PostgreSQL target:
   ```powershell
   npm run db:postgres:transfer -- --confirm=TRANSFER_TO_EMPTY_POSTGRES
   ```
7. Review the migration report and approve the reconciliations.
8. Configure the production variables above.
9. Run `npm run typecheck` and `npm run build`.
10. Deploy/restart.
11. Verify `/api/health` reports PostgreSQL and a reachable database.
12. Verify `/go-live` reports READY.
13. Reopen application writes.

Never repair a production reconciliation difference by editing or deleting a posted journal. Use controlled reversal, opening-subledger recovery/import, or a documented migration correction.
