/*
 * Easynet Finance Reporting API v0.4.1 upgrade helper.
 *
 * Keep this file in the same Google Apps Script project as ReportingApi-v0.4.1.gs.
 * It intentionally preserves the existing API_TOKEN and source spreadsheet IDs.
 */

function upgradeReportingTo041() {
  if (typeof REPORTING_API_VERSION === 'undefined' || String(REPORTING_API_VERSION) !== '0.4.1') {
    throw new Error('ReportingApi-v0.4.1.gs is not loaded. Replace the Reporting API code with v0.4.1 first.');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Bind this script to the existing Reporting spreadsheet.');

  const props = PropertiesService.getScriptProperties();
  const existingToken = props.getProperty('API_TOKEN');
  const coreId = props.getProperty('CORE_SOURCE_SPREADSHEET_ID');
  const documentId = props.getProperty('DOCUMENT_SOURCE_SPREADSHEET_ID') || '';

  if (!coreId) {
    throw new Error('CORE_SOURCE_SPREADSHEET_ID is missing. Configure the existing Core source before upgrading.');
  }

  // Preserve the existing Reporting spreadsheet binding and ensure all v0.4.1 tables exist.
  props.setProperty('SPREADSHEET_ID', ss.getId());
  Object.keys(REPORTING_TABLES).forEach(function(name) {
    reportingEnsureSheet_(ss, name, REPORTING_TABLES[name]);
  });

  // Never rotate a working token during an upgrade. Only create one for a genuinely uninitialized project.
  if (!existingToken) reportingEnsureToken_();

  // Validate the preserved source references before changing the trigger/materialized data.
  SpreadsheetApp.openById(String(coreId));
  if (documentId) SpreadsheetApp.openById(String(documentId));

  const triggerResult = installReportingRefreshTrigger();
  const refreshResult = refreshReportingMaterializedViews();
  const verification = verifyReporting041();

  if (!verification.ok) {
    throw new Error('Reporting v0.4.1 verification failed: ' + verification.issues.join('; '));
  }

  const result = {
    ok: true,
    version: REPORTING_API_VERSION,
    spreadsheetId: ss.getId(),
    tokenPreserved: Boolean(existingToken),
    coreConfigured: true,
    documentConfigured: Boolean(documentId),
    refreshTriggerCount: triggerResult && triggerResult.everyMinutes === 5 ? 1 : verification.refreshTriggerCount,
    materializedAt: verification.materializedAt,
    refresh: refreshResult,
    verification: verification
  };

  // Safe to log: no API token or secret values are included.
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function verifyReporting041() {
  const issues = [];
  const props = PropertiesService.getScriptProperties();
  const coreConfigured = Boolean(props.getProperty('CORE_SOURCE_SPREADSHEET_ID'));
  const documentConfigured = Boolean(props.getProperty('DOCUMENT_SOURCE_SPREADSHEET_ID'));

  if (String(REPORTING_API_VERSION) !== '0.4.1') issues.push('API version is not 0.4.1');
  if (!coreConfigured) issues.push('Core reporting source is not configured');

  const triggers = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === 'refreshReportingMaterializedViews';
  });
  if (triggers.length !== 1) issues.push('Expected exactly one 5-minute reporting refresh trigger; found ' + triggers.length);

  let materializedAt = '';
  let requiredKpisPresent = false;
  try {
    const rows = reportingList_('ReportDashboardKPI', 500, 0);
    const map = {};
    rows.forEach(function(row) { map[String(row.key || '')] = row.value; });
    materializedAt = String(map.materializedAt || '');
    const requiredKeys = [
      'cashBank',
      'accountsReceivable',
      'accountsPayable',
      'poCommitments',
      'arReconciliationDifference',
      'apReconciliationDifference',
      'materializedAt'
    ];
    const missing = requiredKeys.filter(function(key) {
      return !Object.prototype.hasOwnProperty.call(map, key);
    });
    requiredKpisPresent = missing.length === 0;
    if (missing.length) issues.push('Missing v0.4.1 KPI keys: ' + missing.join(', '));
    if (!materializedAt) issues.push('ReportDashboardKPI materializedAt is blank');
  } catch (err) {
    issues.push('Unable to inspect ReportDashboardKPI: ' + String(err && err.message ? err.message : err));
  }

  let materializerFresh = false;
  if (materializedAt) {
    const timestamp = new Date(materializedAt).getTime();
    if (isFinite(timestamp)) {
      const ageMinutes = Math.max(0, (Date.now() - timestamp) / 60000);
      materializerFresh = ageMinutes <= 10;
      if (!materializerFresh) issues.push('Reporting materializer is stale (' + ageMinutes.toFixed(1) + ' minutes old)');
    } else {
      issues.push('materializedAt is not a valid timestamp');
    }
  }

  return {
    ok: issues.length === 0,
    version: REPORTING_API_VERSION,
    coreConfigured: coreConfigured,
    documentConfigured: documentConfigured,
    refreshTriggerCount: triggers.length,
    materializedAt: materializedAt,
    materializerFresh: materializerFresh,
    requiredKpisPresent: requiredKpisPresent,
    issues: issues
  };
}
