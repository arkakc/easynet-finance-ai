const DOCUMENT_API_VERSION = '0.4.0';
const DOCUMENT_DRIVE_ROOT_NAME = 'Easynet Finance Source Documents';

const DOCUMENT_TABLES = {
  Documents: ['documentId','sourceFileName','driveFileId','driveUrl','sha256','documentType','documentNumber','partyType','partyId','projectId','documentDate','netAmount','gstAmount','totalAmount','currency','aiConfidence','status','uploadedBy','createdAt','updatedAt'],
  DocumentLines: ['documentLineId','documentId','lineNo','itemId','description','qty','uom','rate','netAmount','gstAmount','totalAmount','createdAt']
};

function doGet() { return documentJson_({ ok: true, service: 'Easynet Finance Document API', version: DOCUMENT_API_VERSION }); }

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    documentRequireToken_(body.token);
    const action = String(body.action || '');
    const payload = body.payload || {};
    if (action === 'health') return documentJson_({ ok: true, version: DOCUMENT_API_VERSION });
    if (action === 'bootstrapStatus') return documentJson_(documentBootstrapStatus_());
    if (action === 'list') return documentJson_({ ok: true, rows: documentList_(payload.table, payload.limit, payload.offset) });
    if (action === 'find') return documentJson_({ ok: true, rows: documentFind_(payload.table, payload.filters || {}, payload.limit) });
    if (action === 'append') return documentJson_({ ok: true, row: documentAppend_(payload.table, payload.record || {}) });
    if (action === 'batchAppend') return documentJson_({ ok: true, rows: documentBatchAppend_(payload.table, payload.records || []) });
    if (action === 'update') return documentJson_({ ok: true, row: documentUpdate_(payload.table, payload.idField, payload.idValue, payload.patch || {}) });
    if (action === 'uploadSource') return documentJson_(documentUploadSource_(payload));
    if (action === 'deleteSource') return documentJson_(documentDeleteSource_(payload));
    throw new Error('Unsupported Document API action: ' + action);
  } catch (err) {
    return documentJson_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function bootstrapDocumentDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Bind this script to the Document Index spreadsheet.');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());
  Object.keys(DOCUMENT_TABLES).forEach(function(name) { documentEnsureSheet_(ss, name, DOCUMENT_TABLES[name]); });
  const folderId = documentConfigureDriveRoot_();
  const token = documentEnsureToken_();
  Logger.log('Document API ready. Spreadsheet ID: ' + ss.getId());
  Logger.log('Drive root folder ID: ' + folderId);
  Logger.log('API token: ' + token);
  return { ok: true, spreadsheetId: ss.getId(), driveRootFolderId: folderId, apiToken: token, version: DOCUMENT_API_VERSION };
}

function documentSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Document backend is not bootstrapped. Run bootstrapDocumentDatabase().');
  return SpreadsheetApp.openById(id);
}

function documentTable_(name) {
  if (!Object.prototype.hasOwnProperty.call(DOCUMENT_TABLES, name)) throw new Error('Unknown Document table: ' + name);
  const sheet = documentSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('Missing Document table: ' + name);
  return { sheet: sheet, headers: DOCUMENT_TABLES[name] };
}

function documentList_(name, limit, offset) {
  const t = documentTable_(name);
  const lastRow = t.sheet.getLastRow();
  if (lastRow <= 1) return [];
  const start = Math.max(2, 2 + Number(offset || 0));
  if (start > lastRow) return [];
  const count = Math.min(Math.max(1, Number(limit || 100)), lastRow - start + 1, 500);
  return t.sheet.getRange(start, 1, count, t.headers.length).getValues().map(function(row) { return documentRowObject_(t.headers, row); });
}

function documentFind_(name, filters, limit) {
  const rows = documentList_(name, 500, 0);
  const keys = Object.keys(filters || {});
  return rows.filter(function(row) {
    return keys.every(function(key) { return String(row[key] == null ? '' : row[key]) === String(filters[key] == null ? '' : filters[key]); });
  }).slice(0, Math.min(Number(limit || 100), 500));
}

function documentAppend_(name, record) {
  const t = documentTable_(name);
  const now = new Date().toISOString();
  const next = Object.assign({}, record);
  if (t.headers.indexOf('createdAt') >= 0 && !next.createdAt) next.createdAt = now;
  if (t.headers.indexOf('updatedAt') >= 0) next.updatedAt = now;
  const row = t.headers.map(function(h) { return next[h] == null ? '' : next[h]; });
  t.sheet.appendRow(row);
  return documentRowObject_(t.headers, row);
}

function documentBatchAppend_(name, records) {
  if (!Array.isArray(records) || !records.length) return [];
  const t = documentTable_(name);
  const now = new Date().toISOString();
  const rows = records.map(function(record) {
    const next = Object.assign({}, record);
    if (t.headers.indexOf('createdAt') >= 0 && !next.createdAt) next.createdAt = now;
    if (t.headers.indexOf('updatedAt') >= 0) next.updatedAt = now;
    return t.headers.map(function(h) { return next[h] == null ? '' : next[h]; });
  });
  t.sheet.getRange(t.sheet.getLastRow() + 1, 1, rows.length, t.headers.length).setValues(rows);
  return rows.map(function(row) { return documentRowObject_(t.headers, row); });
}

function documentUpdate_(name, idField, idValue, patch) {
  const t = documentTable_(name);
  const idIndex = t.headers.indexOf(String(idField || ''));
  if (idIndex < 0) throw new Error('Invalid idField for ' + name + ': ' + idField);
  const lastRow = t.sheet.getLastRow();
  if (lastRow <= 1) throw new Error('Record not found');
  const values = t.sheet.getRange(2, 1, lastRow - 1, t.headers.length).getValues();
  const match = values.findIndex(function(row) { return String(row[idIndex]) === String(idValue); });
  if (match < 0) throw new Error('Record not found: ' + idValue);
  const current = documentRowObject_(t.headers, values[match]);
  const next = Object.assign({}, current, patch);
  if (t.headers.indexOf('updatedAt') >= 0) next.updatedAt = new Date().toISOString();
  const row = t.headers.map(function(h) { return next[h] == null ? '' : next[h]; });
  t.sheet.getRange(match + 2, 1, 1, t.headers.length).setValues([row]);
  return documentRowObject_(t.headers, row);
}

function documentUploadSource_(payload) {
  const fileName = String(payload.fileName || '').trim();
  const mimeType = String(payload.mimeType || 'application/octet-stream').trim();
  const base64 = String(payload.base64 || '');
  const sha256 = String(payload.sha256 || '').trim();
  const documentId = String(payload.documentId || '').trim();
  if (!fileName || !base64 || !sha256) throw new Error('fileName, base64 and sha256 are required');

  const rootId = PropertiesService.getScriptProperties().getProperty('DRIVE_ROOT_FOLDER_ID');
  if (!rootId) throw new Error('Drive root is not configured. Run bootstrapDocumentDatabase().');
  const root = DriveApp.getFolderById(rootId);
  const dateFolder = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Pacific/Port_Moresby', 'yyyy-MM');
  const monthFolder = documentGetOrCreateSubfolder_(root, dateFolder);
  const safeName = documentSanitizeFileName_((documentId ? documentId + ' - ' : '') + fileName);
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, safeName);
  const file = monthFolder.createFile(blob);
  file.setDescription('Easynet Finance AI source | SHA-256: ' + sha256 + (documentId ? ' | ' + documentId : ''));
  return { ok: true, driveFileId: file.getId(), driveUrl: file.getUrl(), sha256: sha256 };
}

function documentDeleteSource_(payload) {
  const driveFileId = String(payload.driveFileId || '').trim();
  if (!driveFileId) throw new Error('driveFileId is required');
  const file = DriveApp.getFileById(driveFileId);
  file.setTrashed(true);
  return { ok: true, driveFileId: driveFileId, trashed: true };
}

function documentBootstrapStatus_() {
  const ss = documentSpreadsheet_();
  const missing = Object.keys(DOCUMENT_TABLES).filter(function(name) { return !ss.getSheetByName(name); });
  const folderId = PropertiesService.getScriptProperties().getProperty('DRIVE_ROOT_FOLDER_ID') || '';
  return { ok: missing.length === 0 && Boolean(folderId), version: DOCUMENT_API_VERSION, missingSheets: missing, hasDriveRoot: Boolean(folderId) };
}

function documentConfigureDriveRoot_() {
  const props = PropertiesService.getScriptProperties();
  const configured = props.getProperty('DRIVE_ROOT_FOLDER_ID');
  if (configured) {
    try {
      const existing = DriveApp.getFolderById(configured);
      if (existing && !existing.isTrashed()) return existing.getId();
    } catch (e) {}
  }
  const iterator = DriveApp.getFoldersByName(DOCUMENT_DRIVE_ROOT_NAME);
  let folder;
  if (iterator.hasNext()) folder = iterator.next();
  else folder = DriveApp.createFolder(DOCUMENT_DRIVE_ROOT_NAME);
  props.setProperty('DRIVE_ROOT_FOLDER_ID', folder.getId());
  return folder.getId();
}

function documentGetOrCreateSubfolder_(parent, name) {
  const iterator = parent.getFoldersByName(name);
  return iterator.hasNext() ? iterator.next() : parent.createFolder(name);
}

function documentSanitizeFileName_(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 180);
}

function documentEnsureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
}

function documentRowObject_(headers, row) {
  const obj = {};
  headers.forEach(function(h, i) { obj[h] = row[i]; });
  return obj;
}

function migrateDocumentsFromLegacySpreadsheet(sourceSpreadsheetId, overwriteExisting) {
  if (!sourceSpreadsheetId) throw new Error('sourceSpreadsheetId is required');
  const source = SpreadsheetApp.openById(String(sourceSpreadsheetId));
  const target = documentSpreadsheet_();
  if (source.getId() === target.getId()) throw new Error('Source and target spreadsheet cannot be the same');

  const allowOverwrite = overwriteExisting === true;
  const report = { copied: {}, skippedMissing: [], skippedNonEmpty: [], headerIssues: [] };

  Object.keys(DOCUMENT_TABLES).forEach(function(name) {
    const expected = DOCUMENT_TABLES[name];
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
    documentEnsureSheet_(target, name, expected);
    if (targetSheet.getLastRow() > 1 && !allowOverwrite) {
      report.skippedNonEmpty.push(name);
      return;
    }

    const sourceRows = sourceLastRow > 1 ? sourceSheet.getRange(2, 1, sourceLastRow - 1, sourceLastCol).getValues() : [];
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

function verifyDocumentMigrationAgainstLegacy(sourceSpreadsheetId) {
  if (!sourceSpreadsheetId) throw new Error('sourceSpreadsheetId is required');
  const source = SpreadsheetApp.openById(String(sourceSpreadsheetId));
  const target = documentSpreadsheet_();
  const report = {};

  Object.keys(DOCUMENT_TABLES).forEach(function(name) {
    const sourceSheet = source.getSheetByName(name);
    const targetSheet = target.getSheetByName(name);
    const sourceRows = sourceSheet ? Math.max(0, sourceSheet.getLastRow() - 1) : null;
    const targetRows = targetSheet ? Math.max(0, targetSheet.getLastRow() - 1) : null;
    report[name] = {
      sourceRows: sourceRows,
      targetRows: targetRows,
      match: sourceRows === targetRows
    };
  });

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

function documentEnsureToken_() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('API_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('API_TOKEN', token);
  }
  return token;
}

function documentRequireToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!expected || !token || String(token) !== String(expected)) throw new Error('Unauthorized');
}

function documentJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
