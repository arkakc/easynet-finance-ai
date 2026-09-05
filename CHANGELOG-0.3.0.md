# v0.3.0 — ERP Core, Authentication & UX

## Security and user access
- Added first-login user authentication with scrypt password verification.
- Added signed 12-hour HttpOnly session cookies.
- Added System Manager, Finance Controller, Accounts, Sales, Purchase, Stock, Management and Auditor roles.
- Added granular server-side permissions and protected route enforcement.
- Added Users & Permissions administration view without exposing hashes/secrets.
- Removed browser `APP_SECRET` entry from Transactions and Document Conversions.
- Added authenticated ERP API gateways; legacy `APP_SECRET` is now injected server-side only for compatibility.

## ERP navigation
- Reorganized the left navigation into Dashboard, Sales, Purchase, Stock & Assets, Accounts, Projects, Reports, Documents & AI and Administration.
- Menu visibility is role/permission-aware.
- Re-enabled normal Next.js link prefetch instead of disabling it globally.

## Document automation
- Added automatic transaction date defaults using Papua New Guinea business timezone.
- Added default quotation expiry (+7 days) and invoice/bill due date (+30 days).
- Added customer-linked project suggestions in sales transactions.
- Added user-facing continuation document numbering, e.g. `INV-2026-00001`, while retaining UUID-based internal record IDs.
- Added save → document detail redirect.

## Document view and print
- Added detail pages for Quotation, Sales Invoice, Purchase Order, Supplier Bill, Payment/Receipt and Expense.
- Added A4 print preview via browser Print / Save PDF.
- Added Source Document detail and print preview with retained-source link and SHA-256 evidence fingerprint.

## Document conversion automation
- Added in-document Next Document actions:
  - Approved Quotation → Draft Sales Invoice
  - Approved Purchase Order → Draft Supplier Bill
- Existing party, project, line values and source links are mapped by the conversion service.
- Conversion actions are permission-controlled and no longer require users to know `APP_SECRET`.

## Performance
- Removed the global serialization bottleneck for read-only Google Apps Script calls.
- Writes remain serialized to protect SpreadsheetApp mutations; independent reads now run concurrently.
- Removed explicit client `cache: "no-store"` usage from the primary Transaction loading flow.
- Restored standard Next.js navigation prefetch for faster perceived page transitions.

## Deployment requirements
Add these server environment variables before enabling v0.3.0 authentication:

```text
SESSION_SECRET=<32+ character high-entropy value>
ERP_USERS_JSON=<JSON user array containing scrypt password hashes and roles>
```

Generate password hashes with:

```bash
npm run hash-password -- 'A-strong-password'
```

Keep existing server-side `APP_SECRET`, `APPS_SCRIPT_WEB_APP_URL`, `APPS_SCRIPT_API_TOKEN`, `OPENAI_API_KEY`, and `OPENAI_MODEL` values.

See `AUTHENTICATION.md` for the full request flow and credential/token model.

## Known architectural boundary
Google Sheets + Apps Script remains an MVP persistence layer. v0.3.0 removes a major artificial read-serialization bottleneck, but a full transactional multi-user ERP should eventually move user/session persistence, atomic naming series and high-volume finance tables to PostgreSQL/Supabase or another transactional database. The accounting controls and Apps Script bridge can be migrated incrementally.
