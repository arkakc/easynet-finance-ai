const CORE_API_VERSION = '0.4.2';

const CORE_TABLES = {
  Settings: ['key','value','notes','updatedAt'],
  Accounts: ['accountId','accountCode','accountName','accountType','parentAccount','active','createdAt','updatedAt'],
  Customers: ['customerId','customerName','contactPerson','phone','email','address','taxId','creditTermsDays','creditLimit','active','createdAt','updatedAt'],
  Suppliers: ['supplierId','supplierName','contactPerson','phone','email','address','taxId','paymentTermsDays','active','createdAt','updatedAt'],
  Projects: ['projectId','projectName','customerId','startDate','endDate','status','contractNet','gstAmount','contractTotal','expectedCost','projectManager','createdAt','updatedAt'],
  Items: ['itemId','itemCode','itemName','itemType','revenueAccount','costAccount','defaultRate','taxCode','active','createdAt','updatedAt','uom'],
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
    if (action === 'append') {
      coreAssertGenericMutationAllowed_(payload.table);
      return coreJson_({ ok: true, row: coreAppend_(payload.table, payload.record || {}, payload.actor || 'system') });
    }
    if (action === 'batchAppend') {
      coreAssertGenericMutationAllowed_(payload.table);
      return coreJson_({ ok: true, rows: coreBatchAppend_(payload.table, payload.records || [], payload.actor || 'system') });
    }
    if (action === 'update') return coreJson_({ ok: true, row: coreUpdate_(payload.table, payload.idField, payload.idValue, payload.patch || {}, payload.actor || 'system') });
    if (action === 'postJournal') return coreJson_(corePostJournal_(payload));
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

function coreAssertGenericMutationAllowed_(name) {
  if (name === 'JournalHeaders' || name === 'JournalLines' || name === 'AuditLog') {
    throw new Error('Direct append is blocked for immutable accounting/audit tables. Use the dedicated journal posting action.');
  }
}

function coreAppend_(name, record, actor) {
  const rows = coreBatchAppend_(name, [record], actor);
  return rows[0];
}

function coreBatchAppend_(name, records, actor) {
  if (!Array.isArray(records) || !records.length) return [];
  if (records.length > 200) throw new Error('Maximum batch size is 200 records');
  const t = coreTable_(name);
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
    return t.headers.map(function(h) { return coreSafeCell_(item[h]); });
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
    coreList_(name, 500, 0).forEach(function(row) { existingIds[String(row[idField] || '')] = true; });
    normalized.forEach(function(item) {
      const value = String(item[idField] || '');
      if (existingIds[value]) throw new Error(name + ' record already exists: ' + value);
    });
    t.sheet.getRange(t.sheet.getLastRow() + 1, 1, values.length, t.headers.length).setValues(values);
  } finally {
    lock.releaseLock();
  }
  if (name !== 'AuditLog') {
    normalized.forEach(function(item) {
      coreAudit_('append', name, item[idField], records.length > 1 ? 'Record batch-appended' : 'Record appended', actor || 'system');
    });
  }
  return normalized;
}

function coreUpdate_(name, idField, idValue, patch, actor) {
  const t = coreTable_(name);
  if (name === 'JournalHeaders' || name === 'JournalLines' || name === 'AuditLog') {
    throw new Error('Direct updates are blocked for immutable accounting/audit tables');
  }
  const idIndex = t.headers.indexOf(String(idField || ''));
  if (idIndex < 0) throw new Error('Invalid idField for ' + name + ': ' + idField);
  const lastRow = t.sheet.getLastRow();
  if (lastRow <= 1) throw new Error('Record not found');
  const values = t.sheet.getRange(2, 1, lastRow - 1, t.headers.length).getValues();
  const match = values.findIndex(function(row) { return String(row[idIndex]) === String(idValue); });
  if (match < 0) throw new Error('Record not found: ' + idValue);
  const current = coreRowObject_(t.headers, values[match]);
  const next = Object.assign({}, current, patch || {});
  if (t.headers.indexOf('updatedAt') >= 0) next.updatedAt = new Date().toISOString();
  const row = t.headers.map(function(h) { return coreSafeCell_(next[h]); });
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    t.sheet.getRange(match + 2, 1, 1, t.headers.length).setValues([row]);
  } finally {
    lock.releaseLock();
  }
  coreAudit_('update', name, idValue, 'Record updated', actor || 'system');
  return next;
}

function corePostJournal_(payload) {
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
  const accounts = coreList_('Accounts', 500, 0);
  const parentIds = {};
  const accountMap = {};
  accounts.forEach(function(account) {
    if (account.parentAccount) parentIds[String(account.parentAccount)] = true;
    accountMap[String(account.accountId)] = account;
  });

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

  const headerTable = coreTable_('JournalHeaders');
  const lineTable = coreTable_('JournalLines');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let headerRow = -1;

  try {
    const existingHeaders = coreList_('JournalHeaders', 500, 0);
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
    const headerValues = headerTable.headers.map(function(h) { return coreSafeCell_(header[h]); });

    const normalizedLines = lines.map(function(line, index) {
      const item = Object.assign({}, line);
      if (!item.journalLineId) item.journalLineId = header.journalId + '-' + String(index + 1).padStart(3, '0');
      item.journalId = header.journalId;
      if (!item.lineNo) item.lineNo = index + 1;
      if (!item.createdAt) item.createdAt = now;
      return item;
    });
    const lineValues = normalizedLines.map(function(item) {
      return lineTable.headers.map(function(h) { return coreSafeCell_(item[h]); });
    });

    headerRow = headerTable.sheet.getLastRow() + 1;
    headerTable.sheet.getRange(headerRow, 1, 1, headerTable.headers.length).setValues([headerValues]);
    try {
      lineTable.sheet.getRange(lineTable.sheet.getLastRow() + 1, 1, lineValues.length, lineTable.headers.length).setValues(lineValues);
    } catch (lineError) {
      headerTable.sheet.deleteRow(headerRow);
      headerRow = -1;
      throw lineError;
    }
  } finally {
    lock.releaseLock();
  }

  coreAudit_('post-journal', 'JournalHeaders', header.journalId, 'Balanced posted journal created with ' + lines.length + ' lines', actor);
  return { ok: true, journalId: header.journalId, header: header, lines: lines };
}

function coreAudit_(action, tableName, recordId, details, actor) {
  try {
    const t = coreTable_('AuditLog');
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

function coreSafeCell_(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' && /^[=+\-@]/.test(value)) return "'" + value;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function coreBootstrapStatus_() {
  const ss = coreSpreadsheet_();
  const missing = Object.keys(CORE_TABLES).filter(function(name) { return !ss.getSheetByName(name); });
  return { ok: missing.length === 0, version: CORE_API_VERSION, missingSheets: missing };
}

function coreEnsureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const existingColumnCount = Math.max(1, sheet.getLastColumn());
    const existingHeaders = sheet.getRange(1, 1, 1, existingColumnCount).getValues()[0].map(function(value) { return String(value || ''); });
    headers.forEach(function(header, index) {
      if (!existingHeaders[index]) {
        sheet.getRange(1, index + 1).setValue(header);
      } else if (existingHeaders[index] !== header) {
        throw new Error('Core schema mismatch in ' + name + ' column ' + (index + 1) + ': expected ' + header + ', found ' + existingHeaders[index]);
      }
    });
  }

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

/*
 * One-time migration helper for moving Core tables from the legacy all-in-one
 * spreadsheet into the new Core ERP spreadsheet. It is intentionally not
 * exposed through doPost(). Run it manually from the Apps Script editor only.
 */
function migrateCoreFromLegacySpreadsheet(sourceSpreadsheetId, overwriteExisting) {
  if (!sourceSpreadsheetId) throw new Error('sourceSpreadsheetId is required');
  const source = SpreadsheetApp.openById(String(sourceSpreadsheetId));
  const target = coreSpreadsheet_();
  if (source.getId() === target.getId()) throw new Error('Source and target spreadsheet cannot be the same');

  const allowOverwrite = overwriteExisting === true;
  const report = { copied: {}, skippedMissing: [], skippedNonEmpty: [], headerIssues: [] };

  Object.keys(CORE_TABLES).forEach(function(name) {
    const expected = CORE_TABLES[name];
    const sourceSheet = source.getSheetByName(name);
    if (!sourceSheet) {
      report.skippedMissing.push(name);
      return;
    }

    const sourceLastRow = sourceSheet.getLastRow();
    const sourceLastCol = sourceSheet.getLastColumn();
    if (sourceLastCol === 0) {
      report.skippedMissing.push(name);
      return;
    }

    const sourceHeaders = sourceSheet.getRange(1, 1, 1, sourceLastCol).getValues()[0].map(function(v) { return String(v || ''); });
    const sourceIndex = {};
    sourceHeaders.forEach(function(h, i) { if (h) sourceIndex[h] = i; });
    const missingHeaders = expected.filter(function(h) { return sourceIndex[h] == null; });
    if (missingHeaders.length) {
      report.headerIssues.push({ table: name, missingHeaders: missingHeaders });
      return;
    }

    const targetSheet = target.getSheetByName(name) || target.insertSheet(name);
    coreEnsureSheet_(target, name, expected);
    if (targetSheet.getLastRow() > 1 && !allowOverwrite) {
      report.skippedNonEmpty.push(name);
      return;
    }

    const sourceRows = sourceLastRow > 1
      ? sourceSheet.getRange(2, 1, sourceLastRow - 1, sourceLastCol).getValues()
      : [];
    const mappedRows = sourceRows.map(function(row) {
      return expected.map(function(h) { return row[sourceIndex[h]]; });
    });

    if (allowOverwrite && targetSheet.getLastRow() > 1) {
      targetSheet.getRange(2, 1, targetSheet.getLastRow() - 1, Math.max(targetSheet.getLastColumn(), expected.length)).clearContent();
    }
    if (mappedRows.length) {
      targetSheet.getRange(2, 1, mappedRows.length, expected.length).setValues(mappedRows);
    }
    report.copied[name] = mappedRows.length;
  });

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

function verifyCoreMigrationAgainstLegacy(sourceSpreadsheetId) {
  if (!sourceSpreadsheetId) throw new Error('sourceSpreadsheetId is required');
  const source = SpreadsheetApp.openById(String(sourceSpreadsheetId));
  const target = coreSpreadsheet_();
  const report = {};

  Object.keys(CORE_TABLES).forEach(function(name) {
    const sourceSheet = source.getSheetByName(name);
    const targetSheet = target.getSheetByName(name);
    const sourceRows = sourceSheet ? Math.max(0, sourceSheet.getLastRow() - 1) : null;
    const targetRows = targetSheet ? Math.max(0, targetSheet.getLastRow() - 1) : null;
    report[name] = {
      sourceRows: sourceRows,
      targetRows: targetRows,
      match: sourceRows === null ? null : sourceRows === targetRows
    };
  });

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}
