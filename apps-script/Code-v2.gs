const APP_VERSION = '0.2.1';
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
    if (action === 'append') {
      assertGenericMutationAllowed_(payload.table);
      return json_({ ok: true, row: appendRecord_(payload.table, payload.record || {}, payload.actor || 'system') });
    }
    if (action === 'update') return json_({ ok: true, row: updateRecord_(payload.table, payload.idField, payload.idValue, payload.patch || {}, payload.actor || 'system') });
    if (action === 'batchAppend') {
      assertGenericMutationAllowed_(payload.table);
      return json_({ ok: true, rows: batchAppend_(payload.table, payload.records || [], payload.actor || 'system') });
    }
    if (action === 'postJournal') return json_(postJournal_(payload));
    if (action === 'uploadSource') return json_(uploadSource_(payload));
    if (action === 'deleteSource') return json_(deleteSource_(payload));

    throw new Error('Unsupported action: ' + action);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function bootstrapDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('This Apps Script must be bound to Easynet Finance AI DB.');

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

  audit_('bootstrap', 'Database', '', 'Database schema bootstrapped', 'bootstrap');
  Logger.log('Bootstrap complete. API token: ' + token);
  Logger.log('Keep this token secret. Store it only in Vercel Environment Variables.');
  return { ok: true, spreadsheetId: ss.getId(), apiToken: token, version: APP_VERSION };
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
  const props = PropertiesService.getScriptProperties();
  const configured = props.getProperty('DRIVE_ROOT_FOLDER_ID');
  if (configured) {
    try {
      const existing = DriveApp.getFolderById(configured);
      if (existing && !existing.isTrashed()) return existing.getId();
    } catch (e) {
      // Fall through to a controlled name lookup.
    }
  }

  const iterator = DriveApp.getFoldersByName(DRIVE_ROOT_NAME);
  if (!iterator.hasNext()) throw new Error('Google Drive folder not found: ' + DRIVE_ROOT_NAME);
  const folder = iterator.next();
  if (iterator.hasNext()) {
    throw new Error('Multiple Google Drive folders named "' + DRIVE_ROOT_NAME + '" were found. Remove/rename duplicates, then run bootstrapDatabase() again.');
  }
  props.setProperty('DRIVE_ROOT_FOLDER_ID', folder.getId());
  return folder.getId();
}

function uploadSource_(payload) {
  const fileName = String(payload.fileName || '').trim();
  const mimeType = String(payload.mimeType || 'application/octet-stream').trim();
  const base64 = String(payload.base64 || '');
  const sha256 = String(payload.sha256 || '').trim();
  const documentId = String(payload.documentId || '').trim();
  if (!fileName || !base64 || !sha256) throw new Error('fileName, base64 and sha256 are required');

  const props = PropertiesService.getScriptProperties();
  const rootId = props.getProperty('DRIVE_ROOT_FOLDER_ID');
  if (!rootId) throw new Error('Drive root is not configured. Run bootstrapDatabase().');
  const root = DriveApp.getFolderById(rootId);

  const dateFolder = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Pacific/Port_Moresby', 'yyyy-MM');
  const monthFolder = getOrCreateSubfolder_(root, dateFolder);
  const safeName = sanitizeFileName_((documentId ? documentId + ' - ' : '') + fileName);
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, safeName);
  const file = monthFolder.createFile(blob);
  file.setDescription('Easynet Finance AI source | SHA-256: ' + sha256 + (documentId ? ' | ' + documentId : ''));

  audit_('upload-source', 'Drive', documentId || file.getId(), 'Source document retained: ' + safeName, 'document-upload');
  return { ok: true, driveFileId: file.getId(), driveUrl: file.getUrl(), sha256: sha256 };
}

function getOrCreateSubfolder_(parent, name) {
  const iterator = parent.getFoldersByName(name);
  return iterator.hasNext() ? iterator.next() : parent.createFolder(name);
}

function sanitizeFileName_(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 180);
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
  const missing = [];
  const headerIssues = [];
  Object.keys(TABLES).forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) {
      missing.push(name);
      return;
    }
    const expected = TABLES[name];
    const lastColumn = sheet.getLastColumn();
    const current = lastColumn > 0 ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function(value) { return String(value || ''); }) : [];
    if (current.length !== expected.length || expected.some(function(header, index) { return current[index] !== header; })) {
      headerIssues.push(name);
    }
  });
  return { ok: missing.length === 0 && headerIssues.length === 0, version: APP_VERSION, missingSheets: missing, headerIssues: headerIssues };
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Backend is not bootstrapped. Run bootstrapDatabase() first.');
  return SpreadsheetApp.openById(id);
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow === 0 || lastColumn === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const current = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function(value) { return String(value || ''); });
    const prefixMatches = current.every(function(header, index) { return headers[index] === header; });

    if (!prefixMatches || current.length > headers.length) {
      if (lastRow > 1) throw new Error('Header mismatch on non-empty sheet: ' + name);
      sheet.clear();
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else if (current.length < headers.length) {
      const missing = headers.slice(current.length);
      sheet.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
    }
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
  const count = Math.min(Math.max(1, Number(limit || 100)), lastRow - start + 1, 500);
  const values = t.sheet.getRange(start, 1, count, t.headers.length).getValues();
  return values.map(function(row) { return rowToObject_(t.headers, row); });
}

function findRows_(name, filters, limit) {
  const rows = listRows_(name, 500, 0);
  const keys = Object.keys(filters || {});
  return rows.filter(function(row) {
    return keys.every(function(key) {
      return String(row[key] == null ? '' : row[key]) === String(filters[key] == null ? '' : filters[key]);
    });
  }).slice(0, Math.min(Number(limit || 100), 500));
}


function assertGenericMutationAllowed_(name) {
  if (name === 'JournalHeaders' || name === 'JournalLines' || name === 'AuditLog') {
    throw new Error('Direct append is blocked for immutable accounting/audit tables. Use the dedicated journal posting action.');
  }
}

function postJournal_(payload) {
  const header = Object.assign({}, payload.header || {});
  const lines = Array.isArray(payload.lines) ? payload.lines.map(function(line) { return Object.assign({}, line || {}); }) : [];
  const actor = String(payload.actor || header.createdBy || 'finance-ui');

  if (!header.journalId) throw new Error('journalId is required');
  if (!header.documentType || !header.documentId) throw new Error('Journal documentType and documentId are required');
  if (String(header.status || '').toUpperCase() !== 'POSTED') throw new Error('Journal status must be POSTED');
  if (lines.length < 2) throw new Error('A posted journal requires at least two lines');
  if (lines.length > 200) throw new Error('Maximum journal line count is 200');

  let totalDebit = 0;
  let totalCredit = 0;
  const accounts = listRows_('Accounts', 500, 0);
  const parentIds = {};
  accounts.forEach(function(account) {
    if (account.parentAccount) parentIds[String(account.parentAccount)] = true;
  });
  const accountMap = {};
  accounts.forEach(function(account) { accountMap[String(account.accountId)] = account; });

  lines.forEach(function(line, index) {
    const debit = Number(line.debit || 0);
    const credit = Number(line.credit || 0);
    if (!isFinite(debit) || !isFinite(credit) || debit < 0 || credit < 0) throw new Error('Invalid debit/credit on journal line ' + (index + 1));
    if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) throw new Error('Each journal line must contain exactly one debit or credit amount');
    const account = accountMap[String(line.accountId || '')];
    if (!account || String(account.active).toLowerCase() === 'false') throw new Error('Missing or inactive account: ' + String(line.accountId || ''));
    if (parentIds[String(line.accountId || '')]) throw new Error('Posting to parent/control account is blocked: ' + String(line.accountId || ''));
    totalDebit += debit;
    totalCredit += credit;
  });

  totalDebit = Math.round((totalDebit + Number.EPSILON) * 100) / 100;
  totalCredit = Math.round((totalCredit + Number.EPSILON) * 100) / 100;
  if (totalDebit !== totalCredit) throw new Error('Journal is not balanced: debit ' + totalDebit.toFixed(2) + ' vs credit ' + totalCredit.toFixed(2));

  const headerTable = table_('JournalHeaders');
  const lineTable = table_('JournalLines');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let headerRow = -1;

  try {
    const existingHeaders = listRows_('JournalHeaders', 500, 0);
    if (existingHeaders.some(function(row) { return String(row.journalId) === String(header.journalId); })) {
      throw new Error('Journal ID already exists: ' + header.journalId);
    }
    if (existingHeaders.some(function(row) {
      return String(row.status).toUpperCase() === 'POSTED' &&
        String(row.documentType) === String(header.documentType) &&
        String(row.documentId) === String(header.documentId);
    })) {
      throw new Error('This document already has a posted journal');
    }

    const now = new Date().toISOString();
    if (!header.createdAt) header.createdAt = now;
    if (!header.postedAt) header.postedAt = now;
    if (!header.createdBy) header.createdBy = actor;
    const headerValues = headerTable.headers.map(function(h) { return safeCell_(header[h]); });

    const normalizedLines = lines.map(function(line, index) {
      const item = Object.assign({}, line);
      if (!item.journalLineId) item.journalLineId = header.journalId + '-' + String(index + 1).padStart(3, '0');
      item.journalId = header.journalId;
      if (!item.lineNo) item.lineNo = index + 1;
      if (!item.createdAt) item.createdAt = now;
      return item;
    });
    const lineValues = normalizedLines.map(function(item) {
      return lineTable.headers.map(function(h) { return safeCell_(item[h]); });
    });

    headerRow = headerTable.sheet.getLastRow() + 1;
    headerTable.sheet.getRange(headerRow, 1, 1, headerTable.headers.length).setValues([headerValues]);
    try {
      const lineStart = lineTable.sheet.getLastRow() + 1;
      lineTable.sheet.getRange(lineStart, 1, lineValues.length, lineTable.headers.length).setValues(lineValues);
    } catch (lineError) {
      headerTable.sheet.deleteRow(headerRow);
      headerRow = -1;
      throw lineError;
    }
  } finally {
    lock.releaseLock();
  }

  audit_('post-journal', 'JournalHeaders', header.journalId, 'Balanced posted journal created with ' + lines.length + ' lines', actor);
  return { ok: true, journalId: header.journalId, header: header, lines: lines };
}

function deleteSource_(payload) {
  const fileId = String(payload.driveFileId || '').trim();
  const reason = String(payload.reason || 'rollback');
  if (!fileId) throw new Error('driveFileId is required');

  const rootId = PropertiesService.getScriptProperties().getProperty('DRIVE_ROOT_FOLDER_ID');
  if (!rootId) throw new Error('Drive root is not configured');
  const file = DriveApp.getFileById(fileId);
  let allowed = false;
  let parents = file.getParents();
  while (parents.hasNext() && !allowed) {
    let folder = parents.next();
    for (let depth = 0; depth < 4 && folder; depth++) {
      if (String(folder.getId()) === String(rootId)) {
        allowed = true;
        break;
      }
      const upper = folder.getParents();
      folder = upper.hasNext() ? upper.next() : null;
    }
  }
  if (!allowed) throw new Error('Refusing to trash a file outside the configured finance source folder');

  file.setTrashed(true);
  audit_('delete-source', 'Drive', fileId, 'Source file moved to trash: ' + reason, 'document-upload');
  return { ok: true, driveFileId: fileId, trashed: true };
}

function appendRecord_(name, record, actor) {
  const rows = batchAppend_(name, [record], actor);
  return rows[0];
}

function batchAppend_(name, records, actor) {
  if (!Array.isArray(records) || records.length === 0) return [];
  if (records.length > 200) throw new Error('Maximum batch size is 200 records');

  const t = table_(name);
  const now = new Date().toISOString();
  const idField = t.headers[0];
  const normalized = records.map(function(record) {
    const item = Object.assign({}, record || {});
    if (!item[idField]) item[idField] = Utilities.getUuid();
    if (t.headers.indexOf('createdAt') >= 0 && !item.createdAt) item.createdAt = now;
    if (t.headers.indexOf('updatedAt') >= 0) item.updatedAt = now;
    return item;
  });
  const values = normalized.map(function(item) {
    return t.headers.map(function(h) { return safeCell_(item[h]); });
  });

  const batchIds = {};
  normalized.forEach(function(item) {
    const value = String(item[idField] || '');
    if (batchIds[value]) throw new Error('Duplicate ' + idField + ' in append batch: ' + value);
    batchIds[value] = true;
  });
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const existingIds = {};
    listRows_(name, 500, 0).forEach(function(row) { existingIds[String(row[idField] || '')] = true; });
    normalized.forEach(function(item) {
      const value = String(item[idField] || '');
      if (existingIds[value]) throw new Error(name + ' record already exists: ' + value);
    });
    const startRow = t.sheet.getLastRow() + 1;
    t.sheet.getRange(startRow, 1, values.length, t.headers.length).setValues(values);
  } finally {
    lock.releaseLock();
  }

  if (name !== 'AuditLog') {
    normalized.forEach(function(item) {
      audit_('append', name, item[idField], records.length > 1 ? 'Record batch-appended' : 'Record appended', actor);
    });
  }
  return normalized;
}

function updateRecord_(name, idField, idValue, patch, actor) {
  const t = table_(name);
  if (name === 'JournalHeaders' || name === 'JournalLines' || name === 'AuditLog') {
    throw new Error('Direct updates are blocked for immutable accounting/audit tables');
  }
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

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    t.sheet.getRange(target, 1, 1, t.headers.length).setValues([row]);
  } finally {
    lock.releaseLock();
  }
  audit_('update', name, idValue, 'Record updated', actor);
  return merged;
}

function setSetting_(key, value, notes) {
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

/**
 * Public wrapper for schema/bootstrap health checks from the Apps Script editor.
 */
function bootstrapStatus() {
  var result = bootstrapStatus_();
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}
