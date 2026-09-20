import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { parseBankStatementRows } from "@/lib/banking/statement-parser";
import { prisma } from "@/src/lib/prisma";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 10_000;
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function responseStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "Bank reconciliation failed";
  return { message, status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400 };
}

function directionMatches(amount: number, type: string) {
  const incoming = ["CUSTOMER_RECEIPT", "SUPPLIER_REFUND", "OWNER_CONTRIBUTION"].includes(type);
  const outgoing = ["SUPPLIER_PAYMENT", "CUSTOMER_REFUND", "OWNER_DRAWING", "EMPLOYEE_ADVANCE"].includes(type);
  return amount > 0 ? incoming : outgoing;
}

async function ledgerBalance(chartOfAccountsId: string | null, throughDate: Date) {
  if (!chartOfAccountsId) return null;
  const result = await prisma.journalLine.aggregate({
    where: { accountId: chartOfAccountsId, journal: { status: "POSTED", date: { lte: throughDate } } },
    _sum: { debit: true, credit: true },
  });
  return round2(Number(result._sum.debit || 0) - Number(result._sum.credit || 0));
}

export async function GET(request: NextRequest) {
  try {
    await requirePermission("accounts.read");
    const requestedId = request.nextUrl.searchParams.get("bankAccountId");
    const accounts = await prisma.bankAccount.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      include: { chartOfAccounts: { select: { id: true, code: true, name: true } } },
    });
    const selected = accounts.find((row) => row.id === requestedId) || accounts[0] || null;
    const ledgerAccounts = await prisma.chartOfAccounts.findMany({
      where: { isActive: true, type: "ASSET", children: { none: {} } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    });
    if (!selected) return NextResponse.json({ ok: true, accounts: [], ledgerAccounts, transactions: [], reconciliations: [], payments: [] });

    const [transactions, reconciliations, payments] = await Promise.all([
      prisma.bankTransaction.findMany({ where: { bankAccountId: selected.id }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 500 }),
      prisma.reconciliation.findMany({ where: { bankAccountId: selected.id }, orderBy: { periodEnd: "desc" }, take: 20 }),
      prisma.payment.findMany({
        where: { status: { notIn: ["FAILED", "CANCELLED", "REVERSED"] } },
        orderBy: { date: "desc" },
        take: 500,
        include: { customer: { select: { name: true } }, supplier: { select: { name: true } } },
      }),
    ]);
    const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
    const usedPayments = new Set(transactions.map((row) => row.matchedPaymentId).filter(Boolean));
    const availablePayments = payments.filter((payment) => !usedPayments.has(payment.id));
    const lastStatementBalance = transactions.find((row) => row.statementBalance !== null)?.statementBalance;
    const throughDate = transactions[0]?.date || new Date();
    const bookBalance = await ledgerBalance(selected.chartOfAccountsId, throughDate);

    return NextResponse.json({
      ok: true,
      accounts: accounts.map((row) => ({ ...row, openingBalance: Number(row.openingBalance), accountNumber: row.accountNumber ? `••••${row.accountNumber.slice(-4)}` : "" })),
      selectedAccountId: selected.id,
      ledgerAccounts,
      balances: { statement: lastStatementBalance === undefined ? null : Number(lastStatementBalance), book: bookBalance },
      payments: availablePayments.map((row) => ({ id: row.id, code: row.code, date: row.date.toISOString().slice(0, 10), amount: Number(row.amount), type: row.type, party: row.customer?.name || row.supplier?.name || "", reference: row.referenceNumber || "" })),
      transactions: transactions.map((row) => {
        const matched = row.matchedPaymentId ? paymentById.get(row.matchedPaymentId) : null;
        const suggestions = row.matchStatus === "UNMATCHED"
          ? availablePayments
              .filter((payment) => Math.abs(Number(payment.amount) - Math.abs(Number(row.amount))) <= 0.01 && directionMatches(Number(row.amount), payment.type))
              .map((payment) => {
                const dayGap = Math.abs(payment.date.getTime() - row.date.getTime()) / 86_400_000;
                const referenceMatch = [payment.code, payment.referenceNumber || ""].some((value) => value && `${row.description} ${row.referenceNumber || ""}`.toLowerCase().includes(value.toLowerCase()));
                return { id: payment.id, code: payment.code, date: payment.date.toISOString().slice(0, 10), amount: Number(payment.amount), type: payment.type, party: payment.customer?.name || payment.supplier?.name || "", score: (dayGap < 1 ? 25 : dayGap <= 5 ? 10 : 0) + (referenceMatch ? 35 : 0) + 40 };
              })
              .sort((a, b) => b.score - a.score)
              .slice(0, 3)
          : [];
        return {
          ...row,
          date: row.date.toISOString().slice(0, 10),
          amount: Number(row.amount),
          statementBalance: row.statementBalance === null ? null : Number(row.statementBalance),
          matchedPayment: matched ? { id: matched.id, code: matched.code, amount: Number(matched.amount) } : null,
          suggestions,
        };
      }),
      reconciliations: reconciliations.map((row) => ({ ...row, periodStart: row.periodStart.toISOString().slice(0, 10), periodEnd: row.periodEnd.toISOString().slice(0, 10), statementBalance: Number(row.statementBalance), bookBalance: Number(row.bookBalance), difference: Number(row.difference) })),
    });
  } catch (error) {
    const result = responseStatus(error);
    return NextResponse.json({ ok: false, error: result.message }, { status: result.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requirePermission("accounts.write");
    const form = await request.formData();
    const file = form.get("file");
    const bankAccountId = String(form.get("bankAccountId") || "");
    const mode = String(form.get("mode") || "preview");
    const confirmation = String(form.get("confirmation") || "");
    if (!(file instanceof File)) throw new Error("Select a bank CSV or Excel statement");
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) throw new Error("Only .csv, .xlsx, and .xls statements are supported");
    if (!file.size || file.size > MAX_FILE_BYTES) throw new Error("Statement file must be between 1 byte and 5 MB");
    const bankAccount = await prisma.bankAccount.findFirst({ where: { id: bankAccountId, isActive: true } });
    if (!bankAccount) throw new Error("Select an active bank account");

    const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error("The statement does not contain a readable worksheet");
    const sourceRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
    if (!sourceRows.length) throw new Error("The statement has no transaction rows");
    if (sourceRows.length > MAX_ROWS) throw new Error(`A single statement is limited to ${MAX_ROWS} rows`);
    const rows = parseBankStatementRows(sourceRows, bankAccount.id);
    const [existingRows, closedPeriods] = await Promise.all([
      prisma.bankTransaction.findMany({ where: { fingerprint: { in: rows.map((row) => row.fingerprint) } }, select: { fingerprint: true } }),
      prisma.reconciliation.findMany({ where: { bankAccountId: bankAccount.id, status: "COMPLETED" }, select: { periodStart: true, periodEnd: true } }),
    ]);
    const existing = new Set(existingRows.map((row) => row.fingerprint));
    for (const row of rows) {
      const transactionDate = row.date ? new Date(`${row.date}T12:00:00Z`) : null;
      if (transactionDate && closedPeriods.some((period) => transactionDate >= period.periodStart && transactionDate <= period.periodEnd)) {
        row.errors.push("Transaction date belongs to a completed reconciliation period");
      }
    }
    const preview = rows.map((row) => ({ ...row, action: row.errors.length ? "INVALID" : existing.has(row.fingerprint) ? "DUPLICATE" : "IMPORT" }));
    const summary = {
      received: preview.length,
      valid: preview.filter((row) => !row.errors.length).length,
      invalid: preview.filter((row) => row.errors.length).length,
      duplicates: preview.filter((row) => row.action === "DUPLICATE").length,
      willImport: preview.filter((row) => row.action === "IMPORT").length,
      totalDeposits: round2(preview.filter((row) => row.amount > 0 && !row.errors.length).reduce((sum, row) => sum + row.amount, 0)),
      totalWithdrawals: round2(Math.abs(preview.filter((row) => row.amount < 0 && !row.errors.length).reduce((sum, row) => sum + row.amount, 0))),
    };
    if (mode === "preview") return NextResponse.json({ ok: true, mode, bankAccount: { id: bankAccount.id, code: bankAccount.code, name: bankAccount.name }, fileName: file.name, summary, rows: preview.slice(0, 500) });
    if (mode !== "commit") throw new Error("Unsupported import mode");
    if (confirmation !== "IMPORT STATEMENT") throw new Error("Type IMPORT STATEMENT to confirm");
    if (summary.invalid) throw new Error(`Fix ${summary.invalid} invalid statement row(s) before importing`);

    await prisma.$transaction(async (tx) => {
      for (const row of preview.filter((item) => item.action === "IMPORT")) {
        await tx.bankTransaction.upsert({
          where: { fingerprint: row.fingerprint },
          update: {},
          create: {
            code: `BST-${row.fingerprint.slice(0, 20).toUpperCase()}`,
            bankAccountId: bankAccount.id,
            date: new Date(`${row.date}T00:00:00Z`),
            type: row.type,
            description: row.description,
            amount: row.amount,
            currency: bankAccount.currency,
            referenceNumber: row.referenceNumber || null,
            fingerprint: row.fingerprint,
            statementBalance: row.statementBalance,
            sourceFile: file.name,
          },
        });
      }
      const dbUser = await tx.user.findUnique({ where: { email: user.email } });
      if (!dbUser) throw new Error("Authenticated user no longer exists");
      await tx.auditLog.create({ data: { action: "IMPORT", entityType: "BANK_STATEMENT", entityId: bankAccount.id, entityCode: file.name, description: `Imported bank statement for ${bankAccount.code}`, changes: JSON.stringify(summary), userId: dbUser.id } });
    }, { timeout: 30_000 });
    return NextResponse.json({ ok: true, mode, message: `Imported ${summary.willImport} new bank transaction(s)`, summary });
  } catch (error) {
    const result = responseStatus(error);
    return NextResponse.json({ ok: false, error: result.message }, { status: result.status });
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("configure"), bankAccountId: z.string().min(1), chartOfAccountsId: z.string().min(1) }),
  z.object({ action: z.literal("match"), transactionId: z.string().min(1), paymentId: z.string().min(1) }),
  z.object({ action: z.literal("review"), transactionId: z.string().min(1), notes: z.string().trim().min(5) }),
  z.object({ action: z.literal("unmatch"), transactionId: z.string().min(1) }),
  z.object({ action: z.literal("reconcile"), bankAccountId: z.string().min(1), periodStart: z.string().min(8), periodEnd: z.string().min(8), statementBalance: z.coerce.number().finite(), notes: z.string().trim().optional().default("") }),
]);

export async function PATCH(request: NextRequest) {
  try {
    const body = actionSchema.parse(await request.json());
    if (body.action === "configure") {
      await requirePermission("settings.manage");
      const account = await prisma.chartOfAccounts.findFirst({ where: { id: body.chartOfAccountsId, isActive: true, type: "ASSET" } });
      if (!account) throw new Error("Select an active asset ledger account");
      await prisma.bankAccount.update({ where: { id: body.bankAccountId }, data: { chartOfAccountsId: account.id } });
      return NextResponse.json({ ok: true, message: `Bank account linked to ${account.code} — ${account.name}` });
    }

    const user = await requirePermission(body.action === "reconcile" ? "post.approve" : "accounts.write");
    if (body.action === "match") {
      const [transaction, payment, alreadyUsed] = await Promise.all([
        prisma.bankTransaction.findUnique({ where: { id: body.transactionId } }),
        prisma.payment.findUnique({ where: { id: body.paymentId } }),
        prisma.bankTransaction.findFirst({ where: { matchedPaymentId: body.paymentId, id: { not: body.transactionId } } }),
      ]);
      if (!transaction || !payment) throw new Error("Bank transaction or payment was not found");
      if (transaction.isReconciled) throw new Error("A reconciled transaction cannot be changed");
      if (alreadyUsed) throw new Error("That payment is already matched to another bank transaction");
      if (Math.abs(Math.abs(Number(transaction.amount)) - Number(payment.amount)) > 0.01) throw new Error("Bank transaction and payment amounts do not match");
      if (!directionMatches(Number(transaction.amount), payment.type)) throw new Error("Payment direction does not match the bank transaction");
      const updated = await prisma.bankTransaction.update({ where: { id: transaction.id }, data: { matchStatus: "MATCHED", matchedPaymentId: payment.id, matchedInvoiceId: payment.invoiceId, matchedBillId: payment.billId, matchedBy: user.email, matchedAt: new Date(), matchNotes: `Matched to ${payment.code}` } });
      return NextResponse.json({ ok: true, transactionId: updated.id, message: `Matched to ${payment.code}` });
    }
    if (body.action === "review") {
      const existing = await prisma.bankTransaction.findUnique({ where: { id: body.transactionId }, select: { isReconciled: true } });
      if (!existing) throw new Error("Bank transaction was not found");
      if (existing.isReconciled) throw new Error("A reconciled transaction cannot be changed");
      const updated = await prisma.bankTransaction.update({ where: { id: body.transactionId }, data: { matchStatus: "REVIEWED", matchedPaymentId: null, matchedInvoiceId: null, matchedBillId: null, matchedBy: user.email, matchedAt: new Date(), matchNotes: body.notes } });
      return NextResponse.json({ ok: true, transactionId: updated.id, message: "Transaction marked as manually reviewed" });
    }
    if (body.action === "unmatch") {
      const existing = await prisma.bankTransaction.findUnique({ where: { id: body.transactionId }, select: { isReconciled: true } });
      if (!existing) throw new Error("Bank transaction was not found");
      if (existing.isReconciled) throw new Error("A reconciled transaction cannot be changed");
      const updated = await prisma.bankTransaction.update({ where: { id: body.transactionId }, data: { matchStatus: "UNMATCHED", matchedPaymentId: null, matchedInvoiceId: null, matchedBillId: null, matchedJournalId: null, matchedBy: null, matchedAt: null, matchNotes: null } });
      return NextResponse.json({ ok: true, transactionId: updated.id, message: "Match removed" });
    }

    const periodStart = new Date(`${body.periodStart}T00:00:00Z`);
    const periodEnd = new Date(`${body.periodEnd}T23:59:59.999Z`);
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || periodStart > periodEnd) throw new Error("Enter a valid reconciliation period");
    const bankAccount = await prisma.bankAccount.findUnique({ where: { id: body.bankAccountId } });
    if (!bankAccount?.chartOfAccountsId) throw new Error("Link this bank account to its General Ledger account first");
    const overlap = await prisma.reconciliation.findFirst({ where: { bankAccountId: bankAccount.id, status: "COMPLETED", periodStart: { lte: periodEnd }, periodEnd: { gte: periodStart } } });
    if (overlap) throw new Error("This period overlaps an already completed reconciliation");
    const transactions = await prisma.bankTransaction.findMany({ where: { bankAccountId: bankAccount.id, date: { gte: periodStart, lte: periodEnd }, isReconciled: false } });
    if (!transactions.length) throw new Error("No unreconciled statement transactions exist in this period");
    const unmatched = transactions.filter((row) => !["MATCHED", "REVIEWED"].includes(row.matchStatus));
    if (unmatched.length) throw new Error(`${unmatched.length} statement transaction(s) still need matching or manual review`);
    const bookBalance = await ledgerBalance(bankAccount.chartOfAccountsId, periodEnd);
    if (bookBalance === null) throw new Error("General Ledger balance is unavailable");
    const difference = round2(body.statementBalance - bookBalance);
    if (Math.abs(difference) > 0.01) throw new Error(`Reconciliation difference is K${difference.toFixed(2)}. Complete missing book entries before closing.`);

    const reconciliation = await prisma.$transaction(async (tx) => {
      const created = await tx.reconciliation.create({ data: { bankAccountId: bankAccount.id, periodStart, periodEnd, statementBalance: body.statementBalance, bookBalance, difference, status: "COMPLETED", notes: body.notes || null, preparedBy: user.email, reviewedBy: user.email, reviewedAt: new Date() } });
      await tx.bankTransaction.updateMany({ where: { id: { in: transactions.map((row) => row.id) } }, data: { isReconciled: true, reconciliationId: created.id } });
      const dbUser = await tx.user.findUnique({ where: { email: user.email } });
      if (dbUser) await tx.auditLog.create({ data: { action: "RECONCILE", entityType: "BankAccount", entityId: bankAccount.id, entityCode: bankAccount.code, description: `Completed bank reconciliation ${body.periodStart} to ${body.periodEnd}`, changes: JSON.stringify({ statementBalance: body.statementBalance, bookBalance, difference, transactionCount: transactions.length }), userId: dbUser.id } });
      return created;
    });
    return NextResponse.json({ ok: true, reconciliationId: reconciliation.id, message: "Bank reconciliation completed", difference });
  } catch (error) {
    const result = responseStatus(error);
    return NextResponse.json({ ok: false, error: result.message }, { status: result.status });
  }
}
