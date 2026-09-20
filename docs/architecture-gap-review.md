# Easynet Finance AI architecture review

Compared with the supplied accounting blueprints, the local system already has the core document-to-journal workflows for sales, purchasing, payments, inventory/COGS, payroll, GST, loans, fixed assets, reversals, period close, AR/AP opening schedules, reconciliation and financial reporting.

The principal gap was first-time setup control. Company configuration, accounting method, inventory method, default account mappings, opening-balance control and activation were spread across settings and migration screens without a single state machine.

The gap is now covered by:

- `/setup/finance`, a protected 10-step setup wizard;
- `/api/setup/workflow`, which persists setup configuration in `GlobalSettings`, reports readiness, validates opening debit/credit totals and blocks activation until the configuration is complete;
- `lib/accounting/setup-workflow.ts`, which performs typed validation and checks that mapped accounts are active ledger accounts with the expected root type;
- the Prisma posting boundary, which now rejects inactive or group accounts for direct journal posting.

The Chart of Accounts import is also atomic, rejects duplicate codes, rejects circular hierarchies and records an administrator audit log for new imports.

The current deployment is intentionally single-company and stores company configuration as keyed settings. A future multi-company edition should promote those settings into a first-class Company relation and add company IDs to every financial document and journal. Persisted, user-editable posting-rule records and SOFT CLOSED/LOCKED period states are also future extensions; current posting rules and period controls remain centralized and enforced in code.
