const REPORTING_API_VERSION = '0.4.1';

const REPORTING_TABLES = {
  ReportDashboardKPI: ['key','value','periodStart','periodEnd','updatedAt'],
  ReportDailySales: ['date','netAmount','gstAmount','totalAmount','invoiceCount','updatedAt'],
  ReportDailyPurchases: ['date','netAmount','gstAmount','totalAmount','invoiceCount','updatedAt'],
  ReportARSummary: ['customerId','outstandingAmount','currentAmount','days30','days60','days90','over90','updatedAt'],
  ReportAPSummary: ['supplierId','outstandingAmount','currentAmount','days30','days60','days90','over90','updatedAt'],
  ReportGSTSummary: ['period','outputGST','inputGST','netGST','status','updatedAt'],
  ReportProjectProfitability: ['projectId','revenue','purchaseCost','expenseCost','grossProfit','marginPercent','updatedAt']
};

function doGet() {
  return reportingJson_({ ok: true, service: 'Easynet Finance Reporting API', version: REPORTING_API_VERSION });
}

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
    if (action === 'refresh') return reportingJson_(refreshReportingMaterializedViews());

    throw new Error('Unsupported Reporting API action: ' + action);
  } catch (err) {
    return reportingJson_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function bootstrapReportingDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Bind this script to the Reporting spreadsheet.');

  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());
  Object.keys(REPORTING_TABLES).forEach(function(name) {
    reportingEnsureSheet_(ss, name, REPORTING_TABLES[name]);
  });

  const token = reportingEnsureToken_();
  Logger.log('Reporting API ready. Spreadsheet ID: ' + ss.getId());
  Logger.log('API token: ' + token);
  return { ok: true, spreadsheetId: ss.getId(), apiToken: token, version: REPORTING_API_VERSION };
}

function configureReportingSources(coreSpreadsheetId, documentSpreadsheetId) {
  if (!coreSpreadsheetId) throw new Error('coreSpreadsheetId is required');
  const core = SpreadsheetApp.openById(String(coreSpreadsheetId));
  const props = PropertiesService.getScriptProperties();
  props.setProperty('CORE_SOURCE_SPREADSHEET_ID', core.getId());

  let documentId = '';
  if (documentSpreadsheetId) {
    const documentDb = SpreadsheetApp.openById(String(documentSpreadsheetId));
    documentId = documentDb.getId();
    props.setProperty('DOCUMENT_SOURCE_SPREADSHEET_ID', documentId);
  } else {
    props.deleteProperty('DOCUMENT_SOURCE_SPREADSHEET_ID');
  }

  const result = { ok: true, coreConfigured: true, documentConfigured: Boolean(documentId) };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function refreshReportingMaterializedViews() {
  const props = PropertiesService.getScriptProperties();
  const coreId = props.getProperty('CORE_SOURCE_SPREADSHEET_ID');
  const documentId = props.getProperty('DOCUMENT_SOURCE_SPREADSHEET_ID') || '';
  if (!coreId) throw new Error('Reporting source is not configured. Run configureReportingSources(coreSpreadsheetId, documentSpreadsheetId).');
  return materializeReportingFromSplitDatabases(coreId, documentId);
}

function installReportingRefreshTrigger() {
  const handler = 'refreshReportingMaterializedViews';
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger(handler).timeBased().everyMinutes(5).create();
  const result = { ok: true, handler: handler, everyMinutes: 5 };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function getReportingRefreshStatus() {
  const props = PropertiesService.getScriptProperties();
  const triggers = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === 'refreshReportingMaterializedViews';
  });
  return {
    ok: true,
    version: REPORTING_API_VERSION,
    coreConfigured: Boolean(props.getProperty('CORE_SOURCE_SPREADSHEET_ID')),
    documentConfigured: Boolean(props.getProperty('DOCUMENT_SOURCE_SPREADSHEET_ID')),
    refreshTriggerCount: triggers.length
  };
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
  return t.sheet.getRange(start, 1, count, t.headers.length).getValues().map(function(row) {
    return reportingRowObject_(t.headers, row);
  });
}

function reportingFind_(name, filters, limit) {
  const rows = reportingList_(name, 500, 0);
  const keys = Object.keys(filters || {});
  return rows.filter(function(row) {
    return keys.every(function(key) {
      return String(row[key] == null ? '' : row[key]) === String(filters[key] == null ? '' : filters[key]);
    });
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

function materializeReportingFromSplitDatabases(coreSpreadsheetId, documentSpreadsheetId) {
  if (!coreSpreadsheetId) throw new Error('coreSpreadsheetId is required');
  const core = SpreadsheetApp.openById(String(coreSpreadsheetId));
  const documentDb = documentSpreadsheetId ? SpreadsheetApp.openById(String(documentSpreadsheetId)) : null;
  const now = new Date();
  const nowIso = now.toISOString();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const rows = function(ss, name) {
    if (!ss) return [];
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() <= 1 || sh.getLastColumn() === 0) return [];
    const data = sh.getDataRange().getValues();
    const headers = data[0].map(String);
    return data.slice(1).map(function(r) {
      const o = {};
      headers.forEach(function(h, i) { o[h] = r[i]; });
      return o;
    });
  };

  const n = function(v) {
    const x = Number(v || 0);
    return isFinite(x) ? x : 0;
  };
  const round2 = function(v) { return Math.round((n(v) + Number.EPSILON) * 100) / 100; };
  const status = function(v) { return String(v || '').trim().toUpperCase(); };
  const dateKey = function(v) {
    if (!v) return '';
    const d = v instanceof Date ? v : new Date(v);
    if (isNaN(d.getTime())) return String(v).slice(0, 10);
    return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Pacific/Port_Moresby', 'yyyy-MM-dd');
  };
  const ageDays = function(v) {
    if (!v) return 0;
    const d = v instanceof Date ? new Date(v.getFullYear(), v.getMonth(), v.getDate()) : new Date(v);
    if (isNaN(d.getTime())) return 0;
    return Math.max(0, Math.floor((today.getTime() - d.getTime()) / 86400000));
  };

  const accounts = rows(core, 'Accounts');
  const journalLines = rows(core, 'JournalLines');
  const quotes = rows(core, 'Quotes');
  const invoices = rows(core, 'Invoices');
  const pos = rows(core, 'PurchaseOrders');
  const bills = rows(core, 'SupplierBills');
  const payments = rows(core, 'Payments');
  const expenses = rows(core, 'Expenses');
  const projects = rows(core, 'Projects');
  const settings = rows(core, 'Settings');
  const loans = rows(core, 'Loans');
  const docs = rows(documentDb, 'Documents');

  const accountType = {};
  accounts.forEach(function(a) { accountType[String(a.accountId)] = String(a.accountType || ''); });

  const balanceFor = function(ids) {
    const set = {};
    ids.forEach(function(id) { set[id] = true; });
    return journalLines.reduce(function(sum, line) {
      return set[String(line.accountId)] ? sum + n(line.debit) - n(line.credit) : sum;
    }, 0);
  };

  let revenue = 0;
  let expenseTotal = 0;
  journalLines.forEach(function(line) {
    const type = accountType[String(line.accountId)];
    if (type === 'Income') revenue += n(line.credit) - n(line.debit);
    if (type === 'Expense') expenseTotal += n(line.debit) - n(line.credit);
  });
  revenue = round2(revenue);
  expenseTotal = round2(expenseTotal);

  // A source document is accounting-posted only when a journal reference exists.
  // Cancelled or reversed documents never contribute to materialized reporting.
  const excludedStatuses = ['CANCELLED','REVERSED'];
  const postedInvoices = invoices.filter(function(r) { return Boolean(String(r.journalId || '').trim()) && excludedStatuses.indexOf(status(r.status)) < 0; });
  const postedBills = bills.filter(function(r) { return Boolean(String(r.journalId || '').trim()) && excludedStatuses.indexOf(status(r.status)) < 0; });
  const postedExpenses = expenses.filter(function(r) { return Boolean(String(r.journalId || '').trim()) && excludedStatuses.indexOf(status(r.status)) < 0; });
  const activeLoan = loans.find(function(r) { return status(r.status) === 'ACTIVE'; }) || null;
  const gstStatus = String((settings.find(function(r) { return String(r.key) === 'gst_status'; }) || {}).value || 'UNVERIFIED');

  const arGl = round2(balanceFor(['ACC-1130']));
  const apGl = round2(-balanceFor(['ACC-2110']));
  const outputGST = round2(-balanceFor(['ACC-2120']));
  const inputGST = round2(balanceFor(['ACC-1140']));
  const netGST = round2(outputGST - inputGST);

  const arSubledger = round2(postedInvoices.reduce(function(sum, r) { return sum + n(r.outstandingAmount); }, 0));
  const apSubledger = round2(postedBills.reduce(function(sum, r) { return sum + n(r.outstandingAmount); }, 0));

  // Supplier quotations share the PurchaseOrders storage table, but are not commitments.
  const poCommitments = round2(pos.filter(function(r) {
    const number = String(r.poNumber || '');
    return number.indexOf('SUPQ-') !== 0 && ['CANCELLED','REVERSED','BILLED'].indexOf(status(r.status)) < 0;
  }).reduce(function(sum, r) { return sum + n(r.totalAmount); }, 0));

  const draftApprovals =
    quotes.filter(function(r) { return status(r.status) === 'DRAFT'; }).length +
    invoices.filter(function(r) { return status(r.status) === 'DRAFT'; }).length +
    pos.filter(function(r) { return status(r.status) === 'DRAFT'; }).length +
    bills.filter(function(r) { return status(r.status) === 'DRAFT'; }).length +
    payments.filter(function(r) {
      return status(r.status) === 'DRAFT' && ['CUSTOMER','SUPPLIER'].indexOf(status(r.partyType)) >= 0;
    }).length +
    expenses.filter(function(r) { return status(r.status) === 'DRAFT'; }).length;

  const activeProjects = projects.filter(function(r) {
    return ['OPEN','ACTIVE','ON HOLD'].indexOf(status(r.status)) >= 0;
  }).length;
  const sourcePending = docs.filter(function(r) { return !r.driveFileId; }).length;

  const kpis = {
    cashBank: round2(balanceFor(['ACC-1110','ACC-1120','ACC-1121'])),
    accountsReceivable: arGl,
    accountsPayable: apGl,
    gstPayable: netGST,
    outputGST: outputGST,
    inputGST: inputGST,
    revenuePosted: revenue,
    expensesPosted: expenseTotal,
    netProfitPosted: round2(revenue - expenseTotal),
    poCommitments: poCommitments,
    gstStatus: gstStatus,
    draftApprovals: draftApprovals,
    activeProjects: activeProjects,
    sourcePending: sourcePending,
    arSubledger: arSubledger,
    apSubledger: apSubledger,
    arReconciliationDifference: round2(arGl - arSubledger),
    apReconciliationDifference: round2(apGl - apSubledger),
    materializedAt: nowIso
  };

  if (activeLoan) {
    kpis.loanLenderName = activeLoan.lenderName || '';
    kpis.loanDate = activeLoan.loanDate || '';
    kpis.loanPrincipal = n(activeLoan.principal);
    kpis.loanInterestRate = n(activeLoan.interestRate);
    kpis.loanPrincipalOutstanding = n(activeLoan.principalOutstanding);
    kpis.loanInterestOutstanding = n(activeLoan.interestOutstanding);
    kpis.loanExpectedSettlement = n(activeLoan.expectedSettlement);
    kpis.loanFirstAccrualDate = activeLoan.firstAccrualDate || '';
    kpis.loanLastAccruedThrough = activeLoan.lastAccruedThrough || '';
    kpis.loanStatus = activeLoan.status || '';
  }

  const kpiRows = Object.keys(kpis).map(function(key) {
    return { key: key, value: kpis[key], periodStart: '', periodEnd: '', updatedAt: nowIso };
  });

  const groupDaily = function(source, dateField) {
    const map = {};
    source.forEach(function(r) {
      const key = dateKey(r[dateField]);
      if (!key) return;
      if (!map[key]) map[key] = { date: key, netAmount: 0, gstAmount: 0, totalAmount: 0, invoiceCount: 0, updatedAt: nowIso };
      map[key].netAmount += n(r.netAmount);
      map[key].gstAmount += n(r.gstAmount);
      map[key].totalAmount += n(r.totalAmount);
      map[key].invoiceCount += 1;
    });
    return Object.keys(map).sort().map(function(k) {
      map[k].netAmount = round2(map[k].netAmount);
      map[k].gstAmount = round2(map[k].gstAmount);
      map[k].totalAmount = round2(map[k].totalAmount);
      return map[k];
    });
  };

  const aging = function(source, partyField) {
    const map = {};
    source.forEach(function(r) {
      const id = String(r[partyField] || '');
      if (!id) return;
      if (!map[id]) map[id] = { outstandingAmount: 0, currentAmount: 0, days30: 0, days60: 0, days90: 0, over90: 0 };
      const amount = n(r.outstandingAmount);
      const age = ageDays(r.dueDate || r.invoiceDate || r.billDate);
      map[id].outstandingAmount += amount;
      if (age <= 0) map[id].currentAmount += amount;
      else if (age <= 30) map[id].days30 += amount;
      else if (age <= 60) map[id].days60 += amount;
      else if (age <= 90) map[id].days90 += amount;
      else map[id].over90 += amount;
    });
    return Object.keys(map).map(function(id) {
      const v = map[id];
      const out = {
        outstandingAmount: round2(v.outstandingAmount),
        currentAmount: round2(v.currentAmount),
        days30: round2(v.days30),
        days60: round2(v.days60),
        days90: round2(v.days90),
        over90: round2(v.over90),
        updatedAt: nowIso
      };
      out[partyField] = id;
      return out;
    });
  };

  const projectMap = {};
  const ensureProject = function(id) {
    const key = String(id || '');
    if (!key) return null;
    if (!projectMap[key]) projectMap[key] = { projectId: key, revenue: 0, purchaseCost: 0, expenseCost: 0, updatedAt: nowIso };
    return projectMap[key];
  };

  postedInvoices.forEach(function(r) {
    const project = ensureProject(r.projectId);
    if (project) project.revenue += n(r.netAmount);
  });
  postedBills.forEach(function(r) {
    const project = ensureProject(r.projectId);
    if (project) project.purchaseCost += n(r.netAmount);
  });
  postedExpenses.forEach(function(r) {
    const project = ensureProject(r.projectId);
    if (project) project.expenseCost += n(r.netAmount);
  });

  const projectRows = Object.keys(projectMap).map(function(key) {
    const project = projectMap[key];
    project.revenue = round2(project.revenue);
    project.purchaseCost = round2(project.purchaseCost);
    project.expenseCost = round2(project.expenseCost);
    project.grossProfit = round2(project.revenue - project.purchaseCost - project.expenseCost);
    project.marginPercent = project.revenue ? round2((project.grossProfit / project.revenue) * 100) : 0;
    return project;
  });

  const salesRows = groupDaily(postedInvoices, 'invoiceDate');
  const purchaseRows = groupDaily(postedBills, 'billDate');
  const arRows = aging(postedInvoices, 'customerId');
  const apRows = aging(postedBills, 'supplierId');
  const gstRows = [{ period: 'ALL', outputGST: outputGST, inputGST: inputGST, netGST: netGST, status: gstStatus, updatedAt: nowIso }];

  reportingReplaceAll_('ReportDashboardKPI', kpiRows);
  reportingReplaceAll_('ReportDailySales', salesRows);
  reportingReplaceAll_('ReportDailyPurchases', purchaseRows);
  reportingReplaceAll_('ReportARSummary', arRows);
  reportingReplaceAll_('ReportAPSummary', apRows);
  reportingReplaceAll_('ReportGSTSummary', gstRows);
  reportingReplaceAll_('ReportProjectProfitability', projectRows);

  const result = {
    ok: true,
    version: REPORTING_API_VERSION,
    generatedAt: nowIso,
    reconciliation: {
      arDifference: round2(arGl - arSubledger),
      apDifference: round2(apGl - apSubledger)
    },
    counts: {
      dashboardKPI: kpiRows.length,
      dailySales: salesRows.length,
      dailyPurchases: purchaseRows.length,
      arSummary: arRows.length,
      apSummary: apRows.length,
      gstSummary: gstRows.length,
      projectProfitability: projectRows.length
    }
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function reportingReplaceAll_(name, records) {
  const t = reportingTable_(name);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (t.sheet.getLastRow() > 1) {
      t.sheet.getRange(2, 1, t.sheet.getLastRow() - 1, t.headers.length).clearContent();
    }
    if (!records || !records.length) return;
    const values = records.map(function(record) {
      return t.headers.map(function(h) { return record[h] == null ? '' : record[h]; });
    });
    t.sheet.getRange(2, 1, values.length, t.headers.length).setValues(values);
  } finally {
    lock.releaseLock();
  }
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
