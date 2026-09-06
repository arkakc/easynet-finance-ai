const FRESH_START_CORE_TABLES = [
  'Settings','Accounts','Customers','Suppliers','Projects','Items','Quotes','QuoteLines',
  'PurchaseOrders','POLines','Invoices','InvoiceLines','SupplierBills','SupplierBillLines',
  'Payments','Expenses','Loans','LoanEvents','JournalHeaders','JournalLines','PaymentSchedules',
  'StockMovements','FixedAssets','Budgets','Exceptions','AuditLog'
];

const FRESH_START_DOCUMENT_TABLES = ['Documents','DocumentLines'];
const FRESH_START_REPORTING_TABLES = [
  'ReportDashboardKPI','ReportDailySales','ReportDailyPurchases','ReportARSummary',
  'ReportAPSummary','ReportGSTSummary','ReportProjectProfitability'
];

const FRESH_START_COA = [
  ['ACC-1000','1000','Assets','Asset','',true],
  ['ACC-1100','1100','Current Assets','Asset','ACC-1000',true],
  ['ACC-1110','1110','Cash on Hand','Asset','ACC-1100',true],
  ['ACC-1120','1120','Operating Bank Account','Asset','ACC-1100',true],
  ['ACC-1121','1121','Savings / Reserve Bank Account','Asset','ACC-1100',true],
  ['ACC-1130','1130','Accounts Receivable','Asset','ACC-1100',true],
  ['ACC-1140','1140','GST Receivable / Input GST','Asset','ACC-1100',true],
  ['ACC-1150','1150','Inventory / Project Materials','Asset','ACC-1100',true],
  ['ACC-1160','1160','Supplier Advances','Asset','ACC-1100',true],
  ['ACC-1170','1170','Prepaid Expenses','Asset','ACC-1100',true],
  ['ACC-1180','1180','Employee / Staff Advances','Asset','ACC-1100',true],
  ['ACC-1190','1190','Other Current Assets','Asset','ACC-1100',true],
  ['ACC-1200','1200','Non-Current Assets','Asset','ACC-1000',true],
  ['ACC-1210','1210','Computer & ICT Equipment','Asset','ACC-1200',true],
  ['ACC-1220','1220','Office Equipment','Asset','ACC-1200',true],
  ['ACC-1230','1230','Furniture & Fixtures','Asset','ACC-1200',true],
  ['ACC-1240','1240','Motor Vehicles','Asset','ACC-1200',true],
  ['ACC-1290','1290','Accumulated Depreciation','Contra Asset','ACC-1200',true],

  ['ACC-2000','2000','Liabilities','Liability','',true],
  ['ACC-2100','2100','Current Liabilities','Liability','ACC-2000',true],
  ['ACC-2110','2110','Accounts Payable','Liability','ACC-2100',true],
  ['ACC-2120','2120','GST Payable / Output GST','Liability','ACC-2100',true],
  ['ACC-2130','2130','Current Loan Payable','Liability','ACC-2100',true],
  ['ACC-2140','2140','Accrued Interest Payable','Liability','ACC-2100',true],
  ['ACC-2150','2150','Customer Advances / Unearned Revenue','Liability','ACC-2100',true],
  ['ACC-2160','2160','Accrued Expenses','Liability','ACC-2100',true],
  ['ACC-2170','2170','Payroll & Staff Deductions Payable','Liability','ACC-2100',true],
  ['ACC-2180','2180','Other Current Liabilities','Liability','ACC-2100',true],
  ['ACC-2200','2200','Non-Current Liabilities','Liability','ACC-2000',true],
  ['ACC-2210','2210','Long-Term Borrowings','Liability','ACC-2200',true],

  ['ACC-3000','3000','Equity','Equity','',true],
  ['ACC-3100','3100','Share Capital','Equity','ACC-3000',true],
  ['ACC-3200','3200','Retained Earnings','Equity','ACC-3000',true],
  ['ACC-3300','3300','Current Year Earnings','Equity','ACC-3000',true],
  ['ACC-3400','3400','Shareholder / Director Contributions','Equity','ACC-3000',true],

  ['ACC-4000','4000','Revenue','Income','',true],
  ['ACC-4100','4100','ICT Infrastructure Revenue','Income','ACC-4000',true],
  ['ACC-4200','4200','Hardware Sales Revenue','Income','ACC-4000',true],
  ['ACC-4300','4300','Software & Digital Solutions Revenue','Income','ACC-4000',true],
  ['ACC-4400','4400','Managed IT Services Revenue','Income','ACC-4000',true],
  ['ACC-4500','4500','Business Automation / ERP Revenue','Income','ACC-4000',true],
  ['ACC-4600','4600','Consulting & Technical Support Revenue','Income','ACC-4000',true],
  ['ACC-4700','4700','Cloud / Hosting / Subscription Revenue','Income','ACC-4000',true],
  ['ACC-4900','4900','Other Income','Income','ACC-4000',true],

  ['ACC-5000','5000','Cost of Sales','Expense','',true],
  ['ACC-5100','5100','Hardware & Materials Cost','Expense','ACC-5000',true],
  ['ACC-5200','5200','Project Direct Costs','Expense','ACC-5000',true],
  ['ACC-5300','5300','Subcontractor / Consultant Cost','Expense','ACC-5000',true],
  ['ACC-5400','5400','Software / Licence Cost of Sales','Expense','ACC-5000',true],
  ['ACC-5500','5500','Freight & Delivery Cost','Expense','ACC-5000',true],
  ['ACC-5600','5600','Cloud / Hosting Direct Cost','Expense','ACC-5000',true],

  ['ACC-6000','6000','Operating Expenses','Expense','',true],
  ['ACC-6100','6100','Interest Expense','Expense','ACC-6000',true],
  ['ACC-6200','6200','Internet & Communications','Expense','ACC-6000',true],
  ['ACC-6300','6300','Transport & Travel','Expense','ACC-6000',true],
  ['ACC-6400','6400','Marketing & Advertising','Expense','ACC-6000',true],
  ['ACC-6500','6500','Software & Subscriptions','Expense','ACC-6000',true],
  ['ACC-6600','6600','Office & Administration','Expense','ACC-6000',true],
  ['ACC-6610','6610','Rent & Premises','Expense','ACC-6000',true],
  ['ACC-6620','6620','Printing & Stationery','Expense','ACC-6000',true],
  ['ACC-6700','6700','Repairs & Maintenance','Expense','ACC-6000',true],
  ['ACC-6800','6800','Depreciation Expense','Expense','ACC-6000',true],
  ['ACC-6900','6900','Bank Fees & Charges','Expense','ACC-6000',true],
  ['ACC-6910','6910','Professional & Legal Fees','Expense','ACC-6000',true],
  ['ACC-6920','6920','Insurance','Expense','ACC-6000',true],
  ['ACC-6930','6930','Utilities','Expense','ACC-6000',true],
  ['ACC-6940','6940','Salaries & Wages','Expense','ACC-6000',true],
  ['ACC-6950','6950','Staff Benefits & Welfare','Expense','ACC-6000',true],
  ['ACC-6960','6960','Training & Development','Expense','ACC-6000',true],
  ['ACC-6970','6970','Licences, Registrations & Compliance','Expense','ACC-6000',true],
  ['ACC-6980','6980','Bad Debts / Impairment','Expense','ACC-6000',true],
  ['ACC-6990','6990','Other Operating Expenses','Expense','ACC-6000',true]
];

function freshStartResetCoreDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Run this from the Core ERP spreadsheet Apps Script project.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    FRESH_START_CORE_TABLES.forEach(function(name) {
      const sheet = ss.getSheetByName(name);
      if (!sheet) return;
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, Math.max(1, sheet.getLastColumn())).clearContent();
    });

    freshStartSeedSettings_(ss);
    freshStartSeedAccounts_(ss);
  } finally {
    lock.releaseLock();
  }

  const result = freshStartCoreStatus_(ss);
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function freshStartResetDocumentDatabase(deleteDriveFiles) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Run this from the Document Index spreadsheet Apps Script project.');

  FRESH_START_DOCUMENT_TABLES.forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, Math.max(1, sheet.getLastColumn())).clearContent();
  });

  let trashedFiles = 0;
  if (deleteDriveFiles === true) {
    const folderId = PropertiesService.getScriptProperties().getProperty('DRIVE_ROOT_FOLDER_ID');
    if (folderId) trashedFiles = freshStartTrashFolderContents_(DriveApp.getFolderById(folderId));
  }

  const result = { ok: true, documents: 0, documentLines: 0, trashedFiles: trashedFiles };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function freshStartResetReportingDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Run this from the Reporting spreadsheet Apps Script project.');

  FRESH_START_REPORTING_TABLES.forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, Math.max(1, sheet.getLastColumn())).clearContent();
  });

  const result = { ok: true, reportingRows: 0 };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function freshStartSeedSettings_(ss) {
  const sheet = ss.getSheetByName('Settings');
  if (!sheet) throw new Error('Settings sheet is missing');
  const now = new Date().toISOString();
  const rows = [
    ['company_name','Easynet IT Solutions Limited','Legal/company display name',now],
    ['base_currency','PGK','Base accounting currency',now],
    ['financial_year_start_month','1','January = 1',now],
    ['gst_status','UNVERIFIED','GST posting remains blocked until registration is verified',now],
    ['app_version','0.4.1','Fresh-start finance schema',now]
  ];
  sheet.getRange(2, 1, rows.length, 4).setValues(rows);
}

function freshStartSeedAccounts_(ss) {
  const sheet = ss.getSheetByName('Accounts');
  if (!sheet) throw new Error('Accounts sheet is missing');
  const now = new Date().toISOString();
  const rows = FRESH_START_COA.map(function(a) {
    return [a[0],a[1],a[2],a[3],a[4],a[5],now,now];
  });
  sheet.getRange(2, 1, rows.length, 8).setValues(rows);
}

function freshStartCoreStatus_(ss) {
  const counts = {};
  FRESH_START_CORE_TABLES.forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    counts[name] = sheet ? Math.max(0, sheet.getLastRow() - 1) : null;
  });
  return {
    ok: counts.Accounts === FRESH_START_COA.length && counts.Settings === 5,
    accountsSeeded: counts.Accounts,
    settingsSeeded: counts.Settings,
    counts: counts
  };
}

function freshStartTrashFolderContents_(folder) {
  let count = 0;
  const files = folder.getFiles();
  while (files.hasNext()) {
    files.next().setTrashed(true);
    count += 1;
  }
  const folders = folder.getFolders();
  while (folders.hasNext()) {
    const child = folders.next();
    count += freshStartTrashFolderContents_(child);
    child.setTrashed(true);
  }
  return count;
}
