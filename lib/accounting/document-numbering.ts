import { randomInt } from "node:crypto";
import { prisma } from "@/src/lib/prisma";
import { Prisma } from "@prisma/client";

function normalizedPrefix(documentName: string) {
  const cleaned = String(documentName || "DO").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return cleaned || "DO";
}

function twoLetterCode(documentName: string) {
  return normalizedPrefix(documentName).padEnd(2, "X").slice(0, 2);
}

/**
 * Legacy/internal identifier generator.
 * Keep this for non-user-facing internal IDs that already rely on a synchronous value.
 */
export function documentSeriesId(documentName: string, year = new Date().getUTCFullYear()) {
  const sequence = String(randomInt(0, 100000)).padStart(5, "0");
  return `${twoLetterCode(documentName)}-${sequence}-${year}`;
}

/**
 * User-facing document number generator.
 * Format: PREFIX-YYYY-0000001
 * Uses an atomic database counter per prefix/year so the visible series is sequential.
 */
export /**
 * Shared collision scan for every persisted model with a unique document code.
 * Adding a new Prisma document model with a 'code' field makes it participate
 * automatically, instead of maintaining a fragile list of doctypes.
 */
export async function existingVisibleSequenceMax(prefix: string, year: number) {
  const start = `${prefix}-${year}-`;
  const models = Prisma.dmmf.datamodel.models.filter((model) =>
    model.fields.some((field) => field.name === "code" && field.kind === "scalar" && field.type === "String")
  );
  const rows = await Promise.all(models.map(async (model) => {
    const key = model.name[0].toLowerCase() + model.name.slice(1);
    const delegate = (prisma as unknown as Record<string, { findMany?: (query: unknown) => Promise<Array<{ code: string }>> }>)[key];
    if (!delegate?.findMany) return [];
    return delegate.findMany({
      where: { code: { startsWith: start } },
      select: { code: true },
    });
  }));
  return rows.flat().reduce((max, row) => {
    const code = String(row.code || "");
    const suffix = code.slice(start.length);
    if (!/^\d+$/.test(suffix)) return max;
    const sequence = Number(suffix);
    return Number.isSafeInteger(sequence) ? Math.max(max, sequence) : max;
  }, 0);
}

export async function nextDocumentSeriesId(documentName: string, year = new Date().getUTCFullYear()) {
  const prefix = normalizedPrefix(documentName);
  const key = `document_series:${prefix}:${year}`;
  const existingCounter = await prisma.globalSettings.findUnique({
    where: { key },
    select: { valueInt: true },
  });
  if (existingCounter?.valueInt) {
    const row = await prisma.globalSettings.update({
      where: { key },
      data: { valueInt: { increment: 1 }, updatedBy: "document-numbering" },
      select: { valueInt: true },
    });
    return `${prefix}-${year}-${String(Number(row.valueInt || 1)).padStart(7, "0")}`;
  }
  const initialSequence = (await existingVisibleSequenceMax(prefix, year)) + 1;
  const row = await prisma.globalSettings.upsert({
    where: { key },
    create: {
      key, valueInt: initialSequence,
      description: `Sequential document counter for ${prefix}-${year}`,
      updatedBy: "document-numbering",
    },
    update: { valueInt: { increment: 1 }, updatedBy: "document-numbering" },
    select: { valueInt: true },
  });
  const sequence = Math.max(initialSequence, Number(row.valueInt || initialSequence));
  return `${prefix}-${year}-${String(sequence).padStart(7, "0")}`;
}

export function documentLineId(documentId: string, lineNo: number) {
  return `${documentId}-${String(lineNo).padStart(3, "0")}`;
}

/**
 * Read-only preview. Does not reserve a number or change any database row.
 * Save/creation must obtain its own authoritative number from nextDocumentSeriesId.
 */
export async function previewDocumentSeriesId(documentName: string, year = new Date().getUTCFullYear()) {
  const prefix = normalizedPrefix(documentName);
  const key = `document_series:${prefix}:${year}`;
  const [counter, inUse] = await Promise.all([
    prisma.globalSettings.findUnique({ where: { key }, select: { valueInt: true } }),
    existingVisibleSequenceMax(prefix, year),
  ]);
  const next = Math.max(Number(counter?.valueInt || 0), inUse) + 1;
  return `${prefix}-${year}-${String(next).padStart(7, "0")}`;
}
