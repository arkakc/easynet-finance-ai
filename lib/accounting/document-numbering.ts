import { randomInt } from "node:crypto";
import { prisma } from "@/src/lib/prisma";

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
async function existingVisibleSequenceMax(prefix: string, year: number) {
  const start = `${prefix}-${year}-`;
  const [quotes, invoices, purchaseOrders, supplierBills, payments, expenses, deliveryNotes, purchaseReceipts, customers, suppliers, projects, items] = await Promise.all([
    prisma.quote.findMany({ where: { code: { startsWith: start } }, select: { code: true } }),
    prisma.invoice.findMany({ where: { code: { startsWith: start } }, select: { code: true } }),
    prisma.purchaseOrder.findMany({ where: { code: { startsWith: start } }, select: { code: true } }),
    prisma.supplierBill.findMany({ where: { code: { startsWith: start } }, select: { code: true } }),
    prisma.payment.findMany({ where: { code: { startsWith: start } }, select: { code: true } }),
    prisma.expense.findMany({ where: { code: { startsWith: start } }, select: { code: true } }),
    prisma.deliveryNote.findMany({ where: { code: { startsWith: start } }, select: { code: true } }),
    prisma.purchaseReceipt.findMany({ where: { code: { startsWith: start } }, select: { code: true } }),
    prisma.customer.findMany({ where: { code: { startsWith: start } }, select: { code: true } }),
    prisma.supplier.findMany({ where: { code: { startsWith: start } }, select: { code: true } }),
    prisma.project.findMany({ where: { code: { startsWith: start } }, select: { code: true } }),
    prisma.item.findMany({ where: { code: { startsWith: start } }, select: { code: true } }),
  ]);
  return [...quotes, ...invoices, ...purchaseOrders, ...supplierBills, ...payments, ...expenses, ...deliveryNotes, ...purchaseReceipts, ...customers, ...suppliers, ...projects, ...items]
    .reduce((max, row) => {
      const value = String(row.code || "");
      if (!value.startsWith(start)) return max;
      const sequence = Number(value.slice(start.length));
      return Number.isInteger(sequence) && sequence > max ? sequence : max;
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
      key,
      valueInt: initialSequence,
      description: `Sequential document counter for ${prefix}-${year}`,
      updatedBy: "document-numbering",
    },
    update: {
      valueInt: { increment: 1 },
      updatedBy: "document-numbering",
    },
    select: { valueInt: true },
  });
  const sequence = Math.max(initialSequence, Number(row.valueInt || initialSequence));
  return `${prefix}-${year}-${String(sequence).padStart(6, "0")}`;
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
