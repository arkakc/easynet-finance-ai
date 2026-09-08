# Reporting API v0.4.1 Upgrade Gate

The feature branch contains `apps-script/ReportingApi-v0.4.1.gs`, but the deployed Google Apps Script Reporting service must be upgraded manually before Accounting 0.5 UAT can be signed off.

## Why v0.4.1 is required

Reporting v0.4.1 includes these release-critical corrections:

- excludes both `CANCELLED` and `REVERSED` accounting source documents;
- treats `CN-` Sales Credit Notes as negative sales in materialized sales summaries;
- includes Cash, Operating Bank and Savings/Reserve Bank in Cash & Bank KPI;
- derives project profitability from posted GL lines rather than treating inventory purchases as immediate project expense;
- excludes Supplier Quotations and closed/closed-partial POs from PO commitments;
- exposes AR/AP reconciliation differences in dashboard KPI materialization.

## Manual Google Apps Script deployment

1. Open the existing Reporting Apps Script project connected to the Reporting Google Sheet.
2. Replace the Reporting API script with the current repository file:
   `apps-script/ReportingApi-v0.4.1.gs`
3. Save the Apps Script project.
4. Run the script's setup/bootstrap function if the project has not already been initialized.
5. Ensure the existing API token remains configured in Apps Script Script Properties. Do not paste or commit API tokens into source code.
6. Deploy a new Web App version using the same execution/access policy currently used by the Reporting backend.
7. If Google provides a different Web App URL, update the Reporting backend URL in the Vercel Preview environment manually. The application must have a complete Reporting URL/token pair; it intentionally refuses partial split-backend configuration.
8. Install/confirm the Reporting materializer trigger so the reporting tables refresh every five minutes.
9. Run one materializer refresh immediately after deployment.

## Verification

After deployment:

- Management Dashboard → Backend Readiness must show **Reporting API 0.4.1 · READY**.
- ReportDashboardKPI must contain a current `materializedAt` value.
- Credit Note test data must reduce materialized sales.
- Reversed documents must not contribute to reporting summaries.
- AR/AP reconciliation differences should match the Finance Control Centre review.

Do not merge the feature branch to `main` while Reporting health still returns v0.4.0.
