# Easynet Finance AI

AI-assisted finance ERP and control application for **Easynet IT Solutions Limited**.

## Current milestone

**v0.3.0 — ERP Core, Authentication & UX**

This release moves the application beyond the private shared-secret MVP by adding login/session authentication, role-based permissions, ERP-style navigation and document lifecycle features while retaining the existing Next.js → Google Apps Script → Google Sheets/Drive architecture.

## Architecture

```text
Browser
  │ user login + HttpOnly signed session
  ▼
Next.js 16 on Vercel
  │ route/action permission enforcement
  │ server-only APP_SECRET for legacy compatibility
  │ server-only APPS_SCRIPT_API_TOKEN
  ▼
Google Apps Script Web App
  ├─ Google Sheets — finance database
  └─ Google Drive — retained source documents
```

See **`AUTHENTICATION.md`** for the authentication components, request flow, role model and exact credential/token handling.

## v0.3.0 ERP core

### Authentication and permissions
- Email/password login with scrypt password hashes.
- HMAC-SHA256 signed, HttpOnly 12-hour sessions.
- Roles: System Manager, Finance Controller, Accounts User, Sales User, Purchase User, Stock User, Management and Auditor.
- Granular permissions for dashboard, sales, purchase, stock, accounts, reports, administration and posting approval.
- Route-level and sensitive action-level server permission checks.
- Users & Permissions administration view.
- Transactions and Document Conversions no longer ask the browser user for `APP_SECRET`.

### ERP navigation
The left panel is organized by business module:
- Dashboard
- Sales
- Purchase
- Stock & Assets
- Accounts
- Projects
- Reports
- Documents & AI
- Administration

Only links permitted for the current user's roles are shown.

### Document automation
- User-facing continuation numbering: `QT-YYYY-00001`, `INV-YYYY-00001`, `PO-YYYY-00001`, `BILL-YYYY-00001`, `PAY-YYYY-00001`, `EXP-YYYY-00001`.
- PNG-local current date default.
- Quotation expiry defaults to +7 days.
- Invoice/Supplier Bill due date defaults to +30 days.
- Customer-linked project suggestions in sales forms.
- Save redirects directly to the created document.

### Document lifecycle
- View/print pages for Quotation, Sales Invoice, Purchase Order, Supplier Bill, Payment/Receipt and Expense.
- A4 print / Save PDF support.
- Source Document View / Print Preview with original retained file link and SHA-256 evidence fingerprint.
- In-document mapped conversion:
  - Approved Quotation → Draft Sales Invoice
  - Approved Purchase Order → Draft Supplier Bill

### Performance
- Read-only Google Apps Script calls now execute concurrently instead of being forced through the global write queue.
- Spreadsheet writes remain serialized for mutation safety.
- Normal Next.js navigation prefetch is restored.

## Accounting control principles

- AI extracts and proposes; it never auto-posts accounting entries.
- Human Finance Controller action is required for posting.
- `JournalHeaders` + `JournalLines` are the accounting source of truth.
- Every posting must balance debit = credit and use active accounts.
- Posted journals are immutable. Corrections use a linked reversal journal followed by the corrected transaction.
- GST-bearing postings are blocked while `gst_status` is not `VERIFIED`.
- Source files are fingerprinted with SHA-256 to prevent duplicate intake.
- Source evidence is retained in Google Drive and linked to its document record.
- Project IDs flow through commercial documents, journals, expenses, stock and reports.
- Purchase controls compare Purchase Order ↔ Supplier Bill ↔ Purchase Receipt.

## Existing modules

### Core finance
- Management Dashboard
- Chart of Accounts
- Business Masters: Customers, Suppliers, Projects
- Loan Register and loan actions
- Posted Journal Ledger and reversal
- Finance Settings and GST verification control
- Finance Control Centre and Audit Trail

### Sales, purchasing and cash
- Quotations
- Sales Invoices
- Purchase Orders
- Supplier Bills
- Customer Receipts
- Supplier Payments
- Expenses
- Payment milestone schedules
- AR/AP outstanding updates after linked receipts/payments

### Project and operations
- Project profitability
- PO commitments
- Items and stock movements
- Purchase Receipts / goods-received evidence
- Fixed Asset Register
- Budget vs Actual

### AI and evidence
- PDF/JPG/PNG/WEBP source-document intake
- SHA-256 duplicate detection
- Structured AI extraction with line items
- Exact customer/supplier master matching where possible
- Google Drive source retention
- Source Document Register
- Human-review status before accounting action

### Reports
- Profit & Loss
- Balance Sheet summary
- AR Aging
- AP Aging
- Customer Statements
- Supplier Statements
- Cash Flow
- GST Control Report
- Project Profitability
- Budget vs Actual

## Environment variables

Create `.env.local` locally or configure these values in Vercel:

```text
APPS_SCRIPT_WEB_APP_URL=
APPS_SCRIPT_API_TOKEN=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5-mini
APP_SECRET=
SESSION_SECRET=
ERP_USERS_JSON=
```

Generate a password hash without storing the plain-text password in source control:

```bash
npm run hash-password -- 'A-strong-password'
```

Example user configuration shape:

```text
ERP_USERS_JSON=[{"email":"admin@example.com","name":"System Administrator","passwordHash":"scrypt$...$...","roles":["System Manager"]}]
```

Never commit real passwords, hashes tied to production users, API tokens or session secrets to GitHub.

## Google Apps Script backend

The repository contains `apps-script/Code.gs` and `apps-script/Code-v2.gs`. The Apps Script API token is stored in Script Properties and the matching value is stored only in the Next.js deployment environment. `rotateApiToken()` can rotate the machine credential.

## Local development

```bash
cp .env.example .env.local
npm install
npm run dev
```

Checks:

```bash
npm run typecheck
npm run build
```

## Release notes

See:
- `CHANGELOG-0.3.0.md` — v0.3.0 implementation details.
- `AUTHENTICATION.md` — authentication architecture and credential/token flow.
- `CHANGELOG-0.2.1.md` — prior reliability/accounting-control release.

## Architectural boundary

Google Sheets + Apps Script remains suitable for the current MVP/small-team stage, but it is not the final persistence architecture for a heavily concurrent ERP. A future database migration should move atomic naming series, database-backed users/sessions, workflow history and high-volume transactional data to PostgreSQL/Supabase or another transactional database while preserving the accounting rules and document lifecycle implemented here.
