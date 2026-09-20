# PostgreSQL production migration runbook

The active local-development database remains `prisma/dev.db`. This runbook prepares a controlled future move to PostgreSQL; it does not send data to any remote service.

1. Stop writes and create a verified SQLite backup with `npm run db:backup`.
2. Create the signed financial baseline with `npm run db:reconcile:snapshot -- --as-of=YYYY-MM-DD`. Resolve every reported control exception or obtain a documented Finance Controller waiver.
3. Set `DATABASE_URL_POSTGRES` only on the production migration host.
4. Run `npm run db:postgres:preflight`. It generates and validates a dedicated PostgreSQL Prisma Client, inventories every source table, and validates foreign-key insertion order without contacting the target.
5. Provision a private PostgreSQL database with TLS, daily encrypted backups, point-in-time recovery, and least-privilege application credentials.
6. Rehearse against a new, empty PostgreSQL database/schema with `npm run db:postgres:transfer -- --confirm=TRANSFER_TO_EMPTY_POSTGRES`. The URL is accepted only through `DATABASE_URL_POSTGRES`; it is never printed in the migration report. The tool refuses a non-empty target, reads from an immutable backup, inserts all current ERP tables in foreign-key order inside one transaction, and rolls back if any control fails.
7. Review the fingerprinted report under `backups/migration`. Confirm that every table row count and every financial control match: trial balance by account, receivables, payables, stock quantity/value, bank GL balances, and master record counts. The permitted monetary variance is K0.01.
8. Schedule a maintenance window, take a final verified SQLite backup, repeat the migration, and obtain Finance Controller approval of the reconciliations.
9. Keep the final SQLite snapshot read-only through the agreed retention period. Record the cutover and rollback decision in the audit register.

For local development, `npm run db:backup:install-daily` installs a 7:00 PM Windows backup task. This installer is not executed automatically. `BACKUP_RETENTION_COUNT` defaults to the newest 30 snapshots and accepts 7–365.

Do not switch the application datasource until an automated data-transfer tool and financial reconciliation report have both passed UAT.
