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

/**
 * Reconcile legacy counters against actually persisted numbers.
 * A previously consumed preview must never permanently skip a number.
 * This is safe only because the allocator's update is atomic, while previews
 * are read-only. Numbers are still allocated at creation time.
 */
export async function nextDocumentSeriesId(documentName: string, year = new Date().getUTCFullYear()) {
  const prefix = normalizedPrefix(documentName);
  const key = `document_series:${prefix}:${year}`;
  const persistedMax = await existingVisibleSequenceMax(prefix, year);
  // A counter ahead of persisted data can be an unused reservation from the old
  // reload bug. Rebase it only when there are no persistent documents in
  // that series, avoiding reuse of an existing reference.
  if (persistedMax === 0) {
    await prisma.globalSettings.updateMany({
      where: { key, valueInt: { gt: 0 } },
      data: { valueInt: 0, updatedBy: "document-numbering" },
    });
  }
  const row = await prisma.globalSettings.upsert({
    where: { key },
    create: { key, valueInt: persistedMax + 1, description: `Sequential document counter for ${prefix}-${year}`, updatedBy: "document-numbering" },
    update: { valueInt: { increment: 1 }, updatedBy: "document-numbering" },
    select: { valueInt: true },
  });
  const sequence = Math.max(persistedMax + 1, Number(row.valueInt || 1));
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
  // With no saved documents, a legacy counter is a stale preview reservation.
  const next = inUse === 0 ? 1 : Math.max(Number(counter?.valueInt || 0), inUse) + 1;
  return `${prefix}-${year}-${String(next).padStart(7, "0")}`;
}
