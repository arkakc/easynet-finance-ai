# Easynet Finance AI — Backend Split v0.4.0

This branch introduces a backward-compatible split backend architecture for speed and isolation.

## Target architecture

```text
Next.js / Vercel
  ├─ Core API      → Core ERP Google Sheet
  ├─ Reporting API → Reporting Summary Google Sheet
  └─ Document API  → Document Index Google Sheet + Google Drive
```

## Why this is backward compatible

The application first uses the new service-specific environment variables. If a split service is not configured yet, it falls back to the existing `APPS_SCRIPT_WEB_APP_URL` + `APPS_SCRIPT_API_TOKEN` pair. This allows migration one service at a time without breaking production.

## New environment variables

```text
CORE_APPS_SCRIPT_WEB_APP_URL=
CORE_APPS_SCRIPT_API_TOKEN=
REPORTING_APPS_SCRIPT_WEB_APP_URL=
REPORTING_APPS_SCRIPT_API_TOKEN=
DOCUMENT_APPS_SCRIPT_WEB_APP_URL=
DOCUMENT_APPS_SCRIPT_API_TOKEN=
```

Legacy fallback remains:

```text
APPS_SCRIPT_WEB_APP_URL=
APPS_SCRIPT_API_TOKEN=
```

## Service ownership

### Core API
Use `apps-script/CoreApi-v0.4.gs` bound to a new spreadsheet named for example:

`Easynet Finance AI - Core ERP DB`

Owns master and transaction data including Customers, Suppliers, Projects, Items, Quotes, Purchase Orders, Sales Invoices, Supplier Invoices (`SupplierBills` backend table), Payments, Expenses, Journals, Stock, Assets and Budgets.

### Reporting API
Use `apps-script/ReportingApi-v0.4.gs` bound to:

`Easynet Finance AI - Reporting DB`

Owns pre-aggregated summary tables only:

- ReportDashboardKPI
- ReportDailySales
- ReportDailyPurchases
- ReportARSummary
- ReportAPSummary
- ReportGSTSummary
- ReportProjectProfitability

The reporting store is intentionally separate so dashboards do not repeatedly scan transaction sheets.

### Document API
Use `apps-script/DocumentApi-v0.4.gs` bound to:

`Easynet Finance AI - Document Index DB`

Owns:

- Documents
- DocumentLines
- Google Drive source uploads/deletes

## Deployment steps

For each service:

1. Create the Google Sheet.
2. Open Extensions → Apps Script.
3. Paste the matching `*.gs` file.
4. Run its bootstrap function once and authorize Google access:
   - Core: `bootstrapCoreDatabase()`
   - Reporting: `bootstrapReportingDatabase()`
   - Document: `bootstrapDocumentDatabase()`
5. Copy the API token printed in Apps Script execution logs.
6. Deploy → New deployment → Web app.
7. Execute as: Me.
8. Who has access: Anyone.
9. Copy the `/exec` URL.
10. Add URL + token to Vercel environment variables.
11. Redeploy the feature branch and verify all three health checks.

## Data migration order

Do not move all data at once.

1. Deploy Core API and leave legacy fallback available.
2. Copy core tables from the current spreadsheet to the new Core ERP sheet, preserving headers and IDs.
3. Configure Core URL/token in Vercel and verify transactions.
4. Deploy Document API, copy Documents/DocumentLines, configure its URL/token and verify upload/view.
5. Deploy Reporting API and begin populating summary tables.
6. Switch dashboard/report pages to summary datasets progressively.
7. Remove legacy Apps Script fallback only after all modules are verified.

## Important data rule

Relationships must remain ID-based across stores. Never join by display name.

Examples:

- customerId
- supplierId
- projectId
- invoiceId
- billId
- paymentId
- sourceDocumentId
- journalId

## Current routing in Next.js

- `Documents` and `DocumentLines` automatically route to Document API.
- `uploadSource` and `deleteSource` automatically route to Document API.
- reporting summary table names route to Reporting API.
- all normal finance/master/accounting tables route to Core API.
- writes are serialized per service instead of one global queue, so a document upload cannot block a finance transaction write.

## Next performance phase

After the split services are connected, the next code phase should:

1. build reporting aggregation jobs from Core → Reporting;
2. change dashboard and heavy reports to read summary tables;
3. add short-lived Next.js caching for read-mostly masters and reporting summaries;
4. remove duplicate page-level fetches and combine related datasets into one API response where useful.
