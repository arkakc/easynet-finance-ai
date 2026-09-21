# Easynet Finance AI

Easynet Finance AI is a finance and ERP application for Easynet IT Solutions Limited.

## Architecture

```text
Browser
  ↓
Next.js 16
  ↓
Authenticated application services
  ↓
Prisma ORM
  ↓
SQLite (local/development) OR PostgreSQL (production)
```

Core accounting uses the Prisma database as the single source of truth. Legacy Google Sheets / Apps Script components are not the accounting authority.

## Core capabilities

- Chart of Accounts and accounting configuration
- Sales invoices and supplier bills
- Customer receipts and supplier payments
- Payment allocation and outstanding balances
- Manual journals with maker-checker approval
- Journal reversal without deleting posted history
- Atomic accounting posting and rollback protection
- Warehouse stock and inventory accounting
- Multi-currency accounting and FX gain/loss handling
- Financial statements and reconciliation controls
- Period close / reopen controls
- Payroll, GST, assets and operational accounting
- Role-based access control
- Session revocation, login throttling and account lockout
- Tamper-evident audit trail
- Backup, restore and PostgreSQL migration utilities

## Accounting principles

```text
Business Document
      ↓
Accounting Rule
      ↓
Debit / Credit
      ↓
Atomic Posting
      ↓
General Ledger
      ↓
Subledger
      ↓
Reconciliation
      ↓
Financial Reports
```

Key controls:

- Total Debit = Total Credit
- AR control = customer subledger
- AP control = supplier subledger
- Inventory GL = stock valuation
- Bank GL = bank book
- Posted journals are not edited or deleted; corrections use controlled reversal
- Privileged accounting and security actions are audited

## Local setup

```powershell
npm install
npx prisma generate
npx prisma db push
npm run dev
```

Create `.env.local` from `.env.example` and configure unique secrets before running the application.

## Main commands

```powershell
npm run dev
npm run build
npm run typecheck
npm run db:backup
npm run db:restore
npm run db:reconcile:snapshot
```

Production runtime uses `DATABASE_PROVIDER=postgresql` with `DATABASE_URL_POSTGRES`. Migration utilities must only be used against an explicitly configured target database:

```powershell
npm run db:postgres:validate
npm run db:postgres:preflight
npm run db:postgres:transfer
```

## Security

Do not commit real passwords, session secrets, audit secrets, API keys, database credentials or production environment files.

Use separate strong values for:

- `APP_SECRET`
- `SESSION_SECRET`
- `AUDIT_LOG_SECRET`
- `AUTH_SECRET`

`AUDIT_LOG_SECRET` must remain stable for a database whose audit chain has already been sealed.
