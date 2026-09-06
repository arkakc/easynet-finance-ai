const marker = "[posting-smoke]";
const commitMessage = process.env.VERCEL_GIT_COMMIT_MESSAGE || "";
const preview = process.env.VERCEL_ENV === "preview";

if (!preview || !commitMessage.includes(marker)) {
  console.log("[posting-smoke] skipped", { preview, markerPresent: commitMessage.includes(marker) });
  process.exit(0);
}

const services = {
  core: {
    url: process.env.CORE_APPS_SCRIPT_WEB_APP_URL,
    token: process.env.CORE_APPS_SCRIPT_API_TOKEN,
  },
  reporting: {
    url: process.env.REPORTING_APPS_SCRIPT_WEB_APP_URL,
    token: process.env.REPORTING_APPS_SCRIPT_API_TOKEN,
  },
  document: {
    url: process.env.DOCUMENT_APPS_SCRIPT_WEB_APP_URL,
    token: process.env.DOCUMENT_APPS_SCRIPT_API_TOKEN,
  },
};

function configured(service) {
  return Boolean(services[service].url && services[service].token);
}

async function call(service, action, payload = {}) {
  const config = services[service];
  if (!config.url || !config.token) throw new Error(`${service} backend is not fully configured`);
  const response = await fetch(config.url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token: config.token, action, payload }),
    redirect: "follow",
  });
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${service} returned non-JSON content (${response.status})`);
  }
  if (!response.ok) throw new Error(`${service} HTTP ${response.status}`);
  if (!data || data.ok !== true) throw new Error(`${service}: ${String(data?.error || "backend error")}`);
  return data;
}

async function safeCheck(name, fn) {
  try {
    const value = await fn();
    return { name, ok: true, value };
  } catch (error) {
    return { name, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const runId = (process.env.VERCEL_GIT_COMMIT_SHA || `${Date.now()}`).slice(0, 10).toUpperCase();
const postingDate = new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const postingCases = [
  {
    slug: "SALES",
    documentType: "UAT_SALES_INVOICE",
    lines: [
      { accountId: "ACC-1130", debit: 110, customerId: "UAT-CUSTOMER", description: "UAT accounts receivable" },
      { accountId: "ACC-4100", credit: 100, customerId: "UAT-CUSTOMER", description: "UAT revenue" },
      { accountId: "ACC-2120", credit: 10, customerId: "UAT-CUSTOMER", taxCode: "GST", description: "UAT output GST" },
    ],
  },
  {
    slug: "RECEIPT",
    documentType: "UAT_CUSTOMER_RECEIPT",
    lines: [
      { accountId: "ACC-1120", debit: 110, customerId: "UAT-CUSTOMER", description: "UAT bank receipt" },
      { accountId: "ACC-1130", credit: 110, customerId: "UAT-CUSTOMER", description: "UAT settle AR" },
    ],
  },
  {
    slug: "PURCHASE",
    documentType: "UAT_SUPPLIER_INVOICE",
    lines: [
      { accountId: "ACC-5100", debit: 100, supplierId: "UAT-SUPPLIER", description: "UAT direct cost" },
      { accountId: "ACC-1140", debit: 10, supplierId: "UAT-SUPPLIER", taxCode: "GST", description: "UAT input GST" },
      { accountId: "ACC-2110", credit: 110, supplierId: "UAT-SUPPLIER", description: "UAT accounts payable" },
    ],
  },
  {
    slug: "SUPPAY",
    documentType: "UAT_SUPPLIER_PAYMENT",
    lines: [
      { accountId: "ACC-2110", debit: 110, supplierId: "UAT-SUPPLIER", description: "UAT settle AP" },
      { accountId: "ACC-1120", credit: 110, supplierId: "UAT-SUPPLIER", description: "UAT bank payment" },
    ],
  },
  {
    slug: "EXPENSE",
    documentType: "UAT_EXPENSE",
    lines: [
      { accountId: "ACC-6600", debit: 100, supplierId: "UAT-SUPPLIER", description: "UAT office expense" },
      { accountId: "ACC-1140", debit: 10, supplierId: "UAT-SUPPLIER", taxCode: "GST", description: "UAT input GST" },
      { accountId: "ACC-1120", credit: 110, supplierId: "UAT-SUPPLIER", description: "UAT expense payment" },
    ],
  },
  {
    slug: "LOANACC",
    documentType: "UAT_LOAN_INTEREST_ACCRUAL",
    lines: [
      { accountId: "ACC-6100", debit: 10, description: "UAT interest expense" },
      { accountId: "ACC-2140", credit: 10, description: "UAT accrued interest payable" },
    ],
  },
  {
    slug: "LOANPAY",
    documentType: "UAT_LOAN_REPAYMENT",
    lines: [
      { accountId: "ACC-2130", debit: 50, description: "UAT loan principal repayment" },
      { accountId: "ACC-2140", debit: 5, description: "UAT accrued interest repayment" },
      { accountId: "ACC-1120", credit: 55, description: "UAT loan bank payment" },
    ],
  },
];

function journalBundle(journalId, documentType, documentId, lines, reversalOfJournalId = "") {
  const timestamp = now();
  return {
    header: {
      journalId,
      postingDate,
      documentType,
      documentId,
      documentNumber: documentId,
      reference: `Automated preview posting smoke ${documentId}`,
      projectId: "",
      status: "POSTED",
      reversalOfJournalId,
      createdBy: "preview-posting-smoke",
      approvedBy: "Automated UAT",
      createdAt: timestamp,
      postedAt: timestamp,
    },
    lines: lines.map((line, index) => ({
      journalLineId: `${journalId}-${String(index + 1).padStart(3, "0")}`,
      journalId,
      lineNo: index + 1,
      accountId: line.accountId,
      customerId: line.customerId || "",
      supplierId: line.supplierId || "",
      projectId: line.projectId || "",
      debit: Number(line.debit || 0),
      credit: Number(line.credit || 0),
      taxCode: line.taxCode || "",
      description: line.description || "UAT posting smoke",
      createdAt: timestamp,
    })),
    actor: "preview-posting-smoke",
  };
}

function totals(lines) {
  return lines.reduce(
    (sum, line) => ({ debit: round2(sum.debit + Number(line.debit || 0)), credit: round2(sum.credit + Number(line.credit || 0)) }),
    { debit: 0, credit: 0 },
  );
}

async function ensurePostingRoundTrip(testCase) {
  const documentId = `SMOKE-${testCase.slug}-${runId}`;
  const journalId = `JRN-UAT-${testCase.slug}-${runId}`;
  const reversalId = `JRN-UAT-REV-${testCase.slug}-${runId}`;
  const expected = totals(testCase.lines);
  if (expected.debit !== expected.credit) throw new Error(`${testCase.slug} test definition is not balanced`);

  let original = (await call("core", "find", {
    table: "JournalHeaders",
    filters: { documentType: testCase.documentType, documentId },
    limit: 5,
  })).rows?.[0];

  if (!original) {
    await call("core", "postJournal", journalBundle(journalId, testCase.documentType, documentId, testCase.lines));
    original = (await call("core", "find", {
      table: "JournalHeaders",
      filters: { journalId },
      limit: 1,
    })).rows?.[0];
  }
  if (!original || String(original.status).toUpperCase() !== "POSTED") throw new Error(`${testCase.slug} original journal was not persisted as POSTED`);

  let reversal = (await call("core", "find", {
    table: "JournalHeaders",
    filters: { reversalOfJournalId: original.journalId },
    limit: 5,
  })).rows?.[0];

  if (!reversal) {
    const reversedLines = testCase.lines.map((line) => ({
      ...line,
      debit: Number(line.credit || 0),
      credit: Number(line.debit || 0),
      description: `Reversal: ${line.description || testCase.slug}`,
    }));
    await call("core", "postJournal", journalBundle(reversalId, "JOURNAL_REVERSAL", String(original.journalId), reversedLines, String(original.journalId)));
    reversal = (await call("core", "find", {
      table: "JournalHeaders",
      filters: { journalId: reversalId },
      limit: 1,
    })).rows?.[0];
  }
  if (!reversal || String(reversal.status).toUpperCase() !== "POSTED") throw new Error(`${testCase.slug} reversal journal was not persisted as POSTED`);

  const originalLines = (await call("core", "find", { table: "JournalLines", filters: { journalId: String(original.journalId) }, limit: 20 })).rows || [];
  const reversalLines = (await call("core", "find", { table: "JournalLines", filters: { journalId: String(reversal.journalId) }, limit: 20 })).rows || [];
  const originalTotals = totals(originalLines);
  const reversalTotals = totals(reversalLines);
  const netDebit = round2(originalTotals.debit + reversalTotals.debit);
  const netCredit = round2(originalTotals.credit + reversalTotals.credit);
  if (originalTotals.debit !== expected.debit || originalTotals.credit !== expected.credit) throw new Error(`${testCase.slug} original journal totals changed`);
  if (reversalTotals.debit !== expected.credit || reversalTotals.credit !== expected.debit) throw new Error(`${testCase.slug} reversal totals are incorrect`);
  if (netDebit !== netCredit) throw new Error(`${testCase.slug} round-trip is not balanced`);

  let duplicateBlocked = false;
  try {
    await call("core", "postJournal", journalBundle(`JRN-UAT-DUP-${testCase.slug}-${runId}`, testCase.documentType, documentId, testCase.lines));
  } catch (error) {
    duplicateBlocked = /already has a posted journal|already exists/i.test(String(error instanceof Error ? error.message : error));
  }
  if (!duplicateBlocked) throw new Error(`${testCase.slug} duplicate posting was not blocked`);

  return {
    slug: testCase.slug,
    originalJournalId: String(original.journalId),
    reversalJournalId: String(reversal.journalId),
    debit: expected.debit,
    credit: expected.credit,
    duplicateBlocked,
    netImpact: 0,
  };
}

async function expectRejected(name, bundle, pattern) {
  try {
    await call("core", "postJournal", bundle);
    return { name, ok: false, error: "unexpectedly accepted" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name, ok: pattern.test(message), message };
  }
}

const results = {
  runId,
  configured: {
    core: configured("core"),
    reporting: configured("reporting"),
    document: configured("document"),
  },
  health: {},
  reads: {},
  posting: [],
  controls: [],
};

results.health.core = await safeCheck("core-health", () => call("core", "health"));
results.health.reporting = await safeCheck("reporting-health", () => call("reporting", "health"));
results.health.document = await safeCheck("document-health", () => call("document", "health"));

results.reads.accounts = await safeCheck("accounts", async () => {
  const data = await call("core", "list", { table: "Accounts", limit: 500, offset: 0 });
  const rows = data.rows || [];
  const required = ["ACC-1120", "ACC-1130", "ACC-1140", "ACC-2110", "ACC-2120", "ACC-2130", "ACC-2140", "ACC-3400", "ACC-4100", "ACC-5100", "ACC-6100", "ACC-6600"];
  const byId = new Map(rows.map((row) => [String(row.accountId), row]));
  const parentIds = new Set(rows.map((row) => String(row.parentAccount || "")).filter(Boolean));
  const invalid = required.filter((id) => !byId.has(id) || String(byId.get(id)?.active).toLowerCase() === "false" || parentIds.has(id));
  if (invalid.length) throw new Error(`invalid required posting accounts: ${invalid.join(", ")}`);
  return { accountCount: rows.length, requiredPostingAccounts: required.length };
});

results.reads.reportingKpi = await safeCheck("reporting-kpi", async () => {
  const data = await call("reporting", "list", { table: "ReportDashboardKPI", limit: 100, offset: 0 });
  return { rowCount: Array.isArray(data.rows) ? data.rows.length : 0 };
});

results.reads.documents = await safeCheck("documents", async () => {
  const data = await call("document", "list", { table: "Documents", limit: 5, offset: 0 });
  return { rowCount: Array.isArray(data.rows) ? data.rows.length : 0 };
});

if (results.health.core.ok && results.reads.accounts.ok) {
  for (const testCase of postingCases) {
    const check = await safeCheck(`posting-${testCase.slug}`, () => ensurePostingRoundTrip(testCase));
    results.posting.push(check);
  }

  const badBalanceId = `JRN-UAT-BADBAL-${runId}`;
  results.controls.push(await expectRejected(
    "unbalanced-journal-blocked",
    journalBundle(badBalanceId, "UAT_INVALID_BALANCE", `BADBAL-${runId}`, [
      { accountId: "ACC-1120", debit: 1, description: "invalid debit" },
      { accountId: "ACC-3400", credit: 0.99, description: "invalid credit" },
    ]),
    /not balanced/i,
  ));

  const parentId = `JRN-UAT-PARENT-${runId}`;
  results.controls.push(await expectRejected(
    "parent-account-posting-blocked",
    journalBundle(parentId, "UAT_INVALID_PARENT", `PARENT-${runId}`, [
      { accountId: "ACC-1100", debit: 1, description: "invalid parent posting" },
      { accountId: "ACC-3400", credit: 1, description: "offset" },
    ]),
    /parent\/control account/i,
  ));

  try {
    await call("core", "append", { table: "JournalHeaders", record: { journalId: `ILLEGAL-${runId}` }, actor: "preview-posting-smoke" });
    results.controls.push({ name: "generic-journal-append-blocked", ok: false, error: "unexpectedly accepted" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.controls.push({ name: "generic-journal-append-blocked", ok: /journal|immutable|direct|blocked/i.test(message), message });
  }
}

const postingOk = results.posting.length === postingCases.length && results.posting.every((item) => item.ok);
const controlsOk = results.controls.length >= 3 && results.controls.every((item) => item.ok);
const coreOk = results.health.core.ok && results.reads.accounts.ok && postingOk && controlsOk;
const reportingOk = results.health.reporting.ok && results.reads.reportingKpi.ok;
const documentOk = results.health.document.ok && results.reads.documents.ok;

const summary = {
  okForAccountingUat: coreOk && reportingOk,
  coreOk,
  reportingOk,
  documentOk,
  postingCasesPassed: results.posting.filter((item) => item.ok).length,
  postingCasesTotal: postingCases.length,
  controlChecksPassed: results.controls.filter((item) => item.ok).length,
  controlChecksTotal: results.controls.length,
};

console.log("[posting-smoke] result", JSON.stringify({ summary, results }, null, 2));

if (!coreOk || !reportingOk) {
  console.error("[posting-smoke] FAILED: Core/Reporting accounting checks did not pass");
  process.exit(1);
}

if (!documentOk) {
  console.warn("[posting-smoke] DOCUMENT SERVICE NOT READY: accounting tests passed, but document UAT remains blocked");
}
