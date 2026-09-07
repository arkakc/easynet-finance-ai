/*
 * EASYNET FINANCE AI — Fresh Start Reset v0.5
 *
 * PURPOSE
 *   Wipe UAT / data-entry / accounting transactions and return the system to a
 *   true zero-data state WITHOUT deleting the Chart of Accounts, Settings,
 *   API tokens, Apps Script triggers, or deployed backend configuration.
 *
 * IMPORTANT
 *   This is intentionally destructive. Run only in the intended UAT/fresh-start
 *   backends. It clears rows below each header and preserves the sheet schema.
 *
 * RUN ORDER
 *   1) Core project:       freshStartResetCoreDataV05()
 *   2) Document project:   freshStartResetDocumentDataV05()
 *   3) Reporting project:  freshStartResetReportingDataV05()
 *   4) Legacy project:     freshStartResetLegacyDataV05()   (only if legacy fallback is still configured)
 *
 * The Document reset also trashes files/subfolders INSIDE the configured
 * Easynet Finance document root folder. The root folder itself is preserved.
 */

const FRESH_V05_CORE_CLEAR_TABLES = [
  'Customers','Suppliers','Projects','Items',
  'Quotes','QuoteLines','PurchaseOrders','POLines',
  'Invoices','InvoiceLines','SupplierBills','SupplierBillLines',
  'Payments','Expenses','Loans','LoanEvents',
  'JournalHeaders','JournalLines','PaymentSchedules','StockMovements',
  'FixedAssets','Budgets','Exceptions','AuditLog'
];

const FRESH_V05_DOCUMENT_CLEAR_TABLES = ['Documents','DocumentLines'];

const FRESH_V05_REPORTING_CLEAR_TABLES = [
  'ReportDashboardKPI','ReportDailySales','ReportDailyPurchases',
  'ReportARSummary','ReportAPSummary','ReportGSTSummary',
  'ReportProjectProfitability'
];

const FRESH_V05_LEGACY_CLEAR_TABLES = FRESH_V05_CORE_CLEAR_TABLES.concat([
  'Documents','DocumentLines',
  'ReportDashboardKPI','ReportDailySales','ReportDailyPurchases',
  'ReportARSummary','ReportAPSummary','ReportGSTSummary','ReportProjectProfitability'
]);

function freshStartResetCoreDataV05() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Run freshStartResetCoreDataV05() from the Core ERP spreadsheet Apps Script project.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let before;
  try {
    before = freshV05Counts_(ss, FRESH_V05_CORE_CLEAR_TABLES);
    freshV05ClearTables_(ss, FRESH_V05_CORE_CLEAR_TABLES);
  } finally {
    lock.releaseLock();
  }

  const after = freshV05Counts_(ss, FRESH_V05_CORE_CLEAR_TABLES);
  const accounts = freshV05Count_(ss, 'Accounts');
  const settings = freshV05Count_(ss, 'Settings');
  const nonZero = Object.keys(after).filter(function(name) { return Number(after[name] || 0) !== 0; });

  const result = {
    ok: nonZero.length === 0 && accounts > 0 && settings > 0,
    target: 'core',
    preserved: {
      Accounts: accounts,
      Settings: settings,
      apiToken: true,
      triggers: true,
      schemaHeaders: true
    },
    before: before,
    after: after,
    nonZeroTables: nonZero,
    note: 'All operational, stock, accounting, master-data entry and audit rows cleared. COA and Settings preserved.'
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function freshStartResetDocumentDataV05() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Run freshStartResetDocumentDataV05() from the Document Index spreadsheet Apps Script project.');

  const before = freshV05Counts_(ss, FRESH_V05_DOCUMENT_CLEAR_TABLES);
  let trashedFiles = 0;

  const folderId = PropertiesService.getScriptProperties().getProperty('DRIVE_ROOT_FOLDER_ID');
  if (folderId) {
    const root = DriveApp.getFolderById(folderId);
    trashedFiles = freshV05TrashFolderContents_(root);
  }

  freshV05ClearTables_(ss, FRESH_V05_DOCUMENT_CLEAR_TABLES);
  const after = freshV05Counts_(ss, FRESH_V05_DOCUMENT_CLEAR_TABLES);
  const nonZero = Object.keys(after).filter(function(name) { return Number(after[name] || 0) !== 0; });

  const result = {
    ok: nonZero.length === 0,
    target: 'document',
    before: before,
    after: after,
    trashedDriveFilesAndFolders: trashedFiles,
    driveRootPreserved: Boolean(folderId),
    apiTokenPreserved: true,
    schemaHeadersPreserved: true,
    nonZeroTables: nonZero
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function freshStartResetReportingDataV05() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Run freshStartResetReportingDataV05() from the Reporting spreadsheet Apps Script project.');

  const before = freshV05Counts_(ss, FRESH_V05_REPORTING_CLEAR_TABLES);
  freshV05ClearTables_(ss, FRESH_V05_REPORTING_CLEAR_TABLES);
  const after = freshV05Counts_(ss, FRESH_V05_REPORTING_CLEAR_TABLES);
  const nonZero = Object.keys(after).filter(function(name) { return Number(after[name] || 0) !== 0; });

  const result = {
    ok: nonZero.length === 0,
    target: 'reporting',
    before: before,
    after: after,
    autoRefreshTriggerPreserved: true,
    apiTokenPreserved: true,
    schemaHeadersPreserved: true,
    nonZeroTables: nonZero,
    note: 'The automatic reporting trigger may later repopulate zero-value KPI rows. That is derived reporting data, not user-entered data.'
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function freshStartResetLegacyDataV05() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Run freshStartResetLegacyDataV05() from the legacy all-in-one backend spreadsheet Apps Script project.');

  const existingTables = FRESH_V05_LEGACY_CLEAR_TABLES.filter(function(name) { return Boolean(ss.getSheetByName(name)); });
  const before = freshV05Counts_(ss, existingTables);

  let trashedFiles = 0;
  const folderId = PropertiesService.getScriptProperties().getProperty('DRIVE_ROOT_FOLDER_ID');
  if (folderId) {
    try {
      trashedFiles = freshV05TrashFolderContents_(DriveApp.getFolderById(folderId));
    } catch (error) {
      console.warn('Legacy Drive cleanup warning: ' + String(error && error.message ? error.message : error));
    }
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    freshV05ClearTables_(ss, existingTables);
  } finally {
    lock.releaseLock();
  }

  const after = freshV05Counts_(ss, existingTables);
  const nonZero = Object.keys(after).filter(function(name) { return Number(after[name] || 0) !== 0; });
  const result = {
    ok: nonZero.length === 0,
    target: 'legacy',
    preserved: {
      Accounts: freshV05Count_(ss, 'Accounts'),
      Settings: freshV05Count_(ss, 'Settings'),
      apiToken: true,
      schemaHeaders: true
    },
    before: before,
    after: after,
    trashedDriveFilesAndFolders: trashedFiles,
    nonZeroTables: nonZero,
    note: 'Legacy fallback data cleared so an accidental fallback cannot surface stale UAT transactions.'
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function freshStartVerifyCoreZeroV05() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Run from the Core ERP spreadsheet Apps Script project.');
  const counts = freshV05Counts_(ss, FRESH_V05_CORE_CLEAR_TABLES);
  const nonZero = Object.keys(counts).filter(function(name) { return Number(counts[name] || 0) !== 0; });
  const result = {
    ok: nonZero.length === 0,
    counts: counts,
    nonZeroTables: nonZero,
    accountsPreserved: freshV05Count_(ss, 'Accounts'),
    settingsPreserved: freshV05Count_(ss, 'Settings')
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function freshStartVerifyDocumentZeroV05() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Run from the Document Index spreadsheet Apps Script project.');
  const counts = freshV05Counts_(ss, FRESH_V05_DOCUMENT_CLEAR_TABLES);
  const result = {
    ok: Object.keys(counts).every(function(name) { return Number(counts[name] || 0) === 0; }),
    counts: counts
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function freshStartVerifyReportingZeroV05() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Run from the Reporting spreadsheet Apps Script project.');
  const counts = freshV05Counts_(ss, FRESH_V05_REPORTING_CLEAR_TABLES);
  const result = {
    ok: Object.keys(counts).every(function(name) { return Number(counts[name] || 0) === 0; }),
    counts: counts
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function freshV05ClearTables_(ss, names) {
  names.forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return;
    const lastColumn = Math.max(1, sheet.getLastColumn());
    sheet.getRange(2, 1, lastRow - 1, lastColumn).clearContent();
  });
}

function freshV05Counts_(ss, names) {
  const counts = {};
  names.forEach(function(name) { counts[name] = freshV05Count_(ss, name); });
  return counts;
}

function freshV05Count_(ss, name) {
  const sheet = ss.getSheetByName(name);
  return sheet ? Math.max(0, sheet.getLastRow() - 1) : null;
}

function freshV05TrashFolderContents_(folder) {
  let count = 0;
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (!file.isTrashed()) {
      file.setTrashed(true);
      count += 1;
    }
  }

  const folders = folder.getFolders();
  while (folders.hasNext()) {
    const child = folders.next();
    count += freshV05TrashFolderContents_(child);
    if (!child.isTrashed()) {
      child.setTrashed(true);
      count += 1;
    }
  }
  return count;
}
