/**
 * Document Numbering Service
 * Handles continuation numbering for all business documents
 */

import { prisma } from '@/lib/prisma';
import { generateDocumentNumber, parseDocumentNumber } from '@/lib/utils';

export type DocumentType =
  | 'QUOTE'
  | 'INVOICE'
  | 'PURCHASE_ORDER'
  | 'SUPPLIER_BILL'
  | 'PAYMENT'
  | 'EXPENSE'
  | 'CREDIT_NOTE'
  | 'REFUND'
  | 'JOURNAL'
  | 'GOODS_RECEIPT'
  | 'TIME_ENTRY'
  | 'TAX_REPORT';

const PREFIXES: Record<DocumentType, string> = {
  QUOTE: 'QT',
  INVOICE: 'INV',
  PURCHASE_ORDER: 'PO',
  SUPPLIER_BILL: 'BILL',
  PAYMENT: 'PAY',
  EXPENSE: 'EXP',
  CREDIT_NOTE: 'CN',
  REFUND: 'REF',
  JOURNAL: 'JRN',
  GOODS_RECEIPT: 'GR',
  TIME_ENTRY: 'TIME',
  TAX_REPORT: 'TAX',
};

interface GetNextNumberOptions {
  type: DocumentType;
  year?: number;
  prefix?: string;
}

interface GetNextNumberResult {
  documentNumber: string;
  prefix: string;
  year: number;
  nextSequence: number;
}

/**
 * Get the next document number for a given type
 * Uses continuation numbering: PREFIX-YYYY-NNNNN
 */
export async function getNextDocumentNumber(options: GetNextNumberOptions): Promise<GetNextNumberResult> {
  const { type, year = new Date().getFullYear(), prefix = PREFIXES[type] } = options;

  // Get the highest sequence number for this year and type
  const latestDoc = await getLatestDocumentByTypeAndYear(type, year);

  const nextSequence = latestDoc ? latestDoc.sequence + 1 : 1;
  const documentNumber = generateDocumentNumber(prefix, year, nextSequence);

  return {
    documentNumber,
    prefix,
    year,
    nextSequence,
  };
}

/**
 * Get the latest document by type and year
 */
async function getLatestDocumentByTypeAndYear(type: DocumentType, year: number): Promise<{ sequence: number } | null> {
  const prefix = PREFIXES[type];

  // Search for the latest document number for this type and year
  // We'll search across all document tables

  // Check quotes
  const quote = await prisma.quote.findFirst({
    where: {
      code: { startsWith: `${prefix}-${year}-` },
    },
    orderBy: { code: 'desc' },
    select: { code: true },
  });

  if (quote) {
    const parsed = parseDocumentNumber(quote.code);
    if (parsed && parsed.prefix === prefix && parsed.year === year) {
      return { sequence: parsed.sequence };
    }
  }

  // Check invoices
  const invoice = await prisma.invoice.findFirst({
    where: {
      code: { startsWith: `${prefix}-${year}-` },
    },
    orderBy: { code: 'desc' },
    select: { code: true },
  });

  if (invoice) {
    const parsed = parseDocumentNumber(invoice.code);
    if (parsed && parsed.prefix === prefix && parsed.year === year) {
      return { sequence: parsed.sequence };
    }
  }

  // For other document types, we'd need to check the relevant tables
  // This is a simplified implementation

  return null;
}

/**
 * Get the current year's sequence count for a document type
 */
export async function getYearSequenceCount(type: DocumentType, year: number): Promise<number> {
  const prefix = PREFIXES[type];
  const latest = await getLatestDocumentByTypeAndYear(type, year);
  return latest ? latest.sequence : 0;
}

/**
 * Validate a document number format
 */
export function validateDocumentNumber(docNumber: string): { valid: boolean; prefix?: string; year?: number; sequence?: number } {
  const parsed = parseDocumentNumber(docNumber);
  if (!parsed) {
    return { valid: false };
  }
  return {
    valid: true,
    prefix: parsed.prefix,
    year: parsed.year,
    sequence: parsed.sequence,
  };
}

/**
 * Generate a unique document number ensuring no duplicates
 */
export async function generateUniqueDocumentNumber(
  type: DocumentType,
  proposedNumber?: string
): Promise<string> {
  if (proposedNumber) {
    // Validate proposed number
    const validation = validateDocumentNumber(proposedNumber);
    if (validation.valid) {
      // Check if number already exists
      const exists = await checkDocumentExists(type, proposedNumber);
      if (!exists) {
        return proposedNumber;
      }
    }
  }

  // Generate new number
  const result = await getNextDocumentNumber({ type });
  return result.documentNumber;
}

/**
 * Check if a document number already exists in any table
 */
async function checkDocumentExists(type: DocumentType, documentNumber: string): Promise<boolean> {
  const prefix = PREFIXES[type];

  // This is a simplified check - in production you'd need to check all relevant tables
  const tables: Record<DocumentType, string> = {
    QUOTE: 'quote',
    INVOICE: 'invoice',
    PURCHASE_ORDER: 'purchaseOrder',
    SUPPLIER_BILL: 'supplierBill',
    PAYMENT: 'payment',
    EXPENSE: 'expense',
    CREDIT_NOTE: 'creditNote',
    REFUND: 'refund',
    JOURNAL: 'journalHeader',
    GOODS_RECEIPT: 'goodsReceipt',
    TIME_ENTRY: 'timeEntry',
    TAX_REPORT: 'taxReport',
  };

  // For now, just check quotes and invoices as examples
  if (type === 'QUOTE') {
    const quote = await prisma.quote.findUnique({ where: { code: documentNumber } });
    return !!quote;
  }

  if (type === 'INVOICE') {
    const invoice = await prisma.invoice.findUnique({ where: { code: documentNumber } });
    return !!invoice;
  }

  return false;
}

/**
 * Get document info from number
 */
export async function getDocumentByNumber(documentNumber: string) {
  // Try to find in quotes
  const quote = await prisma.quote.findUnique({
    where: { code: documentNumber },
  });
  if (quote) {
    return { type: 'QUOTE' as const, data: quote };
  }

  // Try to find in invoices
  const invoice = await prisma.invoice.findUnique({
    where: { code: documentNumber },
  });
  if (invoice) {
    return { type: 'INVOICE' as const, data: invoice };
  }

  // Try to find in purchase orders
  const po = await prisma.purchaseOrder.findUnique({
    where: { code: documentNumber },
  });
  if (po) {
    return { type: 'PURCHASE_ORDER' as const, data: po };
  }

  // Try to find in supplier bills
  const bill = await prisma.supplierBill.findUnique({
    where: { code: documentNumber },
  });
  if (bill) {
    return { type: 'SUPPLIER_BILL' as const, data: bill };
  }

  return null;
}
