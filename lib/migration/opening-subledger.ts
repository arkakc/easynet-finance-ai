import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import { pngToday } from "@/lib/accounting/period-close";
import { createDatabaseBackup } from "@/lib/system/database-backup";

type DbClient = PrismaClient | Prisma.TransactionClient;
export type OpeningEntity = "ar" | "ap";

export type OpeningPosition = {
  entity: OpeningEntity;
  openingJournalId: string | null;
  openingJournalCode: string | null;
  recognitionDate: string | null;
  openingGlBalance: number;
  importedSubledger: number;
  remaining: number;
  supported: boolean;
  message: string;
};

export type OpeningScheduleRow = {
  rowNumber: number;
  documentCode: string;
  partyCode: string;
  partyId: string | null;
  partyName: string | null;
  originalDocumentDate: string;
  dueDate: string;
  outstanding: number;
  description: string;
  action: "CREATE" | "INVALID";
  errors: string[];
};

export type OpeningSchedulePreview = {
  entity: OpeningEntity;
  position: OpeningPosition;
  rows: OpeningScheduleRow[];
  summary: {
    received: number;
    valid: number;
    invalid: number;
    scheduleTotal: number;
    targetTotal: number;
    difference: number;
    ready: boolean;
  };
};

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function normalizedHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function pick(row: Record<string, unknown>, aliases: string[]) {
  const aliasSet = new Set(aliases.map(normalizedHeader));
  const entry = Object.entries(row).find(([key]) => aliasSet.has(normalizedHeader(key)));
  return entry?.[1];
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function amount(value: unknown) {
  const raw = text(value);
  if (!raw) return Number.NaN;
  const negative = /^\(.*\)$/.test(raw);
  const parsed = Number(raw.replace(/[(),K$\s]/gi, ""));
  return negative ? -parsed : parsed;
}

function dateText(value: unknown) {
  const raw = text(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const png = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  const candidate = iso ? raw : png ? `${png[3]}-${png[2].padStart(2, "0")}-${png[1].padStart(2, "0")}` : "";
  if (!candidate) return "";
  const parsed = new Date(`${candidate}T00:00:00+10:00`);
  return Number.isNaN(parsed.getTime()) || parsed.toLocaleDateString("en-CA", { timeZone: "Pacific/Port_Moresby" }) !== candidate ? "" : candidate;
}

function pngDate(value: string) {
  return new Date(`${value}T00:00:00+10:00`);
}

function sourceMarker(entity: OpeningEntity, journalId: string, documentCode: string) {
  return `OPENING_${entity.toUpperCase()}:${journalId}:${documentCode.toUpperCase()}`;
}

export async function getOpeningSubledgerPosition(entity: OpeningEntity, client: DbClient = prisma): Promise<OpeningPosition> {
  const prefix = entity === "ar" ? "113" : "211";
  const journals = await client.journalHeader.findMany({
    where: { status: "POSTED", sourceDocType: "OPENING", lines: { some: { account: { code: { startsWith: prefix } } } } },
    orderBy: [{ date: "asc" }, { code: "asc" }],
    include: { lines: { where: { account: { code: { startsWith: prefix } } }, include: { account: { select: { code: true } } } } },
  });
  const openingGlBalance = round(journals.reduce((journalSum, journal) => journalSum + journal.lines.reduce((lineSum, line) => lineSum + (entity === "ar" ? Number(line.debit) - Number(line.credit) : Number(line.credit) - Number(line.debit)), 0), 0));
  const journalIds = journals.map((journal) => journal.id);
  const imported = entity === "ar"
    ? await client.invoice.aggregate({ where: { journalId: { in: journalIds }, sourceDocId: { startsWith: "OPENING_AR:" }, glPosted: true, status: { notIn: ["CANCELLED", "VOID"] } }, _sum: { total: true } })
    : await client.supplierBill.aggregate({ where: { journalId: { in: journalIds }, sourceDocId: { startsWith: "OPENING_AP:" }, glPosted: true, status: { notIn: ["CANCELLED", "VOID"] } }, _sum: { total: true } });
  const importedSubledger = round(Number(imported._sum.total || 0));
  const remaining = round(openingGlBalance - importedSubledger);
  const supported = journals.length === 1 && openingGlBalance > 0 && remaining >= 0;
  const message = journals.length === 0
    ? `No posted opening ${entity.toUpperCase()} control journal was found`
    : journals.length > 1
      ? `Multiple opening ${entity.toUpperCase()} journals require manual consolidation before import`
      : remaining < 0
        ? `Imported opening ${entity.toUpperCase()} subledger exceeds its GL control balance`
        : remaining === 0
          ? `Opening ${entity.toUpperCase()} subledger is fully allocated`
          : `Allocate exactly K${remaining.toFixed(2)} against ${journals[0].code}`;
  return {
    entity,
    openingJournalId: journals.length === 1 ? journals[0].id : null,
    openingJournalCode: journals.length === 1 ? journals[0].code : null,
    recognitionDate: journals.length === 1 ? journals[0].date.toISOString().slice(0, 10) : null,
    openingGlBalance,
    importedSubledger,
    remaining,
    supported,
    message,
  };
}

export async function buildOpeningSchedulePreview(entity: OpeningEntity, sourceRows: Record<string, unknown>[], client: DbClient = prisma): Promise<OpeningSchedulePreview> {
  const [position, parties, existingCodes] = await Promise.all([
    getOpeningSubledgerPosition(entity, client),
    entity === "ar"
      ? client.customer.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true } })
      : client.supplier.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true } }),
    entity === "ar"
      ? client.invoice.findMany({ select: { code: true } })
      : client.supplierBill.findMany({ select: { code: true } }),
  ]);
  const partyByCode = new Map(parties.map((party) => [party.code.toLowerCase(), party]));
  const existing = new Set(existingCodes.map((row) => row.code.toLowerCase()));
  const seen = new Set<string>();
  const rows = sourceRows.map((source, index): OpeningScheduleRow => {
    const documentCode = text(pick(source, ["document code", "invoice number", "invoice no", "bill number", "bill no", "reference"]));
    const partyCode = text(pick(source, entity === "ar" ? ["customer code", "customer", "customer id", "card id"] : ["supplier code", "supplier", "supplier id", "vendor code", "card id"]));
    const originalDocumentDate = dateText(pick(source, ["original document date", "document date", "invoice date", "bill date", "date"]));
    const dueDate = dateText(pick(source, ["due date", "duedate"]));
    const outstanding = amount(pick(source, ["outstanding", "open amount", "balance due", "amount due", "balance"]));
    const description = text(pick(source, ["description", "memo", "notes"]));
    const party = partyByCode.get(partyCode.toLowerCase());
    const errors: string[] = [];
    const codeKey = documentCode.toLowerCase();
    if (!documentCode || documentCode.length > 50 || !/^[a-z0-9][a-z0-9._/-]*$/i.test(documentCode)) errors.push("Document code must be 1-50 letters, numbers, dots, slashes, underscores or hyphens");
    if (codeKey && seen.has(codeKey)) errors.push("Duplicate document code in this file");
    if (codeKey && existing.has(codeKey)) errors.push("Document code already exists in the subledger");
    if (!partyCode) errors.push(`${entity === "ar" ? "Customer" : "Supplier"} code is required`);
    else if (!party) errors.push(`${entity === "ar" ? "Customer" : "Supplier"} code was not found or is inactive`);
    if (!originalDocumentDate) errors.push("Original document date must use YYYY-MM-DD or DD/MM/YYYY");
    if (!dueDate) errors.push("Due date must use YYYY-MM-DD or DD/MM/YYYY");
    if (originalDocumentDate && position.recognitionDate && originalDocumentDate > position.recognitionDate) errors.push(`Original document date must be on or before ${position.recognitionDate}`);
    if (originalDocumentDate && dueDate && dueDate < originalDocumentDate) errors.push("Due date cannot be before the original document date");
    if (!Number.isFinite(outstanding) || outstanding <= 0 || outstanding > 100_000_000) errors.push("Outstanding must be greater than 0 and no more than K100,000,000");
    if (Number.isFinite(outstanding) && Math.abs(outstanding * 100 - Math.round(outstanding * 100)) > 0.001) errors.push("Outstanding must have no more than two decimal places");
    if (codeKey) seen.add(codeKey);
    return { rowNumber: index + 2, documentCode, partyCode, partyId: party?.id || null, partyName: party?.name || null, originalDocumentDate, dueDate, outstanding: Number.isFinite(outstanding) ? round(outstanding) : 0, description, action: errors.length ? "INVALID" : "CREATE", errors };
  });
  const validRows = rows.filter((row) => row.action === "CREATE");
  const scheduleTotal = round(validRows.reduce((sum, row) => sum + row.outstanding, 0));
  const difference = round(position.remaining - scheduleTotal);
  const invalid = rows.length - validRows.length;
  return {
    entity,
    position,
    rows,
    summary: {
      received: rows.length,
      valid: validRows.length,
      invalid,
      scheduleTotal,
      targetTotal: position.remaining,
      difference,
      ready: position.supported && position.remaining > 0 && rows.length > 0 && invalid === 0 && Math.abs(difference) < 0.01,
    },
  };
}

type BackupCreator = (options: { createdBy: string; reason: string }) => Promise<{ fileName: string }>;

export async function applyOpeningSchedule(
  input: { entity: OpeningEntity; sourceRows: Record<string, unknown>[]; confirmation: string; actorEmail: string; fileName: string; ipAddress?: string | null },
  client: PrismaClient = prisma,
  backupCreator: BackupCreator = createDatabaseBackup,
) {
  const initial = await buildOpeningSchedulePreview(input.entity, input.sourceRows, client);
  const expected = `IMPORT OPENING ${input.entity.toUpperCase()} K${initial.summary.targetTotal.toFixed(2)}`;
  if (input.confirmation !== expected) throw new Error(`Type ${expected} to confirm`);
  if (!initial.summary.ready) throw new Error(initial.summary.invalid ? `Fix ${initial.summary.invalid} invalid row(s) before importing` : `Schedule total must equal the remaining opening ${input.entity.toUpperCase()} balance of K${initial.summary.targetTotal.toFixed(2)}`);
  const backup = await backupCreator({ createdBy: input.actorEmail, reason: `Before opening ${input.entity.toUpperCase()} schedule import from ${input.fileName}` });
  const created = await client.$transaction(async (tx) => {
    const preview = await buildOpeningSchedulePreview(input.entity, input.sourceRows, tx);
    if (!preview.summary.ready || preview.position.openingJournalId !== initial.position.openingJournalId || preview.summary.targetTotal !== initial.summary.targetTotal) throw new Error("Opening balance position changed after backup; no rows were imported");
    const actor = await tx.user.findUnique({ where: { email: input.actorEmail } });
    if (!actor) throw new Error("Authenticated user no longer exists");
    const journal = await tx.journalHeader.findUnique({ where: { id: preview.position.openingJournalId! } });
    if (!journal || journal.status !== "POSTED" || journal.sourceDocType !== "OPENING") throw new Error("Opening journal is no longer eligible");
    const saved: Array<{ id: string; code: string }> = [];
    for (const row of preview.rows) {
      const marker = sourceMarker(input.entity, journal.id, row.documentCode);
      const status = row.dueDate < pngToday() ? "OVERDUE" : "SENT";
      if (input.entity === "ar") {
        const invoice = await tx.invoice.create({ data: {
          code: row.documentCode, customerId: row.partyId!, issuedDate: journal.date, dueDate: pngDate(row.dueDate), status, currency: journal.currency,
          subtotal: row.outstanding, total: row.outstanding, outstanding: row.outstanding, sourceDocId: marker, journalId: journal.id, glPosted: true,
          notes: `Opening AR carried forward at ${preview.position.recognitionDate}. Original document date: ${row.originalDocumentDate}.${row.description ? ` ${row.description}` : ""} No duplicate GL posting created.`,
          createdBy: input.actorEmail, approvedBy: input.actorEmail, approvedAt: new Date(),
          lines: { create: { lineNo: 1, description: row.description || `Opening receivable ${row.documentCode}`, quantity: 1, unitPrice: row.outstanding, amount: row.outstanding } },
        } });
        saved.push({ id: invoice.id, code: invoice.code });
      } else {
        const bill = await tx.supplierBill.create({ data: {
          code: row.documentCode, supplierId: row.partyId!, billDate: journal.date, dueDate: pngDate(row.dueDate), status, currency: journal.currency,
          subtotal: row.outstanding, total: row.outstanding, outstanding: row.outstanding, sourceDocId: marker, journalId: journal.id, glPosted: true,
          notes: `Opening AP carried forward at ${preview.position.recognitionDate}. Original document date: ${row.originalDocumentDate}.${row.description ? ` ${row.description}` : ""} No duplicate GL posting created.`,
          createdBy: input.actorEmail, approvedBy: input.actorEmail, approvedAt: new Date(),
          lines: { create: { lineNo: 1, description: row.description || `Opening payable ${row.documentCode}`, quantity: 1, unitPrice: row.outstanding, amount: row.outstanding } },
        } });
        saved.push({ id: bill.id, code: bill.code });
      }
    }
    await tx.auditLog.create({ data: {
      action: "IMPORT", entityType: `OPENING_${input.entity.toUpperCase()}_SCHEDULE`, entityCode: input.fileName,
      description: `Imported ${saved.length} opening ${input.entity.toUpperCase()} subledger row(s) without changing the posted GL`,
      changes: JSON.stringify({ openingJournalId: journal.id, openingJournalCode: journal.code, recognitionDate: preview.position.recognitionDate, total: preview.summary.scheduleTotal, backupFile: backup.fileName, created: saved, glJournalCreated: false }),
      userId: actor.id, ipAddress: input.ipAddress || null,
    } });
    return saved;
  }, { timeout: 30_000 });
  return { created, backupFile: backup.fileName, position: await getOpeningSubledgerPosition(input.entity, client) };
}
