import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import { buildFinancialStatements } from "@/lib/accounting/financial-statements";
import { pngToday } from "@/lib/accounting/period-close";
import { createDatabaseBackup } from "@/lib/system/database-backup";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type RecoveryKind = "SALES_INVOICE" | "SUPPLIER_BILL" | "CUSTOMER_RECEIPT" | "SUPPLIER_PAYMENT" | "OPENING_AR" | "OPENING_AP";
export type RecoveryState = "READY" | "RECOVERED" | "MANUAL";

export type SubledgerRecoveryCandidate = {
  id: string;
  kind: RecoveryKind;
  state: RecoveryState;
  eligible: boolean;
  confidence: number;
  journalId: string;
  journalCode: string;
  journalDate: string;
  reference: string | null;
  description: string;
  partyId: string | null;
  partyCode: string | null;
  partyName: string | null;
  linkedDocumentCode: string | null;
  total: number;
  subtotal: number;
  taxTotal: number;
  accountCodes: string[];
  reasons: string[];
};

export type SubledgerRecoveryPreview = {
  generatedAt: string;
  candidates: SubledgerRecoveryCandidate[];
  summary: {
    ready: number;
    recovered: number;
    manual: number;
    recoverableValue: number;
    manualArOpening: number;
    manualApOpening: number;
  };
  controls: {
    receivables: { glBalance: number; subledgerBalance: number; difference: number };
    payables: { glBalance: number; subledgerBalance: number; difference: number };
  };
};

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const STOP_WORDS = new Set(["and", "the", "ltd", "limited", "group", "png", "pom", "pty", "inc", "company", "services", "partner", "regional"]);

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function significantTokens(value: string) {
  return [...new Set(normalized(value).split(/\s+/).filter((token) => token.length >= 3 && !STOP_WORDS.has(token)))];
}

function partyScore(text: string, party: { code: string; name: string; legalName: string | null }) {
  const haystack = normalized(text);
  const names = [party.name, party.legalName || "", party.code].filter(Boolean);
  let best = 0;
  for (const name of names) {
    const exact = normalized(name);
    if (exact && haystack.includes(exact)) best = Math.max(best, 1);
    const tokens = significantTokens(name);
    if (!tokens.length) continue;
    const matched = tokens.filter((token) => haystack.includes(token)).length;
    best = Math.max(best, matched / tokens.length);
  }
  return best;
}

function bestParty<T extends { id: string; code: string; name: string; legalName: string | null }>(text: string, parties: T[]) {
  const ranked = parties.map((party) => ({ party, score: partyScore(text, party) })).sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  const runnerUp = ranked[1];
  if (!winner || winner.score < 0.5 || (runnerUp && winner.score === runnerUp.score)) return null;
  return { ...winner.party, score: Math.round(winner.score * 100) };
}

function documentCode(kind: "INVOICE" | "BILL", text: string) {
  const patterns = kind === "INVOICE"
    ? [
        /\b(?:IN|SI)-\d{5}-\d{4}\b/i,
        /\b(?:INV|SINV)-\d{4}-\d{4,}\b/i,
      ]
    : [
        /\bBI-\d{5}-\d{4}\b/i,
        /\bBILL-\d{4}-\d{4,}\b/i,
      ];
  for (const pattern of patterns) {
    const match = text.match(pattern)?.[0];
    if (match) return match.toUpperCase();
  }
  return null;
}

function dueDate(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + Math.max(0, days));
  return result;
}

export async function buildSubledgerRecoveryPreview(client: DbClient = prisma): Promise<SubledgerRecoveryPreview> {
  const [journals, customers, suppliers, invoices, bills, payments, statements] = await Promise.all([
    client.journalHeader.findMany({
      where: { status: "POSTED", sourceDocType: { in: ["OPENING", "INVOICE", "BILL", "PAYMENT"] } },
      orderBy: [{ date: "asc" }, { code: "asc" }],
      include: { lines: { orderBy: { lineNo: "asc" }, include: { account: { select: { code: true, name: true, type: true } } } } },
    }),
    client.customer.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, legalName: true, paymentTerms: true } }),
    client.supplier.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, legalName: true, paymentTerms: true } }),
    client.invoice.findMany({ select: { id: true, code: true, journalId: true, customerId: true, total: true } }),
    client.supplierBill.findMany({ select: { id: true, code: true, journalId: true, supplierId: true, total: true } }),
    client.payment.findMany({ select: { id: true, code: true, invoiceId: true, billId: true } }),
    buildFinancialStatements({ from: "1900-01-01", asOf: pngToday() }, client as PrismaClient),
  ]);

  const invoiceByCode = new Map(invoices.map((row) => [row.code.toUpperCase(), row]));
  const billByCode = new Map(bills.map((row) => [row.code.toUpperCase(), row]));
  const invoiceByJournal = new Map(invoices.filter((row) => row.journalId).map((row) => [row.journalId!, row]));
  const billByJournal = new Map(bills.filter((row) => row.journalId).map((row) => [row.journalId!, row]));
  const paymentByCode = new Map(payments.map((row) => [row.code.toUpperCase(), row]));
  const candidates: SubledgerRecoveryCandidate[] = [];

  for (const journal of journals) {
    const text = [journal.code, journal.reference || "", journal.description, ...journal.lines.map((line) => line.description)].join(" ");
    const arLines = journal.lines.filter((line) => line.account.code.startsWith("113"));
    const apLines = journal.lines.filter((line) => line.account.code.startsWith("211"));
    const arMovement = round(arLines.reduce((sum, line) => sum + Number(line.debit) - Number(line.credit), 0));
    const apMovement = round(apLines.reduce((sum, line) => sum + Number(line.credit) - Number(line.debit), 0));
    const accountCodes = [...new Set(journal.lines.map((line) => line.account.code))];
    const base = {
      journalId: journal.id,
      journalCode: journal.code,
      journalDate: journal.date.toISOString().slice(0, 10),
      reference: journal.reference,
      description: journal.description,
      accountCodes,
    };

    if (journal.sourceDocType === "OPENING") {
      if (arMovement > 0) candidates.push({ id: `OPENING_AR:${journal.id}`, kind: "OPENING_AR", state: "MANUAL", eligible: false, confidence: 0, ...base, partyId: null, partyCode: null, partyName: null, linkedDocumentCode: null, total: arMovement, subtotal: arMovement, taxTotal: 0, reasons: ["Opening AR has no customer-level allocation in the posted journal", "Import an aged receivables schedule before recovery"] });
      if (apMovement > 0) candidates.push({ id: `OPENING_AP:${journal.id}`, kind: "OPENING_AP", state: "MANUAL", eligible: false, confidence: 0, ...base, partyId: null, partyCode: null, partyName: null, linkedDocumentCode: null, total: apMovement, subtotal: apMovement, taxTotal: 0, reasons: ["Opening AP has no supplier-level allocation in the posted journal", "Import an aged payables schedule before recovery"] });
      continue;
    }

    if (journal.sourceDocType === "INVOICE" && arMovement > 0) {
      const code = documentCode("INVOICE", text) || journal.code;
      const existing = invoiceByJournal.get(journal.id) || invoiceByCode.get(code.toUpperCase());
      const linkedLineParty = arLines.find((line) => line.customerId)?.customerId;
      const party = linkedLineParty ? customers.find((row) => row.id === linkedLineParty) || null : bestParty(text, customers);
      const taxTotal = round(journal.lines.filter((line) => /gst output/i.test(`${line.account.name} ${line.description}`)).reduce((sum, line) => sum + Number(line.credit) - Number(line.debit), 0));
      const ready = Boolean(party) && !existing;
      candidates.push({ id: `SALES_INVOICE:${journal.id}`, kind: "SALES_INVOICE", state: existing ? "RECOVERED" : ready ? "READY" : "MANUAL", eligible: ready, confidence: existing ? 100 : party ? Math.max(90, Math.round(partyScore(text, party) * 100)) : 0, ...base, partyId: party?.id || null, partyCode: party?.code || null, partyName: party?.name || null, linkedDocumentCode: code, total: arMovement, subtotal: round(arMovement - taxTotal), taxTotal, reasons: existing ? [`Invoice ${existing.code} already exists`] : party ? ["Posted invoice journal and AR debit agree", `Unique customer match: ${party.name}`, taxTotal ? "GST output was identified from the journal" : "No GST output line was identified"] : ["A unique customer could not be matched"] });
      continue;
    }

    if (journal.sourceDocType === "BILL" && apMovement > 0) {
      const code = documentCode("BILL", text) || journal.code;
      const existing = billByJournal.get(journal.id) || billByCode.get(code.toUpperCase());
      const linkedLineParty = apLines.find((line) => line.supplierId)?.supplierId;
      const party = linkedLineParty ? suppliers.find((row) => row.id === linkedLineParty) || null : bestParty(text, suppliers);
      const taxTotal = round(journal.lines.filter((line) => /gst input/i.test(`${line.account.name} ${line.description}`)).reduce((sum, line) => sum + Number(line.debit) - Number(line.credit), 0));
      const ready = Boolean(party) && !existing;
      candidates.push({ id: `SUPPLIER_BILL:${journal.id}`, kind: "SUPPLIER_BILL", state: existing ? "RECOVERED" : ready ? "READY" : "MANUAL", eligible: ready, confidence: existing ? 100 : party ? Math.max(90, Math.round(partyScore(text, party) * 100)) : 0, ...base, partyId: party?.id || null, partyCode: party?.code || null, partyName: party?.name || null, linkedDocumentCode: code, total: apMovement, subtotal: round(apMovement - taxTotal), taxTotal, reasons: existing ? [`Supplier bill ${existing.code} already exists`] : party ? ["Posted bill journal and AP credit agree", `Unique supplier match: ${party.name}`, taxTotal ? "GST input was identified from the journal" : "No GST input line was identified"] : ["A unique supplier could not be matched"] });
      continue;
    }

    if (journal.sourceDocType === "PAYMENT" && arMovement < 0) {
      const linkedCode = documentCode("INVOICE", text);
      const sourceCandidate = linkedCode ? candidates.find((row) => row.kind === "SALES_INVOICE" && row.linkedDocumentCode === linkedCode) : null;
      const existingInvoice = linkedCode ? invoiceByCode.get(linkedCode) : null;
      const party = existingInvoice ? customers.find((row) => row.id === existingInvoice.customerId) : sourceCandidate?.partyId ? customers.find((row) => row.id === sourceCandidate.partyId) : bestParty(text, customers);
      const existing = paymentByCode.get(journal.code.toUpperCase());
      const ready = Boolean(linkedCode && party && (existingInvoice || sourceCandidate?.eligible || sourceCandidate?.state === "RECOVERED")) && !existing;
      candidates.push({ id: `CUSTOMER_RECEIPT:${journal.id}`, kind: "CUSTOMER_RECEIPT", state: existing ? "RECOVERED" : ready ? "READY" : "MANUAL", eligible: ready, confidence: existing ? 100 : ready ? 95 : 0, ...base, partyId: party?.id || null, partyCode: party?.code || null, partyName: party?.name || null, linkedDocumentCode: linkedCode, total: Math.abs(arMovement), subtotal: Math.abs(arMovement), taxTotal: 0, reasons: existing ? [`Payment ${existing.code} already exists`] : ready ? [`AR credit links to ${linkedCode}`, `Customer inherited from the linked invoice`] : ["A unique linked invoice and customer could not be established"] });
      continue;
    }

    if (journal.sourceDocType === "PAYMENT" && apMovement < 0) {
      const linkedCode = documentCode("BILL", text);
      const sourceCandidate = linkedCode ? candidates.find((row) => row.kind === "SUPPLIER_BILL" && row.linkedDocumentCode === linkedCode) : null;
      const existingBill = linkedCode ? billByCode.get(linkedCode) : null;
      const party = existingBill ? suppliers.find((row) => row.id === existingBill.supplierId) : sourceCandidate?.partyId ? suppliers.find((row) => row.id === sourceCandidate.partyId) : bestParty(text, suppliers);
      const existing = paymentByCode.get(journal.code.toUpperCase());
      const ready = Boolean(linkedCode && party && (existingBill || sourceCandidate?.eligible || sourceCandidate?.state === "RECOVERED")) && !existing;
      candidates.push({ id: `SUPPLIER_PAYMENT:${journal.id}`, kind: "SUPPLIER_PAYMENT", state: existing ? "RECOVERED" : ready ? "READY" : "MANUAL", eligible: ready, confidence: existing ? 100 : ready ? 95 : 0, ...base, partyId: party?.id || null, partyCode: party?.code || null, partyName: party?.name || null, linkedDocumentCode: linkedCode, total: Math.abs(apMovement), subtotal: Math.abs(apMovement), taxTotal: 0, reasons: existing ? [`Payment ${existing.code} already exists`] : ready ? [`AP debit links to ${linkedCode}`, `Supplier inherited from the linked bill`] : ["A unique linked bill and supplier could not be established"] });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    candidates,
    summary: {
      ready: candidates.filter((row) => row.state === "READY").length,
      recovered: candidates.filter((row) => row.state === "RECOVERED").length,
      manual: candidates.filter((row) => row.state === "MANUAL").length,
      recoverableValue: round(candidates.filter((row) => row.state === "READY").reduce((sum, row) => sum + row.total, 0)),
      manualArOpening: round(candidates.filter((row) => row.kind === "OPENING_AR").reduce((sum, row) => sum + row.total, 0)),
      manualApOpening: round(candidates.filter((row) => row.kind === "OPENING_AP").reduce((sum, row) => sum + row.total, 0)),
    },
    controls: {
      receivables: { glBalance: statements.controls.receivables.glBalance, subledgerBalance: statements.controls.receivables.subledgerBalance, difference: statements.controls.receivables.difference },
      payables: { glBalance: statements.controls.payables.glBalance, subledgerBalance: statements.controls.payables.subledgerBalance, difference: statements.controls.payables.difference },
    },
  };
}

type BackupCreator = (options: { createdBy: string; reason: string }) => Promise<{ fileName: string }>;

export async function applySubledgerRecovery(
  input: { candidateIds: string[]; confirmation: string; actorEmail: string; ipAddress?: string | null },
  client: PrismaClient = prisma,
  backupCreator: BackupCreator = createDatabaseBackup,
) {
  const selectedIds = [...new Set(input.candidateIds)];
  if (!selectedIds.length || selectedIds.length > 100) throw new Error("Select between 1 and 100 recovery candidates");
  const expectedConfirmation = `RECOVER ${selectedIds.length} SUBLEDGER RECORDS`;
  if (input.confirmation !== expectedConfirmation) throw new Error(`Type ${expectedConfirmation} to confirm`);
  const initial = await buildSubledgerRecoveryPreview(client);
  const selected = selectedIds.map((id) => initial.candidates.find((row) => row.id === id));
  if (selected.some((row) => !row || !row.eligible || row.state !== "READY")) throw new Error("One or more selected candidates are no longer eligible");
  const selectedRows = selected as SubledgerRecoveryCandidate[];
  for (const row of selectedRows.filter((item) => item.kind === "CUSTOMER_RECEIPT" || item.kind === "SUPPLIER_PAYMENT")) {
    const dependencyKind = row.kind === "CUSTOMER_RECEIPT" ? "SALES_INVOICE" : "SUPPLIER_BILL";
    const dependency = initial.candidates.find((item) => item.kind === dependencyKind && item.linkedDocumentCode === row.linkedDocumentCode);
    if (dependency?.state === "READY" && !selectedIds.includes(dependency.id)) throw new Error(`${row.journalCode} requires ${dependency.linkedDocumentCode} to be selected`);
  }

  const backup = await backupCreator({ createdBy: input.actorEmail, reason: `Before subledger recovery of ${selectedIds.length} record(s)` });
  const result = await client.$transaction(async (tx) => {
    const fresh = await buildSubledgerRecoveryPreview(tx);
    const rows = selectedIds.map((id) => fresh.candidates.find((candidate) => candidate.id === id));
    if (rows.some((row) => !row?.eligible || row.state !== "READY")) throw new Error("Recovery candidates changed after backup; no records were recovered");
    const actor = await tx.user.findUnique({ where: { email: input.actorEmail } });
    if (!actor) throw new Error("Authenticated user no longer exists");
    const created: Array<{ kind: RecoveryKind; id: string; code: string }> = [];

    for (const row of rows.filter((candidate) => candidate?.kind === "SALES_INVOICE") as SubledgerRecoveryCandidate[]) {
      const customer = await tx.customer.findUnique({ where: { id: row.partyId! } });
      if (!customer) throw new Error(`Customer for ${row.journalCode} no longer exists`);
      const journal = await tx.journalHeader.findUnique({ where: { id: row.journalId }, include: { lines: { include: { account: true } } } });
      if (!journal || journal.status !== "POSTED") throw new Error(`Posted journal ${row.journalCode} no longer exists`);
      const revenueAccount = journal.lines.find((line) => line.account.type === "REVENUE")?.account.code || null;
      const saved = await tx.invoice.create({ data: {
        code: row.linkedDocumentCode!, customerId: customer.id, issuedDate: journal.date, dueDate: dueDate(journal.date, customer.paymentTerms), status: "SENT", currency: journal.currency,
        exchangeRate: journal.exchangeRate, subtotal: row.subtotal, taxTotal: row.taxTotal, total: row.total, outstanding: row.total,
        notes: `Recovered from posted journal ${journal.code}; no duplicate GL posting created.`, journalId: journal.id, glPosted: true, createdBy: input.actorEmail, approvedBy: input.actorEmail, approvedAt: new Date(),
        lines: { create: { lineNo: 1, description: `Recovered detail from ${journal.code}`, quantity: 1, unitPrice: row.subtotal, taxRate: row.subtotal ? round(row.taxTotal / row.subtotal * 100) : 0, taxAmount: row.taxTotal, amount: row.subtotal, revenueAccount } },
      } });
      created.push({ kind: row.kind, id: saved.id, code: saved.code });
    }

    for (const row of rows.filter((candidate) => candidate?.kind === "SUPPLIER_BILL") as SubledgerRecoveryCandidate[]) {
      const supplier = await tx.supplier.findUnique({ where: { id: row.partyId! } });
      if (!supplier) throw new Error(`Supplier for ${row.journalCode} no longer exists`);
      const journal = await tx.journalHeader.findUnique({ where: { id: row.journalId }, include: { lines: { include: { account: true } } } });
      if (!journal || journal.status !== "POSTED") throw new Error(`Posted journal ${row.journalCode} no longer exists`);
      const costAccount = journal.lines.find((line) => Number(line.debit) > 0 && !line.account.code.startsWith("211") && !/gst input/i.test(line.account.name))?.account.code || null;
      const saved = await tx.supplierBill.create({ data: {
        code: row.linkedDocumentCode!, supplierId: supplier.id, billDate: journal.date, dueDate: dueDate(journal.date, supplier.paymentTerms), status: "SENT", currency: journal.currency,
        exchangeRate: journal.exchangeRate, subtotal: row.subtotal, taxTotal: row.taxTotal, total: row.total, outstanding: row.total,
        notes: `Recovered from posted journal ${journal.code}; no duplicate GL posting created.`, journalId: journal.id, glPosted: true, createdBy: input.actorEmail, approvedBy: input.actorEmail, approvedAt: new Date(),
        lines: { create: { lineNo: 1, description: `Recovered detail from ${journal.code}`, quantity: 1, unitPrice: row.subtotal, taxRate: row.subtotal ? round(row.taxTotal / row.subtotal * 100) : 0, taxAmount: row.taxTotal, amount: row.subtotal, costAccount } },
      } });
      created.push({ kind: row.kind, id: saved.id, code: saved.code });
    }

    for (const row of rows.filter((candidate) => candidate?.kind === "CUSTOMER_RECEIPT") as SubledgerRecoveryCandidate[]) {
      const invoice = await tx.invoice.findUnique({ where: { code: row.linkedDocumentCode! } });
      if (!invoice || invoice.customerId !== row.partyId) throw new Error(`Linked invoice ${row.linkedDocumentCode} is unavailable`);
      const journal = await tx.journalHeader.findUnique({ where: { id: row.journalId }, include: { lines: { include: { account: true } } } });
      if (!journal || journal.status !== "POSTED") throw new Error(`Posted journal ${row.journalCode} no longer exists`);
      const bankCode = journal.lines.find((line) => Number(line.debit) > 0 && /^(111|112)/.test(line.account.code))?.account.code || null;
      const exchangeRate = Number(invoice.exchangeRate || journal.exchangeRate || 1);
      const baseAmount = round(row.total * exchangeRate);
      const saved = await tx.payment.create({ data: {
        code: journal.code,
        type: "CUSTOMER_RECEIPT",
        date: journal.date,
        amount: row.total,
        baseAmount,
        currency: journal.currency,
        exchangeRate,
        paymentMethod: "BANK",
        referenceAccount: bankCode,
        referenceNumber: journal.reference,
        status: "CLEARED",
        notes: `Recovered from posted journal ${journal.code}; no duplicate GL posting created.`,
        customerId: invoice.customerId,
        depositAccount: bankCode,
        clearanceDate: journal.date,
        journalId: journal.code,
        createdBy: input.actorEmail,
        approvedBy: input.actorEmail,
        approvedAt: new Date(),
      } });
      await tx.paymentAllocation.create({ data: {
        code: `MIG-ALLOC-${journal.code}`,
        paymentId: saved.id,
        invoiceId: invoice.id,
        allocationDate: journal.date,
        amount: row.total,
        baseAmount,
        currency: journal.currency,
        exchangeRate,
        realizedFx: 0,
        allocationType: "MIGRATED",
        status: "POSTED",
        journalId: journal.code,
        idempotencyKey: `MIGRATED:${journal.id}:${invoice.id}`,
        createdBy: input.actorEmail,
      } });
      const paid = round(Number(invoice.amountPaid) + row.total);
      const outstanding = round(Math.max(0, Number(invoice.total) - paid));
      const basePaid = round(Number(invoice.baseAmountPaid || 0) + baseAmount);
      const invoiceBaseTotal = Number(invoice.baseTotal || 0) > 0 ? Number(invoice.baseTotal) : round(Number(invoice.total) * exchangeRate);
      const baseOutstanding = round(Math.max(0, invoiceBaseTotal - basePaid));
      await tx.invoice.update({ where: { id: invoice.id }, data: {
        amountPaid: paid,
        outstanding,
        baseAmountPaid: basePaid,
        baseOutstanding,
        status: outstanding === 0 ? "PAID" : "PARTIAL",
        updatedBy: input.actorEmail,
      } });
      created.push({ kind: row.kind, id: saved.id, code: saved.code });
    }

    for (const row of rows.filter((candidate) => candidate?.kind === "SUPPLIER_PAYMENT") as SubledgerRecoveryCandidate[]) {
      const bill = await tx.supplierBill.findUnique({ where: { code: row.linkedDocumentCode! } });
      if (!bill || bill.supplierId !== row.partyId) throw new Error(`Linked bill ${row.linkedDocumentCode} is unavailable`);
      const journal = await tx.journalHeader.findUnique({ where: { id: row.journalId }, include: { lines: { include: { account: true } } } });
      if (!journal || journal.status !== "POSTED") throw new Error(`Posted journal ${row.journalCode} no longer exists`);
      const bankCode = journal.lines.find((line) => Number(line.credit) > 0 && /^(111|112)/.test(line.account.code))?.account.code || null;
      const exchangeRate = Number(bill.exchangeRate || journal.exchangeRate || 1);
      const baseAmount = round(row.total * exchangeRate);
      const saved = await tx.payment.create({ data: {
        code: journal.code,
        type: "SUPPLIER_PAYMENT",
        date: journal.date,
        amount: row.total,
        baseAmount,
        currency: journal.currency,
        exchangeRate,
        paymentMethod: "BANK",
        referenceAccount: bankCode,
        referenceNumber: journal.reference,
        status: "CLEARED",
        notes: `Recovered from posted journal ${journal.code}; no duplicate GL posting created.`,
        supplierId: bill.supplierId,
        depositAccount: bankCode,
        clearanceDate: journal.date,
        journalId: journal.code,
        createdBy: input.actorEmail,
        approvedBy: input.actorEmail,
        approvedAt: new Date(),
      } });
      await tx.paymentAllocation.create({ data: {
        code: `MIG-ALLOC-${journal.code}`,
        paymentId: saved.id,
        billId: bill.id,
        allocationDate: journal.date,
        amount: row.total,
        baseAmount,
        currency: journal.currency,
        exchangeRate,
        realizedFx: 0,
        allocationType: "MIGRATED",
        status: "POSTED",
        journalId: journal.code,
        idempotencyKey: `MIGRATED:${journal.id}:${bill.id}`,
        createdBy: input.actorEmail,
      } });
      const paid = round(Number(bill.amountPaid) + row.total);
      const outstanding = round(Math.max(0, Number(bill.total) - paid));
      const basePaid = round(Number(bill.baseAmountPaid || 0) + baseAmount);
      const billBaseTotal = Number(bill.baseTotal || 0) > 0 ? Number(bill.baseTotal) : round(Number(bill.total) * exchangeRate);
      const baseOutstanding = round(Math.max(0, billBaseTotal - basePaid));
      await tx.supplierBill.update({ where: { id: bill.id }, data: {
        amountPaid: paid,
        outstanding,
        baseAmountPaid: basePaid,
        baseOutstanding,
        status: outstanding === 0 ? "PAID" : "PARTIAL",
        updatedBy: input.actorEmail,
      } });
      created.push({ kind: row.kind, id: saved.id, code: saved.code });
    }

    await tx.auditLog.createMany({ data: created.map((item) => ({ action: "RECOVER", entityType: item.kind, entityId: item.id, entityCode: item.code, description: `Recovered ${item.kind.toLowerCase().replaceAll("_", " ")} from an existing posted GL journal`, changes: JSON.stringify({ backupFile: backup.fileName, glJournalCreated: false }), userId: actor.id, ipAddress: input.ipAddress || null })) });
    await tx.auditLog.create({ data: { action: "RECOVER", entityType: "SUBLEDGER_RECOVERY", entityCode: backup.fileName, description: `Recovered ${created.length} legacy subledger record(s) without changing the posted GL`, changes: JSON.stringify({ candidateIds: selectedIds, created, backupFile: backup.fileName }), userId: actor.id, ipAddress: input.ipAddress || null } });
    return created;
  }, { timeout: 30_000 });

  const after = await buildSubledgerRecoveryPreview(client);
  return { backupFile: backup.fileName, created: result, controls: after.controls, remainingManual: after.summary.manual };
}
