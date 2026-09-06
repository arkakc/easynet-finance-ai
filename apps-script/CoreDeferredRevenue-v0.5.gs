/*
 * EASYNET FINANCE AI — Deferred Revenue Recognition v0.5
 *
 * Add this file to the SAME Apps Script project as CoreApi-v0.4.gs (Core API 0.5.0).
 * It reuses PaymentSchedules rows where sourceType = DEFERRED_REVENUE.
 *
 * One-time setup:
 *   setupDeferredRevenueRecognitionTrigger()
 * Verification:
 *   getDeferredRevenueRecognitionStatus()
 */

const DEFERRED_REVENUE_TRIGGER_HANDLER = 'runDeferredRevenueRecognitionScheduled';
const DEFERRED_REVENUE_TIMEZONE = 'Pacific/Port_Moresby';
const DEFERRED_REVENUE_HOUR = 2;

function setupDeferredRevenueRecognitionTrigger() {
  removeDeferredRevenueRecognitionTrigger();
  const trigger = ScriptApp.newTrigger(DEFERRED_REVENUE_TRIGGER_HANDLER)
    .timeBased()
    .everyDays(1)
    .atHour(DEFERRED_REVENUE_HOUR)
    .inTimezone(DEFERRED_REVENUE_TIMEZONE)
    .create();

  PropertiesService.getScriptProperties().setProperties({
    DEFERRED_REVENUE_TRIGGER_ID: trigger.getUniqueId(),
    DEFERRED_REVENUE_TRIGGER_INSTALLED_AT: new Date().toISOString()
  });

  const firstRun = runDeferredRevenueRecognitionScheduled();
  const result = {
    ok: true,
    handler: DEFERRED_REVENUE_TRIGGER_HANDLER,
    triggerId: trigger.getUniqueId(),
    timezone: DEFERRED_REVENUE_TIMEZONE,
    everyDays: 1,
    firstRun: firstRun
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function runDeferredRevenueRecognitionScheduled() {
  const props = PropertiesService.getScriptProperties();
  const startedAt = new Date().toISOString();
  try {
    const today = Utilities.formatDate(new Date(), DEFERRED_REVENUE_TIMEZONE, 'yyyy-MM-dd');
    const schedules = coreFind_('PaymentSchedules', { sourceType: 'DEFERRED_REVENUE', status: 'PENDING' }, 500);
    const due = schedules.filter(function(row) {
      return String(row.dueDate || '').slice(0, 10) <= today;
    });

    let posted = 0;
    let recovered = 0;
    const failures = [];

    due.forEach(function(schedule) {
      try {
        const scheduleId = String(schedule.scheduleId || '');
        if (!scheduleId) throw new Error('Deferred revenue schedule is missing scheduleId');
        const parts = String(schedule.milestone || '').split('|');
        const revenueAccountId = String(parts[1] || '').trim();
        if (!revenueAccountId) throw new Error('Deferred revenue schedule is missing revenue account in milestone');
        const amount = Math.round((Number(schedule.amount || 0) + Number.EPSILON) * 100) / 100;
        if (!(amount > 0)) throw new Error('Deferred revenue schedule amount must be greater than zero');

        const existing = coreFind_('JournalHeaders', {
          documentType: 'DEFERRED_REVENUE_RECOGNITION',
          documentId: scheduleId
        }, 1);
        if (existing.length) {
          coreUpdate_('PaymentSchedules', 'scheduleId', scheduleId, { status: 'POSTED' }, 'deferred-revenue-trigger:recover');
          recovered += 1;
          return;
        }

        const journalId = 'JRN-' + Utilities.formatDate(new Date(), 'UTC', 'yyyy') + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
        const now = new Date().toISOString();
        const header = {
          journalId: journalId,
          postingDate: String(schedule.dueDate || today).slice(0, 10),
          documentType: 'DEFERRED_REVENUE_RECOGNITION',
          documentId: scheduleId,
          documentNumber: scheduleId,
          reference: 'Deferred revenue recognition for ' + String(schedule.sourceId || ''),
          projectId: String(schedule.projectId || ''),
          status: 'POSTED',
          reversalOfJournalId: '',
          createdBy: 'deferred-revenue-trigger',
          approvedBy: 'System Schedule',
          createdAt: now,
          postedAt: now
        };
        const lines = [
          {
            journalLineId: journalId + '-001',
            journalId: journalId,
            lineNo: 1,
            accountId: 'ACC-2150',
            customerId: String(schedule.partyId || ''),
            supplierId: '',
            projectId: String(schedule.projectId || ''),
            debit: amount,
            credit: 0,
            taxCode: '',
            description: 'Release deferred revenue',
            createdAt: now
          },
          {
            journalLineId: journalId + '-002',
            journalId: journalId,
            lineNo: 2,
            accountId: revenueAccountId,
            customerId: String(schedule.partyId || ''),
            supplierId: '',
            projectId: String(schedule.projectId || ''),
            debit: 0,
            credit: amount,
            taxCode: '',
            description: 'Recognized revenue',
            createdAt: now
          }
        ];

        corePostJournal_({ header: header, lines: lines, actor: 'deferred-revenue-trigger' });
        coreUpdate_('PaymentSchedules', 'scheduleId', scheduleId, { status: 'POSTED' }, 'deferred-revenue-trigger');
        posted += 1;
      } catch (error) {
        failures.push({
          scheduleId: String(schedule.scheduleId || ''),
          error: String(error && error.message ? error.message : error)
        });
      }
    });

    const result = {
      ok: failures.length === 0,
      runAt: startedAt,
      accountingDate: today,
      dueCount: due.length,
      posted: posted,
      recovered: recovered,
      failures: failures
    };
    props.setProperties({
      DEFERRED_REVENUE_LAST_RUN_AT: startedAt,
      DEFERRED_REVENUE_LAST_STATUS: failures.length ? 'PARTIAL_FAILURE' : 'SUCCESS',
      DEFERRED_REVENUE_LAST_ERROR: failures.length ? JSON.stringify(failures).slice(0, 4000) : ''
    });
    Logger.log(JSON.stringify(result, null, 2));
    if (failures.length) throw new Error('Deferred revenue recognition completed with ' + failures.length + ' failure(s)');
    return result;
  } catch (error) {
    props.setProperties({
      DEFERRED_REVENUE_LAST_RUN_AT: startedAt,
      DEFERRED_REVENUE_LAST_STATUS: 'FAILED',
      DEFERRED_REVENUE_LAST_ERROR: String(error && error.message ? error.message : error).slice(0, 4000)
    });
    throw error;
  }
}

function getDeferredRevenueRecognitionStatus() {
  const props = PropertiesService.getScriptProperties();
  const triggers = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === DEFERRED_REVENUE_TRIGGER_HANDLER;
  });
  const result = {
    ok: true,
    installed: triggers.length > 0,
    handler: DEFERRED_REVENUE_TRIGGER_HANDLER,
    timezone: DEFERRED_REVENUE_TIMEZONE,
    everyDays: 1,
    triggerCount: triggers.length,
    triggerIds: triggers.map(function(trigger) { return trigger.getUniqueId(); }),
    lastRunAt: props.getProperty('DEFERRED_REVENUE_LAST_RUN_AT') || '',
    lastRunStatus: props.getProperty('DEFERRED_REVENUE_LAST_STATUS') || '',
    lastRunError: props.getProperty('DEFERRED_REVENUE_LAST_ERROR') || ''
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function removeDeferredRevenueRecognitionTrigger() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === DEFERRED_REVENUE_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
      removed += 1;
    }
  });
  PropertiesService.getScriptProperties().deleteProperty('DEFERRED_REVENUE_TRIGGER_ID');
  return { ok: true, removed: removed };
}
