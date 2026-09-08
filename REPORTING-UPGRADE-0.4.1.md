# Reporting API v0.4.1 Upgrade Gate

The feature branch contains a single deployment file: `apps-script/ReportingApi-v0.4.1.gs`.

## Why v0.4.1 is required

Reporting v0.4.1 includes these release-critical corrections:

- excludes both `CANCELLED` and `REVERSED` accounting source documents;
- treats `CN-` Sales Credit Notes as negative sales in materialized sales summaries;
- includes Cash, Operating Bank and Savings/Reserve Bank in Cash & Bank KPI;
- derives project profitability from posted GL lines rather than treating inventory purchases as immediate project expense;
- excludes Supplier Quotations and closed/closed-partial POs from PO commitments;
- exposes AR/AP reconciliation differences in dashboard KPI materialization.

## Deployment procedure

Use only the existing Reporting Apps Script file. Do not create a second helper file.

1. Open the existing Reporting Google Sheet and choose **Extensions → Apps Script**.
2. Open the existing script file that currently contains `const REPORTING_API_VERSION = '0.4.0';`.
3. Delete all code in that existing file and replace it with the complete repository file `apps-script/ReportingApi-v0.4.1.gs`.
4. Save the Apps Script project.
5. Run `installReportingRefreshTrigger()` once.
6. Run `refreshReportingMaterializedViews()` once.
7. Confirm `getReportingRefreshStatus()` returns version `0.4.1`, `coreConfigured: true`, and `refreshTriggerCount: 1`.
8. Deploy → Manage deployments → Edit the existing Web App deployment → select **New version** → Deploy. Keep the same execution/access policy currently used by the Reporting backend.
9. If the existing deployment is edited, normally continue using its existing `/exec` URL. If Google creates a different Web App URL, update `REPORTING_APPS_SCRIPT_WEB_APP_URL` in the Vercel Preview environment. Keep the current API token unless intentionally rotated.

## Verification

After deployment:

- Management Dashboard → Backend Readiness must show **Reporting API 0.4.1 · READY**.
- `ReportDashboardKPI` must contain a current `materializedAt` value.
- Credit Note test data must reduce materialized sales.
- Reversed documents must not contribute to reporting summaries.
- AR/AP reconciliation differences should match the Finance Control Centre review.

Do not hide or suppress the upgrade warning and do not merge the feature branch to `main` while the connected Reporting health endpoint still returns v0.4.0.
