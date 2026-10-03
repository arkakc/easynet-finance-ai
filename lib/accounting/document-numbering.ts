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
 * Format: PREFIX-YYYY-000001
 * Uses an atomic database counter per prefix/year so the visible series is sequential.
 */
export async function nextDocumentSeriesId(documentName: string, year = new Date().getUTCFullYear()) {
  const prefix = normalizedPrefix(documentName);
  const key = `document_series:${prefix}:${year}`;
  const row = await prisma.globalSettings.upsert({
    where: { key },
    create: {
      key,
      valueInt: 1,
      description: `Sequential document counter for ${prefix}-${year}`,
      updatedBy: "document-numbering",
    },
    update: {
      valueInt: { increment: 1 },
      updatedBy: "document-numbering",
    },
    select: { valueInt: true },
  });
  const sequence = Math.max(1, Number(row.valueInt || 1));
  return `${prefix}-${year}-${String(sequence).padStart(6, "0")}`;
}

export function documentLineId(documentId: string, lineNo: number) {
  return `${documentId}-${String(lineNo).padStart(3, "0")}`;
}
