# PostgreSQL production migration runbook

Local development may continue on `prisma/dev.db`. Production runtime uses PostgreSQL through the generated PostgreSQL Prisma client.

## Controlled migration

1. Stop application writes.
2. Create and verify a SQLite backup with `npm run db:backup`.
3. Create a reconciliation snapshot with `npm run db:reconcile:snapshot -- --as-of=YYYY-MM-DD` and resolve every blocking control exception.
4. Provision a new empty PostgreSQL database/schema with TLS, encrypted backups and point-in-time recovery.
5. Set `DATABASE_URL_POSTGRES` on the migration host. Do not commit it.
6. Run `npm run db:postgres:validate`.
7. Run `npm run db:postgres:preflight`. Preflight validates the generated PostgreSQL schema/client, source rows, field conversions and foreign-key insertion order without changing the target.
8. Transfer only into an empty target:
   ```powershell
   npm run db:postgres:transfer -- --confirm=TRANSFER_TO_EMPTY_POSTGRES
   ```
9. Review the fingerprinted migration report under `backups/migration`. Table row counts and financial reconciliation must match.
10. For application cutover set:
    ```text
    DATABASE_PROVIDER=postgresql
    DATABASE_URL_POSTGRES=<production connection string>
    APP_ENV=production
    ```
11. Verify the managed PostgreSQL backup/PITR, then set `POSTGRES_BACKUP_VERIFIED_AT` to that verification time in ISO-8601 format.\n12. Redeploy/restart the application and verify `/api/health` reports `database.provider = postgresql` and `reachable = true`.
12. Verify `/go-live` reports READY before reopening writes.
13. Retain the final SQLite backup read-only for the agreed rollback/retention period.

The transfer tool does not automatically switch the application datasource. Cutover is explicit through `DATABASE_PROVIDER=postgresql`.
