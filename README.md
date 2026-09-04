# Easynet Finance AI

AI-assisted finance-control application for **Easynet IT Solutions Limited**.

## Current milestone

**v0.2 — Integrated Finance Control MVP**

The application is designed for a small PNG IT services, hardware and project-delivery business. Google Sheets is the MVP data store, Google Drive retains source evidence, and Google Apps Script provides the private backend bridge used by the Vercel-hosted Next.js application.

## Architecture

```text
Browser
  ↓
Next.js on Vercel
  ↓ server-side only
Google Apps Script Web App
  ├─ Google Sheets — finance database
  └─ Google Drive — retained source documents
```

No Google Cloud service account or Google Cloud billing account is required for this MVP architecture.

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

## Implemented modules

### Core finance
- Management Dashboard
- Chart of Accounts
- Business Masters: Customers, Suppliers, Projects
- Loan Register
- Compound-monthly loan calculation
- Loan interest accrual and repayment posting
- Posted Journal Ledger
- Journal Reversal
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
- Quotation → Invoice conversion
- Purchase Order → Supplier Bill conversion
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
- Human-review status before any accounting action

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
ALLOWED_EMAILS=
```

Never commit real secrets to GitHub.

## Google Apps Script backend

The repository contains:

- `apps-script/Code.gs` — original v0.1 backend
- `apps-script/Code-v2.gs` — current v0.2 backend with Drive source upload and faster batch writes

For the v0.2 test cycle, replace the code in the **existing bound Apps Script project** with `apps-script/Code-v2.gs`, save it, run `bootstrapDatabase()` once, and deploy a new Web App version. Reusing the same Apps Script project preserves Script Properties such as the spreadsheet ID, Drive root ID and API token.

If Google gives the new deployment a different `/exec` URL, update `APPS_SCRIPT_WEB_APP_URL` in Vercel. Do not paste the API token into chat or commit it to the repository.

## Local development

```bash
cp .env.example .env.local
npm install
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm run build
```

## Planned test sequence

1. Backend health and v0.2 Apps Script deployment
2. Dashboard / Accounts / Loans
3. Customer / Supplier / Project masters
4. Quote → Invoice → Post → Customer Receipt
5. PO → Purchase Receipt → Supplier Bill → Post → Supplier Payment
6. Expense posting
7. Journal and reversal controls
8. Project profitability / AR / AP / cash flow / GST reports
9. AI document upload, duplicate detection and Drive retention
10. Budget, asset and milestone modules

## Production hardening still required after MVP testing

The current write controls use `APP_SECRET`, which is appropriate only for the private MVP. Before broader multi-user use, add proper login, role-based permissions (Admin / Finance Controller / Entry / Management / Auditor), stronger approval workflows, automated backup/recovery checks, and migrate from Google Sheets when concurrency/data volume justifies PostgreSQL/Supabase/ERPNext.
