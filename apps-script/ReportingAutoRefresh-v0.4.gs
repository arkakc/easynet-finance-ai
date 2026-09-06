// Easynet Finance Reporting Auto Refresh
// Add this file to the SAME Apps Script project as ReportingApi-v0.4.gs.
// Run setupAutomaticReportingRefresh() once to authorize and install the trigger.

const REPORTING_AUTO_REFRESH_HANDLER = 'runReportingMaterializerScheduled';
const REPORTING_AUTO_REFRESH_MINUTES = 5;
const REPORTING_CORE_DATABASE_ID = '1W3LozuPEN9TxE9Uz0ofFxFZsB0SAtfqvR_2201wfmV0';
const REPORTING_DOCUMENT_DATABASE_ID = '10vgEie8HmgL2QqXKmKdQDRRgkNznLlxaO4PEZJ2yQRo';

function setupAutomaticReportingRefresh() {
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    REPORTING_CORE_DATABASE_ID: REPORTING_CORE_DATABASE_ID,
    REPORTING_DOCUMENT_DATABASE_ID: REPORTING_DOCUMENT_DATABASE_ID,
    REPORTING_AUTO_REFRESH_MINUTES: String(REPORTING_AUTO_REFRESH_MINUTES)
  });

  removeAutomaticReportingRefreshTrigger_();

  const trigger = ScriptApp.newTrigger(REPORTING_AUTO_REFRESH_HANDLER)
    .timeBased()
    .everyMinutes(REPORTING_AUTO_REFRESH_MINUTES)
    .create();

  const firstRun = runReportingMaterializerScheduled();
  const result = {
    ok: true,
    handler: REPORTING_AUTO_REFRESH_HANDLER,
    everyMinutes: REPORTING_AUTO_REFRESH_MINUTES,
    triggerId: trigger.getUniqueId(),
    firstRun: firstRun
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function runReportingMaterializerScheduled() {
  const props = PropertiesService.getScriptProperties();
  const coreSpreadsheetId = props.getProperty('REPORTING_CORE_DATABASE_ID') || REPORTING_CORE_DATABASE_ID;
  const documentSpreadsheetId = props.getProperty('REPORTING_DOCUMENT_DATABASE_ID') || REPORTING_DOCUMENT_DATABASE_ID;
  const startedAt = new Date().toISOString();

  try {
    const result = materializeReportingFromSplitDatabases(coreSpreadsheetId, documentSpreadsheetId);
    props.setProperties({
      REPORTING_LAST_REFRESH_AT: new Date().toISOString(),
      REPORTING_LAST_REFRESH_STATUS: 'SUCCESS',
      REPORTING_LAST_REFRESH_ERROR: ''
    });
    return result;
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    props.setProperties({
      REPORTING_LAST_REFRESH_AT: startedAt,
      REPORTING_LAST_REFRESH_STATUS: 'ERROR',
      REPORTING_LAST_REFRESH_ERROR: message
    });
    console.error('Automatic reporting refresh failed:', message);
    throw error;
  }
}

function getAutomaticReportingRefreshStatus() {
  const props = PropertiesService.getScriptProperties();
  const triggers = ScriptApp.getProjectTriggers()
    .filter(function(trigger) {
      return trigger.getHandlerFunction() === REPORTING_AUTO_REFRESH_HANDLER;
    })
    .map(function(trigger) {
      return {
        id: trigger.getUniqueId(),
        handler: trigger.getHandlerFunction(),
        eventType: String(trigger.getEventType()),
        source: String(trigger.getTriggerSource())
      };
    });

  const result = {
    ok: true,
    installed: triggers.length > 0,
    everyMinutes: Number(props.getProperty('REPORTING_AUTO_REFRESH_MINUTES') || REPORTING_AUTO_REFRESH_MINUTES),
    lastRefreshAt: props.getProperty('REPORTING_LAST_REFRESH_AT') || '',
    lastRefreshStatus: props.getProperty('REPORTING_LAST_REFRESH_STATUS') || 'NOT_RUN',
    lastRefreshError: props.getProperty('REPORTING_LAST_REFRESH_ERROR') || '',
    triggers: triggers
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function removeAutomaticReportingRefreshTrigger() {
  const removed = removeAutomaticReportingRefreshTrigger_();
  const result = { ok: true, removed: removed };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function removeAutomaticReportingRefreshTrigger_() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === REPORTING_AUTO_REFRESH_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
      removed += 1;
    }
  });
  return removed;
}
