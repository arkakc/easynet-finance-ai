const REPORTING_API_VERSION = '0.4.0';

const REPORTING_TABLES = {
  ReportDashboardKPI: ['key','value','periodStart','periodEnd','updatedAt'],
  ReportDailySales: ['date','netAmount','gstAmount','totalAmount','invoiceCount','updatedAt'],
  ReportDailyPurchases: ['date','netAmount','gstAmount','totalAmount','invoiceCount','updatedAt'],
  ReportARSummary: ['customerId','outstandingAmount','currentAmount','days30','days60','days90','over90','updatedAt'],
  ReportAPSummary: ['supplierId','outstandingAmount','currentAmount','days30','days60','days90','over90','updatedAt'],
  ReportGSTSummary: ['period','outputGST','inputGST','netGST','status','updatedAt'],
  ReportProjectProfitability: ['projectId','revenue','purchaseCost','expenseCost','grossProfit','marginPercent','updatedAt']
};

function doGet() { return reportingJson_({ ok: true, service: 'Easynet Finance Reporting API', version: REPORTING_API_VERSION }); }

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    reportingRequireToken_(body.token);
    const action = String(body.action || '');
    const payload = body.payload || {};
    if (action === 'health') return reportingJson_({ ok: true, version: REPORTING_API_VERSION });
    if (action === 'bootstrapStatus') return reportingJson_(reportingBootstrapStatus_());
    if (action === 'list') return reportingJson_({ ok: true, rows: reportingList_(payload.table, payload.limit, payload.offset) });
    if (action === 'find') return reportingJson_({ ok: true, rows: reportingFind_(payload.table, payload.filters || {}, payload.limit) });
    if (action === 'append') return reportingJson_({ ok: true, row: reportingAppend_(payload.table, payload.record || {}) });
    if (action === 'batchAppend') return reportingJson_({ ok: true, rows: reportingBatchAppend_(payload.table, payload.records || []) });
    if (action === 'update') return reportingJson_({ ok: true, row: reportingUpdate_(payload.table, payload.idField, payload.idValue, payload.patch || {}) });
    throw new Error('Unsupported Reporting API action: ' + action);
  } catch (err) {
    return reportingJson_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function bootstrapReportingDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Bind this script to the Reporting spreadsheet.');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  Object.keys(REPORTING_TABLES).forEach(function(name) { reportingEnsureSheet_(ss, name, REPORTING_TABLES[name]); });
  const token = reportingEnsureToken_();
  Logger.log('Reporting API ready. Spreadsheet ID: ' + ss.getId());
  Logger.log('API token: ' + token);
  return { ok: true, spreadsheetId: ss.getId(), apiToken: token, version: REPORTING_API_VERSION };
}

function reportingSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Reporting backend is not bootstrapped. Run bootstrapReportingDatabase().');
  return SpreadsheetApp.openById(id);
}

function reportingTable_(name) {
  if (!Object.prototype.hasOwnProperty.call(REPORTING_TABLES, name)) throw new Error('Unknown Reporting table: ' + name);
  const sheet = reportingSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('Missing Reporting table: ' + name);
  return { sheet: sheet, headers: REPORTING_TABLES[name] };
}

function reportingList_(name, limit, offset) {
  const t = reportingTable_(name);
  const lastRow = t.sheet.getLastRow();
  if (lastRow <= 1) return [];
  const start = Math.max(2, 2 + Number(offset || 0));
  if (start > lastRow) return [];
  const count = Math.min(Math.max(1, Number(limit || 100)), lastRow - start + 1, 500);
  return t.sheet.getRange(start, 1, count, t.headers.length).getValues().map(function(row) { return reportingRowObject_(t.headers, row); });
}

function reportingFind_(name, filters, limit) {
  const rows = reportingList_(name, 500, 0);
  const keys = Object.keys(filters || {});
  return rows.filter(function(row) {
    return keys.every(function(key) { return String(row[key] == null ? '' : row[key]) === String(filters[key] == null ? '' : filters[key]); });
  }).slice(0, Math.min(Number(limit || 100), 500));
}

function reportingAppend_(name, record) {
  const t = reportingTable_(name);
  const next = Object.assign({}, record, { updatedAt: new Date().toISOString() });
  const row = t.headers.map(function(h) { return next[h] == null ? '' : next[h]; });
  t.sheet.appendRow(row);
  return reportingRowObject_(t.headers, row);
}

function reportingBatchAppend_(name, records) {
  if (!Array.isArray(records) || !records.length) return [];
  const t = reportingTable_(name);
  const now = new Date().toISOString();
  const rows = records.map(function(record) {
    const next = Object.assign({}, record, { updatedAt: now });
    return t.headers.map(function(h) { return next[h] == null ? '' : next[h]; });
  });
  t.sheet.getRange(t.sheet.getLastRow() + 1, 1, rows.length, t.headers.length).setValues(rows);
  return rows.map(function(row) { return reportingRowObject_(t.headers, row); });
}

function reportingUpdate_(name, idField, idValue, patch) {
  const t = reportingTable_(name);
  const idIndex = t.headers.indexOf(String(idField || ''));
  if (idIndex < 0) throw new Error('Invalid idField for ' + name + ': ' + idField);
  const lastRow = t.sheet.getLastRow();
  if (lastRow <= 1) throw new Error('Record not found');
  const values = t.sheet.getRange(2, 1, lastRow - 1, t.headers.length).getValues();
  const match = values.findIndex(function(row) { return String(row[idIndex]) === String(idValue); });
  if (match < 0) throw new Error('Record not found: ' + idValue);
  const current = reportingRowObject_(t.headers, values[match]);
  const next = Object.assign({}, current, patch, { updatedAt: new Date().toISOString() });
  const row = t.headers.map(function(h) { return next[h] == null ? '' : next[h]; });
  t.sheet.getRange(match + 2, 1, 1, t.headers.length).setValues([row]);
  return reportingRowObject_(t.headers, row);
}

function reportingBootstrapStatus_() {
  const ss = reportingSpreadsheet_();
  const missing = Object.keys(REPORTING_TABLES).filter(function(name) { return !ss.getSheetByName(name); });
  return { ok: missing.length === 0, version: REPORTING_API_VERSION, missingSheets: missing };
}

function reportingEnsureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
}

function reportingRowObject_(headers, row) {
  const obj = {};
  headers.forEach(function(h, i) { obj[h] = row[i]; });
  return obj;
}

function reportingEnsureToken_() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('API_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('API_TOKEN', token);
  }
  return token;
}

function reportingRequireToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!expected || !token || String(token) !== String(expected)) throw new Error('Unauthorized');
}

function reportingJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
