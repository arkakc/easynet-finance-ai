# Reporting API v0.4.1 Upgrade Gate

The feature branch contains `apps-script/ReportingApi-v0.4.1.gs`. The deployed Google Apps Script Reporting service must report v0.4.1 before Accounting 0.5 UAT can be signed off.

## Why v0.4.1 is required

Reporting v0.4.1 includes these release-critical corrections:

- excludes both `CANCELLED` and `REVERSED` accounting source documents;
- treats `CN-` Sales Credit Notes as negative sales in materialized sales summaries;
- includes Cash, Operating Bank and Savings/Reserve Bank in Cash & Bank KPI;
- derives project profitability from posted GL lines rather than treating inventory purchases as immediate project expense;
- excludes Supplier Quotations and closed/closed-partial POs from PO commitments;
- exposes AR/AP reconciliation differences in dashboard KPI materialization.

## One-run upgrade procedure

The branch also contains `apps-script/ReportingUpgrade-v0.4.1.gs`. Keep it in the same Apps Script project as `ReportingApi-v0.4.1.gs`.

1. Open the existing Reporting Apps Script project connected to the Reporting Google Sheet.
2. Replace the current Reporting API code with `apps-script/ReportingApi-v0.4.1.gs`.
3. Add or replace the helper file with `apps-script/ReportingUpgrade-v0.4.1.gs`.
4. Save the Apps Script project.
5. Run `upgradeReportingTo041()` once and authorize it if Google prompts for permissions.
6. The helper preserves the existing `API_TOKEN`, existing Core/Document source IDs, ensures all v0.4.1 reporting sheets, installs exactly one five-minute materializer trigger, refreshes all materialized reporting tables immediately, and verifies v0.4.1 KPI/freshness requirements.
7. A successful result must include `ok: true`, `version: "0.4.1"`, `refreshTriggerCount: 1`, `materializerFresh: true`, and a current `materializedAt`. The helper intentionally does not log or return the API token.
8. Deploy → Manage deployments → Edit the existing Web App deployment → select **New version** → Deploy. Keep the same execution/access policy currently used by the Reporting backend.
9. If the existing deployment is edited, normally continue using its existing `/exec` URL. If Google creates a different Web App URL, update `REPORTING_APPS_SCRIPT_WEB_APP_URL` in the Vercel Preview environment. Keep the current token unless you intentionally rotated it. The URL/token pair must always be complete.

## Verification

After the new Web App version is deployed:

- Management Dashboard → Backend Readiness must show **Reporting API 0.4.1 · READY**.
- `ReportDashboardKPI` must contain a current `materializedAt` value.
- Credit Note test data must reduce materialized sales.
- Reversed documents must not contribute to reporting summaries.
- AR/AP reconciliation differences should match the Finance Control Centre review.

Do not hide or suppress the upgrade warning and do not merge the feature branch to `main` while the connected Reporting health endpoint still returns v0.4.0.
