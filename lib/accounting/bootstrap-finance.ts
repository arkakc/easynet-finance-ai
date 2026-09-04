import {
  appendRecord,
  batchAppend,
  listTable,
} from "@/lib/backend/apps-script";
import {
  INITIAL_ACCOUNT_IDS,
  INITIAL_CHART_OF_ACCOUNTS,
} from "@/lib/accounting/chart-of-accounts";

const LOAN_ID = "LOAN-2026-0001";
const OPENING_JOURNAL_ID = "JRN-2026-OPEN-0001";

async function loadExistingState() {
  const [accounts, loans, journalHeaders, journalLines] = await Promise.all([
    listTable<{ accountId: string }>("Accounts", 500, 0),
    listTable<{ loanId: string }>("Loans", 500, 0),
    listTable<{ journalId: string }>("JournalHeaders", 500, 0),
    listTable<{ journalLineId: string; journalId: string }>("JournalLines", 500, 0),
  ]);

  return {
    accounts: accounts.rows,
    loans: loans.rows,
    journalHeaders: journalHeaders.rows,
    journalLines: journalLines.rows,
  };
}

async function ensureAccounts(existingAccounts: { accountId: string }[]) {
  const existingIds = new Set(existingAccounts.map((row) => row.accountId));
  const missing = INITIAL_CHART_OF_ACCOUNTS.filter(
    (account) => !existingIds.has(account.accountId),
  );

  if (missing.length) {
    await batchAppend("Accounts", [...missing], "finance-bootstrap");
  }

  return missing.map((account) => account.accountId);
}

async function ensureOpeningLoan(existingLoans: { loanId: string }[]) {
  if (existingLoans.some((row) => row.loanId === LOAN_ID)) return false;

  await appendRecord(
    "Loans",
    {
      loanId: LOAN_ID,
      lenderName: "Willie Batia",
      loanDate: "2026-09-04",
      principal: 500,
      interestRate: 0.25,
      contractInterest: 0,
      expectedSettlement: 500,
      principalRepaid: 0,
      interestPaid: 0,
      principalOutstanding: 500,
      interestOutstanding: 0,
      repaymentCondition:
        "25% monthly compound interest. Interest compounds on each monthly anniversary from 04-09-2026. Repayment when company cash position permits; controller approval required.",
      sourceDocumentId: "",
      status: "ACTIVE",
    },
    "finance-bootstrap",
  );

  return true;
}

async function ensureOpeningJournal(
  existingHeaders: { journalId: string }[],
  existingLines: { journalLineId: string; journalId: string }[],
) {
  const now = new Date().toISOString();
  const headerExists = existingHeaders.some(
    (row) => row.journalId === OPENING_JOURNAL_ID,
  );

  if (!headerExists) {
    await appendRecord(
      "JournalHeaders",
      {
        journalId: OPENING_JOURNAL_ID,
        postingDate: "2026-09-04",
        documentType: "FUNDING_LOAN",
        documentId: LOAN_ID,
        documentNumber: LOAN_ID,
        reference: "Opening business funding received from Willie Batia",
        projectId: "",
        status: "POSTED",
        reversalOfJournalId: "",
        createdBy: "finance-bootstrap",
        approvedBy: "Finance Controller",
        createdAt: now,
        postedAt: now,
      },
      "finance-bootstrap",
    );
  }

  const requiredLines = [
    {
      journalLineId: `${OPENING_JOURNAL_ID}-001`,
      journalId: OPENING_JOURNAL_ID,
      lineNo: 1,
      accountId: INITIAL_ACCOUNT_IDS.cash,
      customerId: "",
      supplierId: "",
      projectId: "",
      debit: 500,
      credit: 0,
      taxCode: "",
      description: "Opening cash received from third-party loan",
      createdAt: now,
    },
    {
      journalLineId: `${OPENING_JOURNAL_ID}-002`,
      journalId: OPENING_JOURNAL_ID,
      lineNo: 2,
      accountId: INITIAL_ACCOUNT_IDS.loanPayable,
      customerId: "",
      supplierId: "",
      projectId: "",
      debit: 0,
      credit: 500,
      taxCode: "",
      description: "Opening third-party loan payable — Willie Batia",
      createdAt: now,
    },
  ];

  const existingLineIds = new Set(
    existingLines
      .filter((row) => row.journalId === OPENING_JOURNAL_ID)
      .map((row) => row.journalLineId),
  );
  const missingLines = requiredLines.filter(
    (line) => !existingLineIds.has(line.journalLineId),
  );

  if (missingLines.length) {
    await batchAppend("JournalLines", missingLines, "finance-bootstrap");
  }

  return {
    headerCreated: !headerExists,
    linesCreated: missingLines.length,
  };
}

export async function bootstrapFinanceMasterData() {
  const state = await loadExistingState();

  const createdAccounts = await ensureAccounts(state.accounts);
  const loanCreated = await ensureOpeningLoan(state.loans);
  const journal = await ensureOpeningJournal(
    state.journalHeaders,
    state.journalLines,
  );

  return {
    ok: true,
    createdAccounts,
    openingLoan: loanCreated ? "created" : "already-exists",
    openingJournal: journal.headerCreated ? "created" : "already-exists",
    openingJournalLinesCreated: journal.linesCreated,
    openingBalance: {
      cash: 500,
      loanPayable: 500,
    },
    loanTerms: {
      lender: "Willie Batia",
      loanDate: "2026-09-04",
      principal: 500,
      monthlyRate: 0.25,
      method: "compound-monthly",
      firstAccrualDate: "2026-10-04",
    },
  };
}
