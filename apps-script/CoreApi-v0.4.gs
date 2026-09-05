const CORE_API_VERSION = '0.4.0';

const CORE_TABLES = {
  Settings: ['key','value','notes','updatedAt'],
  Accounts: ['accountId','accountCode','accountName','accountType','parentAccount','active','createdAt','updatedAt'],
  Customers: ['customerId','customerName','contactPerson','phone','email','address','taxId','creditTermsDays','creditLimit','active','createdAt','updatedAt'],
  Suppliers: ['supplierId','supplierName','contactPerson','phone','email','address','taxId','paymentTermsDays','active','createdAt','updatedAt'],
  Projects: ['projectId','projectName','customerId','startDate','endDate','status','contractNet','gstAmount','contractTotal','expectedCost','projectManager','createdAt','updatedAt'],
  Items: ['itemId','itemCode','itemName','itemType','revenueAccount','costAccount','defaultRate','taxCode','active','createdAt','updatedAt'],
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
  Loans: ['loanId','lenderName','loanDate','principal','interestRate','contractInterest','expectedSettlement','principalRepaid','interestPaid','principalOutstanding','interestOutstanding','repaymentCondition','sourceDocumentId','status','createdAt','updatedAt','interestMethod','interestFrequency','firstAccrualDate','lastAccruedThrough'],
  LoanEvents: ['loanEventId','loanId','eventType','eventDate','principalAmount','interestAmount','cashAmount','journalId','reference','createdAt'],
  JournalHeaders: ['journalId','postingDate','documentType','documentId','documentNumber','reference','projectId','status','reversalOfJournalId','createdBy','approvedBy','createdAt','postedAt'],
  JournalLines: ['journalLineId','journalId','lineNo','accountId','customerId','supplierId','projectId','debit','credit','taxCode','description','createdAt'],
  PaymentSchedules: ['scheduleId','sourceType','sourceId','projectId','partyId','milestone','dueDate','percentage','amount','status','createdAt','updatedAt'],
  StockMovements: ['movementId','movementDate','itemId','projectId','movementType','qtyIn','qtyOut','unitCost','value','sourceDocumentId','createdAt'],
  FixedAssets: ['assetId','assetName','assetCategory','purchaseDate','supplierId','cost','serialNumber','location','assignedTo','usefulLifeMonths','accumulatedDepreciation','netBookValue','status','sourceDocumentId','createdAt','updatedAt'],
  Budgets: ['budgetId','financialYear','period','accountId','projectId','budgetAmount','actualAmount','variance','createdAt','updatedAt'],
  Exceptions: ['exceptionId','severity','module','recordType','recordId','message','status','assignedTo','createdAt','resolvedAt','resolution'],
  AuditLog: ['auditId','timestamp','actor','action','tableName','recordId','details']
};

function doGet() { return coreJson_({ ok: true, service: 'Easynet Finance Core API', version: CORE_API_VERSION }); }

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    coreRequireToken_(body.token);
    const action = String(body.action || '');
    const payload = body.payload || {};
    if (action === 'health') return coreJson_({ ok: true, version: CORE_API_VERSION });
    if (action === 'bootstrapStatus') return coreJson_(coreBootstrapStatus_());
    if (action === 'list') return coreJson_({ ok: true, rows: coreList_(payload.table, payload.limit, payload.offset) });
    if (action === 'find') return coreJson_({ ok: true, rows: coreFind_(payload.table, payload.filters || {}, payload.limit) });
    if (action === 'append') return coreJson_({ ok: true, row: coreAppend_(payload.table, payload.record || {}) });
    if (action === 'batchAppend') return coreJson_({ ok: true, rows: coreBatchAppend_(payload.table, payload.records || []) });
    if (action === 'update') return coreJson_({ ok: true, row: coreUpdate_(payload.table, payload.idField, payload.idValue, payload.patch || {}) });
    throw new Error('Unsupported Core API action: ' + action);
  } catch (err) {
    return coreJson_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function bootstrapCoreDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Bind this script to the Core ERP spreadsheet.');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  Object.keys(CORE_TABLES).forEach(function(name) { coreEnsureSheet_(ss, name, CORE_TABLES[name]); });
  const token = coreEnsureToken_();
  Logger.log('Core API ready. Spreadsheet ID: ' + ss.getId());
  Logger.log('API token: ' + token);
  return { ok: true, spreadsheetId: ss.getId(), apiToken: token, version: CORE_API_VERSION };
}

function coreSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Core backend is not bootstrapped. Run bootstrapCoreDatabase().');
  return SpreadsheetApp.openById(id);
}

function coreTable_(name) {
  if (!Object.prototype.hasOwnProperty.call(CORE_TABLES, name)) throw new Error('Unknown Core table: ' + name);
  const sheet = coreSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('Missing Core table: ' + name);
  return { sheet: sheet, headers: CORE_TABLES[name] };
}

function coreList_(name, limit, offset) {
  const t = coreTable_(name);
  const lastRow = t.sheet.getLastRow();
  if (lastRow <= 1) return [];
  const start = Math.max(2, 2 + Number(offset || 0));
  if (start > lastRow) return [];
  const count = Math.min(Math.max(1, Number(limit || 100)), lastRow - start + 1, 500);
  return t.sheet.getRange(start, 1, count, t.headers.length).getValues().map(function(row) { return coreRowObject_(t.headers, row); });
}

function coreFind_(name, filters, limit) {
  const rows = coreList_(name, 500, 0);
  const keys = Object.keys(filters || {});
  return rows.filter(function(row) {
    return keys.every(function(key) { return String(row[key] == null ? '' : row[key]) === String(filters[key] == null ? '' : filters[key]); });
  }).slice(0, Math.min(Number(limit || 100), 500));
}

function coreAppend_(name, record) {
  const t = coreTable_(name);
  const now = new Date().toISOString();
  const normalized = Object.assign({}, record);
  if (t.headers.indexOf('createdAt') >= 0 && !normalized.createdAt) normalized.createdAt = now;
  if (t.headers.indexOf('updatedAt') >= 0) normalized.updatedAt = now;
  const row = t.headers.map(function(h) { return normalized[h] == null ? '' : normalized[h]; });
  t.sheet.appendRow(row);
  return coreRowObject_(t.headers, row);
}

function coreBatchAppend_(name, records) {
  if (!Array.isArray(records) || !records.length) return [];
  const t = coreTable_(name);
  const now = new Date().toISOString();
  const rows = records.map(function(record) {
    const normalized = Object.assign({}, record);
    if (t.headers.indexOf('createdAt') >= 0 && !normalized.createdAt) normalized.createdAt = now;
    if (t.headers.indexOf('updatedAt') >= 0) normalized.updatedAt = now;
    return t.headers.map(function(h) { return normalized[h] == null ? '' : normalized[h]; });
  });
  t.sheet.getRange(t.sheet.getLastRow() + 1, 1, rows.length, t.headers.length).setValues(rows);
  return rows.map(function(row) { return coreRowObject_(t.headers, row); });
}

function coreUpdate_(name, idField, idValue, patch) {
  const t = coreTable_(name);
  const idIndex = t.headers.indexOf(String(idField || ''));
  if (idIndex < 0) throw new Error('Invalid idField for ' + name + ': ' + idField);
  const lastRow = t.sheet.getLastRow();
  if (lastRow <= 1) throw new Error('Record not found');
  const values = t.sheet.getRange(2, 1, lastRow - 1, t.headers.length).getValues();
  const match = values.findIndex(function(row) { return String(row[idIndex]) === String(idValue); });
  if (match < 0) throw new Error('Record not found: ' + idValue);
  const current = coreRowObject_(t.headers, values[match]);
  const next = Object.assign({}, current, patch);
  if (t.headers.indexOf('updatedAt') >= 0) next.updatedAt = new Date().toISOString();
  const row = t.headers.map(function(h) { return next[h] == null ? '' : next[h]; });
  t.sheet.getRange(match + 2, 1, 1, t.headers.length).setValues([row]);
  return coreRowObject_(t.headers, row);
}

function coreBootstrapStatus_() {
  const ss = coreSpreadsheet_();
  const missing = Object.keys(CORE_TABLES).filter(function(name) { return !ss.getSheetByName(name); });
  return { ok: missing.length === 0, version: CORE_API_VERSION, missingSheets: missing };
}

function coreEnsureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
}

function coreRowObject_(headers, row) {
  const obj = {};
  headers.forEach(function(h, i) { obj[h] = row[i]; });
  return obj;
}

function coreEnsureToken_() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('API_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('API_TOKEN', token);
  }
  return token;
}

function coreRequireToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!expected || !token || String(token) !== String(expected)) throw new Error('Unauthorized');
}

function coreJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
