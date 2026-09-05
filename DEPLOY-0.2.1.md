# Easynet Finance AI v0.2.1 — Deployment Runbook

This release hardens the Google Apps Script backend, journal posting, finance error handling, loan accrual controls, evidence retention, and transaction validation.

## 1. GitHub safety first

Before publishing the fixed code, make the repository **Private** in GitHub if it is currently Public.

Recommended commit message:

```text
fix: harden finance backend and accounting controls v0.2.1
```

Do not commit `.env` files, API tokens, OpenAI keys, or `APP_SECRET`.

## 2. Upgrade the bound Google Apps Script backend

Open the company Google Sheet → **Extensions → Apps Script**.

1. Replace the current script with the full contents of `apps-script/Code.gs` from this package.
2. Save.
3. Confirm the Apps Script project timezone is `Pacific/Port_Moresby` / GMT+10.
4. Run `bootstrapDatabase()` once.
   - This performs an additive schema migration where safe.
   - It does **not** seed the chart of accounts or opening loan.
   - If it finds an unsafe header mismatch on a non-empty finance table, it stops instead of rewriting financial data.
5. Run `showBackendConfig()`.

Expected non-secret result:

```json
{
  "spreadsheetId": "...",
  "driveRootFolderId": "...",
  "hasApiToken": true,
  "version": "0.2.1"
}
```

6. Run `bootstrapStatus()`.

Expected:

```json
{
  "ok": true,
  "version": "0.2.1",
  "missingSheets": [],
  "headerIssues": []
}
```

7. Deploy a **new version** of the Web App under the company Google account:
   - Execute as: **Me**
   - Who has access: **Anyone**

If the `/exec` URL changes, update `APPS_SCRIPT_WEB_APP_URL` in Vercel. Do not rotate the API token unless you intend to; if it is rotated, update `APPS_SCRIPT_API_TOKEN` in Vercel immediately.

## 3. Vercel environment variables

Required server-side variables:

```text
APPS_SCRIPT_WEB_APP_URL=<company Apps Script /exec URL>
APPS_SCRIPT_API_TOKEN=<company Apps Script API token>
APP_SECRET=<long random company write secret>
OPENAI_API_KEY=<company OpenAI API key, required for AI extraction>
OPENAI_MODEL=gpt-5-mini
ALLOWED_EMAILS=
```

Never expose these values in client-side variables or commit them to GitHub.

After any environment-variable change, redeploy Production.

## 4. Deploy the fixed Next.js project

Replace/push the repository contents from this package. Vercel should build automatically from `main`.

A local full `next build` was not possible in the packaging environment because the npm registry was unavailable. Static TS/TSX syntax checks and Apps Script syntax checks passed; the Vercel build is the authoritative full dependency/type/build verification.

## 5. Verify backend before seeding finance data

Open:

```text
https://easynet-finance-ai.vercel.app/api/backend/health
```

Expected after the Apps Script upgrade:

```json
{
  "ok": true,
  "frontend": "easynet-finance-ai",
  "backend": {
    "ok": true,
    "version": "0.2.1"
  }
}
```

Then verify these pages/APIs no longer return backend HTTP 404:

```text
/api/masters
/api/transactions
/api/budgets
/controls
/accounts
/loans
/dashboard
/reports
```

## 6. Initialize Easynet opening finance data

Only after backend/schema checks pass, open:

```text
/setup/finance
```

Enter the Vercel `APP_SECRET` and run the finance setup once.

The setup is designed to seed the controlled Chart of Accounts plus the opening K500 funding loan and balanced opening journal. It is idempotent for known completed records and blocks unsafe partial immutable-journal states for manual review.

Opening loan policy in this release:

- Principal: K500
- Loan date: 04-Sep-2026
- Interest: 25% monthly compound
- Anniversary method
- First accrual date: 04-Oct-2026
- Future interest is not recognized upfront

After setup, verify `/accounts`, `/loans`, `/journals`, and `/dashboard`.

## 7. Finance-control UAT order

Perform UAT in this sequence: Masters → Project → Item → Quote → Quote-to-Invoice → PO → Stock receipt (where applicable) → PO-to-Supplier Bill → Invoice/Bill posting → Customer Receipt/Supplier Payment → Expense → Journal reports → Loan accrual/repayment → GST controls → AI document retention/extraction → reversal controls.

Keep GST status **UNVERIFIED** until the actual GST registration number and retained registration evidence exist.

## Known MVP boundary

`APP_SECRET` is still the write-action guard; full user login/role-based access control is not implemented in v0.2.1. Service-only purchase completion remains a Finance Controller evidence-review process rather than a dedicated service-receipt workflow. These are explicit MVP boundaries, not hidden as completed features.

## Apps Script editor health check
Run `bootstrapStatus()` after `bootstrapDatabase()`; expected `ok: true`, `version: 0.2.1`, and empty `missingSheets` / `headerIssues`.
