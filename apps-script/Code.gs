const APP_VERSION = '0.1.1';
const DRIVE_ROOT_NAME = 'Easynet Finance Source Documents';

const TABLES = {
  Settings: ['key','value','notes','updatedAt'],
  Accounts: ['accountId','accountCode','accountName','accountType','parentAccount','active','createdAt','updatedAt'],
  Customers: ['customerId','customerName','contactPerson','phone','email','address','taxId','creditTermsDays','creditLimit','active','createdAt','updatedAt'],
  Suppliers: ['supplierId','supplierName','contactPerson','phone','email','address','taxId','paymentTermsDays','active','createdAt','updatedAt'],
  Projects: ['projectId','projectName','customerId','startDate','endDate','status','contractNet','gstAmount','contractTotal','expectedCost','projectManager','createdAt','updatedAt'],
  Items: ['itemId','itemCode','itemName','itemType','revenueAccount','costAccount','defaultRate','taxCode','active','createdAt','updatedAt'],
  Documents: ['documentId','sourceFileName','driveFileId','driveUrl','sha256','documentType','documentNumber','partyType','partyId','projectId','documentDate','netAmount','gstAmount','totalAmount','currency','aiConfidence','status','uploadedBy','createdAt','updatedAt'],
  DocumentLines: ['documentLineId','documentId','lineNo','itemId','description','qty','uom','rate','netAmount','gstAmount','totalAmount','createdAt'],
  Quotes: ['quoteId','quoteNumber','customerId','projectId','quoteDate','expiryDate','netAmount','gstAmount','totalAmount','status','sourceDocumentId','createdAt','updatedAt'],
  QuoteLines: ['quoteLineId','quoteId','lineNo','itemId','description','qty','uom','rate','netAmount','gstAmount','totalAmount'],
  PurchaseOrders: ['poId','poNumber','supplierId','projectId','poDate','netAmount','gstAmount','totalAmount','status','sourceDocumentId','createdAt','updatedAt'],
  POLines: ['poLineId','poId','lineNo','itemId','description','qty','uom','rate','netAmount','gstAmount','totalAmount'],
  Invoices: ['invoiceId','invoiceNumber','customerId','projectId','invoiceDate','dueDate','netAmount','gstAmount','totalAmount','paidAmount','outstandingAmount','status','sourceDocumentId','journalId','createdAt','updatedAt'],
  InvoiceLines: ['invoiceLineId','invoiceId','lineNo','itemId','description','qty','uom','rate','netAmount','gstAmount','totalAmount','revenueAccountId'],
  SupplierBills: ['billId','billNumber','supplierId','projectId','billDate','dueDate','poId','netAmount','gstAmount','totalAmount','paidAmount','outstandingAmount','status','sourceDocumentId','journalId','createdAt','updatedAt'],
  SupplierBillLines: ['billLineId','billId','lineNo','itemId','description','qty','uom','rate','netAmount','gstAmount','totalAmount','costAccountId'],
  Payments: ['paymentId','paymentNumber','paymentType','partyType','partyId','projectId','paymentDate','amount','paymentMethod','cashBankAccountId','reference','againstDocumentType','againstDocumentId','sourceDocumentId','journalId','status','createdAt','updatedAt'],
  Expenses: ['expenseId','expenseNumber','expenseDate','supplierId','projectId','expenseAccountId','description','netAmount','gstAmount','totalAmount','paymentMethod','cashBankAccountId','sourceDocumentId','journalId','status','createdAt','updatedAt'],
  Loans: ['loanId','lenderName','loanDate','principal','interestRate','contractInterest','expectedSettlement','principalRepaid','interestPaid','principalOutstanding','interestOutstanding','repaymentCondition','sourceDocumentId','status','createdAt','updatedAt'],
  JournalHeaders: ['journalId','postingDate','documentType','documentId','documentNumber','reference','projectId','status','reversalOfJournalId','createdBy','approvedBy','createdAt','postedAt'],
  JournalLines: ['journalLineId','journalId','lineNo','accountId','customerId','supplierId','projectId','debit','credit','taxCode','description','createdAt'],
  PaymentSchedules: ['scheduleId','sourceType','sourceId','projectId','partyId','milestone','dueDate','percentage','amount','status','createdAt','updatedAt'],
  StockMovements: ['movementId','movementDate','itemId','projectId','movementType','qtyIn','qtyOut','unitCost','value','sourceDocumentId','createdAt'],
  FixedAssets: ['assetId','assetName','assetCategory','purchaseDate','supplierId','cost','serialNumber','location','assignedTo','usefulLifeMonths','accumulatedDepreciation','netBookValue','status','sourceDocumentId','createdAt','updatedAt'],
  Budgets: ['budgetId','financialYear','period','accountId','projectId','budgetAmount','actualAmount','variance','createdAt','updatedAt'],
  Exceptions: ['exceptionId','severity','module','recordType','recordId','message','status','assignedTo','createdAt','resolvedAt','resolution'],
  AuditLog: ['auditId','timestamp','actor','action','tableName','recordId','details']
};

function doGet() {
  return json_({ ok: true, service: 'Easynet Finance AI Backend', version: APP_VERSION, time: new Date().toISOString() });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    requireToken_(body.token);
    const action = String(body.action || '');
    const payload = body.payload || {};

    if (action === 'health') return json_({ ok: true, version: APP_VERSION });
    if (action === 'bootstrapStatus') return json_(bootstrapStatus_());
    if (action === 'list') return json_({ ok: true, rows: listRows_(payload.table, payload.limit, payload.offset) });
    if (action === 'find') return json_({ ok: true, rows: findRows_(payload.table, payload.filters || {}, payload.limit) });
    if (action === 'append') return json_({ ok: true, row: appendRecord_(payload.table, payload.record || {}, payload.actor || 'system') });
    if (action === 'update') return json_({ ok: true, row: updateRecord_(payload.table, payload.idField, payload.idValue, payload.patch || {}, payload.actor || 'system') });
    if (action === 'batchAppend') return json_({ ok: true, rows: batchAppend_(payload.table, payload.records || [], payload.actor || 'system') });

    throw new Error('Unsupported action');
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function bootstrapDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('This Apps Script must be bound to Easynet Finance AI DB.');

  // Persist the spreadsheet ID before any helper calls table_()/getSpreadsheet_.
  // The previous order caused first-run bootstrap to fail with "Backend is not bootstrapped".
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());

  Object.keys(TABLES).forEach(function(name) {
    ensureSheet_(ss, name, TABLES[name]);
  });

  configureDriveRootByName_();
  const token = ensureApiToken_();

  setSetting_('company_name', 'Easynet IT Solutions Limited', 'Legal/company display name');
  setSetting_('base_currency', 'PGK', 'Base accounting currency');
  setSetting_('financial_year_start_month', '1', 'January = 1');
  setSetting_('gst_status', 'UNVERIFIED', 'Do not treat GST registration as verified until evidence is retained');
  setSetting_('app_version', APP_VERSION, 'Backend schema/application version');

  audit_('bootstrap', 'Database', '', 'Database schema bootstrapped');
  Logger.log('Bootstrap complete. API token: ' + token);
  Logger.log('Keep this token secret. It will later be added only to Vercel Environment Variables.');
  return { ok: true, spreadsheetId: ss.getId(), apiToken: token };
}

function showBackendConfig() {
  const props = PropertiesService.getScriptProperties();
  const result = {
    spreadsheetId: props.getProperty('SPREADSHEET_ID') || '',
    driveRootFolderId: props.getProperty('DRIVE_ROOT_FOLDER_ID') || '',
    hasApiToken: Boolean(props.getProperty('API_TOKEN')),
    version: APP_VERSION
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function rotateApiToken() {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_TOKEN', token);
  Logger.log('New API token: ' + token);
  return token;
}

function configureDriveRootByName_() {
  const iterator = DriveApp.getFoldersByName(DRIVE_ROOT_NAME);
  if (!iterator.hasNext()) throw new Error('Google Drive folder not found: ' + DRIVE_ROOT_NAME);
  const folder = iterator.next();
  PropertiesService.getScriptProperties().setProperty('DRIVE_ROOT_FOLDER_ID', folder.getId());
  return folder.getId();
}

function ensureApiToken_() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('API_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('API_TOKEN', token);
  }
  return token;
}

function requireToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!expected || !token || String(token) !== String(expected)) throw new Error('Unauthorized');
}

function bootstrapStatus_() {
  const ss = getSpreadsheet_();
  const missing = Object.keys(TABLES).filter(function(name) { return !ss.getSheetByName(name); });
  return { ok: missing.length === 0, version: APP_VERSION, missingSheets: missing };
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Backend is not bootstrapped. Run bootstrapDatabase() first.');
  return SpreadsheetApp.openById(id);
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const current = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0] : [];
  const mismatch = headers.some(function(h, i) { return current[i] !== h; });
  if (sheet.getLastRow() === 0 || mismatch) {
    if (sheet.getLastRow() > 1) throw new Error('Header mismatch on non-empty sheet: ' + name);
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.autoResizeColumns(1, headers.length);
}

function table_(name) {
  if (!Object.prototype.hasOwnProperty.call(TABLES, name)) throw new Error('Unknown table: ' + name);
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('Missing table: ' + name);
  return { sheet: sheet, headers: TABLES[name] };
}

function listRows_(name, limit, offset) {
  const t = table_(name);
  const lastRow = t.sheet.getLastRow();
  if (lastRow <= 1) return [];
  const start = Math.max(2, 2 + Number(offset || 0));
  if (start > lastRow) return [];
  const count = Math.min(Number(limit || 100), lastRow - start + 1, 500);
  const values = t.sheet.getRange(start, 1, count, t.headers.length).getValues();
  return values.map(function(row) { return rowToObject_(t.headers, row); });
}

function findRows_(name, filters, limit) {
  const rows = listRows_(name, 500, 0);
  const keys = Object.keys(filters || {});
  return rows.filter(function(row) {
    return keys.every(function(key) { return String(row[key] == null ? '' : row[key]) === String(filters[key] == null ? '' : filters[key]); });
  }).slice(0, Math.min(Number(limit || 100), 500));
}

function appendRecord_(name, record, actor) {
  const t = table_(name);
  const now = new Date().toISOString();
  const normalized = Object.assign({}, record);
  const idField = t.headers[0];
  if (!normalized[idField]) normalized[idField] = Utilities.getUuid();
  if (t.headers.indexOf('createdAt') >= 0 && !normalized.createdAt) normalized.createdAt = now;
  if (t.headers.indexOf('updatedAt') >= 0) normalized.updatedAt = now;
  const row = t.headers.map(function(h) { return safeCell_(normalized[h]); });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    t.sheet.appendRow(row);
  } finally {
    lock.releaseLock();
  }
  if (name !== 'AuditLog') audit_('append', name, normalized[idField], 'Record appended', actor);
  return normalized;
}

function batchAppend_(name, records, actor) {
  if (!Array.isArray(records) || records.length === 0) return [];
  if (records.length > 200) throw new Error('Maximum batch size is 200 records');
  return records.map(function(r) { return appendRecord_(name, r, actor); });
}

function updateRecord_(name, idField, idValue, patch, actor) {
  const t = table_(name);
  if (name === 'JournalHeaders' || name === 'JournalLines' || name === 'AuditLog') throw new Error('Direct updates are blocked for immutable accounting/audit tables');
  const idIndex = t.headers.indexOf(idField);
  if (idIndex < 0) throw new Error('Invalid id field');
  const lastRow = t.sheet.getLastRow();
  if (lastRow <= 1) throw new Error('Record not found');
  const values = t.sheet.getRange(2, 1, lastRow - 1, t.headers.length).getValues();
  let target = -1;
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][idIndex]) === String(idValue)) { target = i + 2; break; }
  }
  if (target < 0) throw new Error('Record not found');

  const existing = rowToObject_(t.headers, values[target - 2]);
  const merged = Object.assign({}, existing, patch || {});
  if (t.headers.indexOf('updatedAt') >= 0) merged.updatedAt = new Date().toISOString();
  const row = t.headers.map(function(h) { return safeCell_(merged[h]); });
  t.sheet.getRange(target, 1, 1, t.headers.length).setValues([row]);
  audit_('update', name, idValue, 'Record updated', actor);
  return merged;
}

function setSetting_(key, value, notes) {
  const t = table_('Settings');
  const rows = listRows_('Settings', 500, 0);
  const found = rows.find(function(r) { return String(r.key) === String(key); });
  if (found) return updateRecord_('Settings', 'key', key, { value: value, notes: notes }, 'bootstrap');
  return appendRecord_('Settings', { key: key, value: value, notes: notes }, 'bootstrap');
}

function audit_(action, tableName, recordId, details, actor) {
  try {
    const t = table_('AuditLog');
    t.sheet.appendRow([
      Utilities.getUuid(),
      new Date().toISOString(),
      actor || 'system',
      action || '',
      tableName || '',
      recordId || '',
      details || ''
    ]);
  } catch (e) {
    console.error('Audit log failed', e);
  }
}

function rowToObject_(headers, row) {
  const obj = {};
  headers.forEach(function(h, i) { obj[h] = row[i]; });
  return obj;
}

function safeCell_(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' && /^[=+\-@]/.test(value)) return "'" + value;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
