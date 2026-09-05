import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { appendRecord, findRecords, updateRecord } from "@/lib/backend/apps-script";
import {
  completedMonthlyPeriods,
  monthlyAnniversaryDate,
  normalizeAccountingDate,
} from "@/lib/accounting/loan";
import { postJournal } from "@/lib/accounting/posting";
import { INITIAL_ACCOUNT_IDS } from "@/lib/accounting/chart-of-accounts";

const accrueSchema = z.object({
  loanId: z.string().trim().min(1),
  asOf: z.string().trim().min(8),
});

const repaySchema = z.object({
  loanId: z.string().trim().min(1),
  paymentDate: z.string().trim().min(8),
  principalAmount: z.coerce.number().finite().nonnegative().default(0),
  interestAmount: z.coerce.number().finite().nonnegative().default(0),
  cashBankAccountId: z.string().trim().min(1),
  paymentMethod: z.string().trim().min(1),
  reference: z.string().trim().optional().default(""),
});

const n = (value: unknown) => Number(value || 0);
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function requireSecret(secret?: string) {
  if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");
  if (!secret || secret !== env.APP_SECRET) throw new Error("Unauthorized");
}

async function getLoan(loanId: string) {
  const result = await findRecords<any>("Loans", { loanId }, 1);
  const loan = result.rows[0];
  if (!loan) throw new Error("Loan not found");
  if (String(loan.status).toUpperCase() !== "ACTIVE") throw new Error("Loan is not active");
  if (String(loan.interestMethod || "COMPOUND").toUpperCase() !== "COMPOUND") {
    throw new Error("Unsupported loan interest method");
  }
  return loan;
}

function recordedOutstanding(loan: any) {
  const principalOutstanding = loan.principalOutstanding === "" || loan.principalOutstanding == null
    ? Math.max(0, round2(n(loan.principal) - n(loan.principalRepaid)))
    : Math.max(0, round2(n(loan.principalOutstanding)));
  const interestOutstanding = loan.interestOutstanding === "" || loan.interestOutstanding == null
    ? Math.max(0, round2(n(loan.contractInterest) - n(loan.interestPaid)))
    : Math.max(0, round2(n(loan.interestOutstanding)));
  return { principalOutstanding, interestOutstanding };
}

async function accrue(raw: unknown) {
  const input = accrueSchema.parse(raw);
  const loan = await getLoan(input.loanId);
  const asOf = normalizeAccountingDate(input.asOf);
  const loanDate = normalizeAccountingDate(String(loan.loanDate));
  const lastAccruedThrough = normalizeAccountingDate(String(loan.lastAccruedThrough || loanDate));

  const targetPeriods = completedMonthlyPeriods(loanDate, asOf);
  const recognizedPeriods = completedMonthlyPeriods(loanDate, lastAccruedThrough);
  const periodsDue = Math.max(0, targetPeriods - recognizedPeriods);
  if (periodsDue <= 0) {
    return {
      loanId: input.loanId,
      asOf,
      status: "NO_ACCRUAL_DUE",
      lastAccruedThrough,
      nextAccrualDate: monthlyAnniversaryDate(loanDate, recognizedPeriods + 1),
    };
  }

  const outstanding = recordedOutstanding(loan);
  const baseOutstanding = round2(outstanding.principalOutstanding + outstanding.interestOutstanding);
  const monthlyRate = n(loan.interestRate);
  const incremental = round2(baseOutstanding * Math.pow(1 + monthlyRate, periodsDue) - baseOutstanding);
  if (incremental <= 0) throw new Error("Calculated interest accrual is not positive");

  const accruedThrough = monthlyAnniversaryDate(loanDate, targetPeriods);
  const accrualId = `${input.loanId}-${accruedThrough}`;
  const existingJournal = await findRecords<any>(
    "JournalHeaders",
    { documentType: "LOAN_INTEREST_ACCRUAL", documentId: accrualId },
    1,
  );

  let journalId = String(existingJournal.rows[0]?.journalId || "");
  if (!journalId) {
    const journal = await postJournal({
      postingDate: accruedThrough,
      documentType: "LOAN_INTEREST_ACCRUAL",
      documentId: accrualId,
      documentNumber: input.loanId,
      reference: `Compound monthly loan interest accrual for ${input.loanId} through ${accruedThrough}`,
      lines: [
        { accountId: INITIAL_ACCOUNT_IDS.interestExpense, debit: incremental, description: "Loan interest expense" },
        { accountId: INITIAL_ACCOUNT_IDS.accruedInterestPayable, credit: incremental, description: "Accrued loan interest payable" },
      ],
      createdBy: "loan-control",
      approvedBy: "Finance Controller",
    });
    journalId = journal.journalId;
  }

  const contractInterest = round2(n(loan.contractInterest) + incremental);
  const interestOutstanding = round2(outstanding.interestOutstanding + incremental);
  const expectedSettlement = round2(outstanding.principalOutstanding + interestOutstanding);

  await updateRecord("Loans", "loanId", input.loanId, {
    contractInterest,
    interestOutstanding,
    principalOutstanding: outstanding.principalOutstanding,
    expectedSettlement,
    lastAccruedThrough: accruedThrough,
    interestMethod: "COMPOUND",
    interestFrequency: "MONTHLY_ANNIVERSARY",
    firstAccrualDate: String(loan.firstAccrualDate || monthlyAnniversaryDate(loanDate, 1)),
  }, "loan-control");

  const eventId = `${input.loanId}-ACCRUAL-${accruedThrough}`;
  const existingEvent = await findRecords<any>("LoanEvents", { loanEventId: eventId }, 1);
  if (!existingEvent.rows.length) {
    await appendRecord("LoanEvents", {
      loanEventId: eventId,
      loanId: input.loanId,
      eventType: "INTEREST_ACCRUAL",
      eventDate: accruedThrough,
      principalAmount: 0,
      interestAmount: incremental,
      cashAmount: 0,
      journalId,
      reference: `Compound interest through ${accruedThrough}`,
    }, "loan-control");
  }

  return {
    loanId: input.loanId,
    asOf,
    accruedThrough,
    status: "ACCRUED",
    periodsAccrued: periodsDue,
    incrementalInterest: incremental,
    cumulativeInterest: contractInterest,
    journalId,
  };
}

async function repay(raw: unknown) {
  const input = repaySchema.parse(raw);
  const loan = await getLoan(input.loanId);
  const paymentDate = normalizeAccountingDate(input.paymentDate);
  const loanDate = normalizeAccountingDate(String(loan.loanDate));
  const lastAccruedThrough = normalizeAccountingDate(String(loan.lastAccruedThrough || loanDate));

  const periodsRequired = completedMonthlyPeriods(loanDate, paymentDate);
  const periodsRecognized = completedMonthlyPeriods(loanDate, lastAccruedThrough);
  if (periodsRequired > periodsRecognized) {
    throw new Error(`Accrue loan interest through ${monthlyAnniversaryDate(loanDate, periodsRequired)} before recording this repayment`);
  }

  const outstanding = recordedOutstanding(loan);
  if (input.principalAmount <= 0 && input.interestAmount <= 0) throw new Error("Repayment amount must be greater than zero");
  if (input.principalAmount > outstanding.principalOutstanding + 0.001) throw new Error("Principal repayment exceeds principal outstanding");
  if (input.interestAmount > outstanding.interestOutstanding + 0.001) throw new Error("Interest repayment exceeds accrued interest outstanding");

  const total = round2(input.principalAmount + input.interestAmount);
  const paymentId = `LPAY-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const lines: Array<{ accountId: string; debit?: number; credit?: number; description: string }> = [];
  if (input.principalAmount > 0) lines.push({ accountId: INITIAL_ACCOUNT_IDS.loanPayable, debit: input.principalAmount, description: "Loan principal repayment" });
  if (input.interestAmount > 0) lines.push({ accountId: INITIAL_ACCOUNT_IDS.accruedInterestPayable, debit: input.interestAmount, description: "Accrued interest repayment" });
  lines.push({ accountId: input.cashBankAccountId, credit: total, description: "Loan repayment cash/bank outflow" });

  const journal = await postJournal({
    postingDate: paymentDate,
    documentType: "LOAN_REPAYMENT",
    documentId: paymentId,
    documentNumber: paymentId,
    reference: input.reference || `Repayment of ${input.loanId}`,
    lines,
    createdBy: "loan-control",
    approvedBy: "Finance Controller",
  });

  const principalRepaid = round2(n(loan.principalRepaid) + input.principalAmount);
  const interestPaid = round2(n(loan.interestPaid) + input.interestAmount);
  const newPrincipalOutstanding = Math.max(0, round2(outstanding.principalOutstanding - input.principalAmount));
  const newInterestOutstanding = Math.max(0, round2(outstanding.interestOutstanding - input.interestAmount));
  const closed = newPrincipalOutstanding === 0 && newInterestOutstanding === 0;

  await updateRecord("Loans", "loanId", input.loanId, {
    principalRepaid,
    interestPaid,
    principalOutstanding: newPrincipalOutstanding,
    interestOutstanding: newInterestOutstanding,
    expectedSettlement: round2(newPrincipalOutstanding + newInterestOutstanding),
    status: closed ? "CLOSED" : "ACTIVE",
  }, "loan-control");

  await appendRecord("Payments", {
    paymentId,
    paymentNumber: paymentId,
    paymentType: "PAY",
    partyType: "Lender",
    partyId: input.loanId,
    projectId: "",
    paymentDate,
    amount: total,
    paymentMethod: input.paymentMethod,
    cashBankAccountId: input.cashBankAccountId,
    reference: input.reference || `Loan repayment ${input.loanId}`,
    againstDocumentType: "Loan",
    againstDocumentId: input.loanId,
    sourceDocumentId: "",
    journalId: journal.journalId,
    status: "POSTED",
  }, "loan-control");

  await appendRecord("LoanEvents", {
    loanEventId: `${input.loanId}-REPAYMENT-${paymentId}`,
    loanId: input.loanId,
    eventType: "REPAYMENT",
    eventDate: paymentDate,
    principalAmount: input.principalAmount,
    interestAmount: input.interestAmount,
    cashAmount: total,
    journalId: journal.journalId,
    reference: input.reference || paymentId,
  }, "loan-control");

  return {
    loanId: input.loanId,
    status: closed ? "CLOSED" : "ACTIVE",
    paymentId,
    journalId: journal.journalId,
    totalPaid: total,
    principalOutstanding: newPrincipalOutstanding,
    interestOutstanding: newInterestOutstanding,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { secret?: string; action?: "accrue" | "repay"; payload?: unknown };
    requireSecret(body.secret);
    const result = body.action === "accrue"
      ? await accrue(body.payload)
      : body.action === "repay"
        ? await repay(body.payload)
        : (() => { throw new Error("Unsupported loan action"); })();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Loan action failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
