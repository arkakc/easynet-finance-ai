/**
 * Sales Service (Papua New Guinea SME Edition)
 * Handles quotations, invoices, credit notes, customer payments,
 * selling with margin calculation, and Section 65A GST withholding.
 */

import { prisma } from '@/lib/prisma';
import { getNextDocumentNumber } from './document.service';
import { calculateTotals, calculateLineTotals, calculateMargin, calculateSellingPriceFromMargin } from '@/lib/utils';
import { getOrCreateAccount } from './accounting.service';
import { z } from 'zod';
import { Quote, QuoteStatus, Invoice, InvoiceStatus, CreditNote, CreditNoteStatus, Customer } from '@prisma/client';

export { calculateMargin, calculateSellingPriceFromMargin };

// Line item schema with Margin & Markup
const lineItemSchema = z.object({
  itemId: z.string().optional(),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  costPrice: z.number().nonnegative().optional().default(0),
  marginPercent: z.number().optional().default(0),
  markupPercent: z.number().optional().default(0),
  unit: z.string().optional().default('PCS'),
  discountPercent: z.number().min(0).max(100).optional().default(0),
  revenueAccount: z.string().optional(),
});

// Validation schemas
export const createQuoteSchema = z.object({
  customerId: z.string(),
  projectId: z.string().optional(),
  validUntil: z.coerce.date().optional(),
  currency: z.string().optional().default('PGK'),
  taxRate: z.number().min(0).max(100).optional().default(10), // 10% IRC GST default
  notes: z.string().optional(),
  terms: z.string().optional(),
  lines: z.array(lineItemSchema),
});

export const updateQuoteSchema = z.object({
  status: z.nativeEnum(QuoteStatus).optional(),
  validUntil: z.coerce.date().optional(),
  notes: z.string().optional(),
  terms: z.string().optional(),
  lines: z.array(lineItemSchema.extend({ id: z.string().optional() })).optional(),
});

export const createInvoiceSchema = z.object({
  customerId: z.string(),
  projectId: z.string().optional(),
  quoteId: z.string().optional(),
  issuedDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  currency: z.string().optional().default('PGK'),
  taxRate: z.number().min(0).max(100).optional().default(10),
  notes: z.string().optional(),
  terms: z.string().optional(),
  poReference: z.string().optional(),
  isS65aWithheld: z.boolean().optional().default(false),
  s65aAmount: z.number().optional().default(0),
  s65aCertificateNo: z.string().optional(),
  lines: z.array(lineItemSchema),
});

export const updateInvoiceSchema = z.object({
  status: z.nativeEnum(InvoiceStatus).optional(),
  dueDate: z.coerce.date().optional(),
  notes: z.string().optional(),
  terms: z.string().optional(),
  isS65aWithheld: z.boolean().optional(),
  s65aAmount: z.number().optional(),
  s65aCertificateNo: z.string().optional(),
  lines: z.array(lineItemSchema.extend({ id: z.string().optional() })).optional(),
});

/**
 * Create a new quotation
 */
export async function createQuote(raw: z.input<typeof createQuoteSchema>, createdBy: string) {
  const data = createQuoteSchema.parse(raw);
  const customer = await prisma.customer.findUnique({
    where: { id: data.customerId },
  });

  if (!customer) {
    throw new Error('Customer not found');
  }

  const docNumber = await getNextDocumentNumber({ type: 'QUOTE' });
  const linesWithNo = data.lines.map((line, index) => ({
    ...line,
    lineNo: index + 1,
  }));

  const { subtotal, taxTotal, discountTotal, total } = calculateTotals(linesWithNo, data.taxRate);

  const quote = await prisma.quote.create({
    data: {
      code: docNumber.documentNumber,
      customerId: data.customerId,
      projectId: data.projectId,
      validUntil: data.validUntil,
      status: QuoteStatus.DRAFT,
      currency: data.currency,
      subtotal,
      taxTotal,
      discountTotal,
      total,
      notes: data.notes,
      terms: data.terms,
      createdBy,
      lines: {
        create: linesWithNo.map((line) => {
          const marginData = calculateMargin(line.costPrice, line.unitPrice);
          const lineCalc = calculateLineTotals({
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountPercent: line.discountPercent,
            taxRate: data.taxRate,
          });

          return {
            lineNo: line.lineNo,
            itemId: line.itemId,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            costPrice: line.costPrice,
            marginPercent: marginData.marginPercent,
            markupPercent: marginData.markupPercent,
            unit: line.unit,
            taxRate: data.taxRate,
            taxAmount: lineCalc.taxAmount,
            discountPercent: line.discountPercent,
            discountAmount: lineCalc.discountAmount,
            amount: lineCalc.amount,
          };
        }),
      },
    },
    include: {
      lines: true,
      customer: true,
    },
  });

  return quote;
}

/**
 * Create a new Sales Invoice
 */
export async function createInvoice(raw: z.input<typeof createInvoiceSchema>, createdBy: string) {
  const data = createInvoiceSchema.parse(raw);
  const customer = await prisma.customer.findUnique({
    where: { id: data.customerId },
  });

  if (!customer) {
    throw new Error('Customer not found');
  }

  const docNumber = await getNextDocumentNumber({ type: 'INVOICE' });
  const linesWithNo = data.lines.map((line, index) => ({
    ...line,
    lineNo: index + 1,
  }));

  const { subtotal, taxTotal, discountTotal, total } = calculateTotals(linesWithNo, data.taxRate);

  // Section 65A GST withholding: if withheld by government/mining entity, defaults to 100% of GST
  const s65aAmount = data.isS65aWithheld ? (data.s65aAmount > 0 ? data.s65aAmount : taxTotal) : 0;

  const invoice = await prisma.invoice.create({
    data: {
      code: docNumber.documentNumber,
      customerId: data.customerId,
      projectId: data.projectId,
      sourceDocId: data.quoteId,
      issuedDate: data.issuedDate || new Date(),
      dueDate: data.dueDate,
      status: InvoiceStatus.DRAFT,
      currency: data.currency,
      subtotal,
      taxTotal,
      discountTotal,
      total,
      amountPaid: 0,
      outstanding: total,
      s65aAmount,
      isS65aWithheld: data.isS65aWithheld,
      s65aCertificateNo: data.s65aCertificateNo,
      notes: data.notes,
      terms: data.terms,
      poReference: data.poReference,
      createdBy,
      lines: {
        create: linesWithNo.map((line) => {
          const marginData = calculateMargin(line.costPrice, line.unitPrice);
          const lineCalc = calculateLineTotals({
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountPercent: line.discountPercent,
            taxRate: data.taxRate,
          });

          return {
            lineNo: line.lineNo,
            itemId: line.itemId,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            costPrice: line.costPrice,
            marginPercent: marginData.marginPercent,
            markupPercent: marginData.markupPercent,
            unit: line.unit,
            taxRate: data.taxRate,
            taxAmount: lineCalc.taxAmount,
            discountPercent: line.discountPercent,
            discountAmount: lineCalc.discountAmount,
            amount: lineCalc.amount,
            revenueAccount: line.revenueAccount || '4000',
          };
        }),
      },
    },
    include: {
      lines: true,
      customer: true,
      project: true,
    },
  });

  return invoice;
}

/**
 * Convert an accepted quote to invoice
 */
export async function convertQuoteToInvoice(quoteId: string, createdBy: string) {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { lines: true, customer: true },
  });

  if (!quote) throw new Error('Quote not found');
  if (quote.convertedToInvoiceId) throw new Error('Quote has already been converted');

  const invoiceData = {
    customerId: quote.customerId,
    projectId: quote.projectId || undefined,
    quoteId: quote.id,
    currency: quote.currency,
    taxRate: 10,
    notes: quote.notes || undefined,
    terms: quote.terms || undefined,
    isS65aWithheld: false,
    s65aAmount: 0,
    lines: quote.lines.map((l) => ({
      itemId: l.itemId || undefined,
      description: l.description,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      costPrice: Number(l.costPrice || 0),
      marginPercent: Number(l.marginPercent || 0),
      markupPercent: Number(l.markupPercent || 0),
      unit: l.unit,
      discountPercent: Number(l.discountPercent || 0),
      revenueAccount: '4000',
    })),
  };

  const invoice = await createInvoice(invoiceData, createdBy);

  await prisma.quote.update({
    where: { id: quoteId },
    data: {
      status: QuoteStatus.CONVERTED,
      convertedToInvoiceId: invoice.id,
      convertedAt: new Date(),
    },
  });

  return invoice;
}

/**
 * Post Invoice to General Ledger (PNG Double-Entry Rules)
 * Dr. Accounts Receivable (1100)
 * Cr. Sales Revenue (4000)
 * Cr. GST Output Tax Payable (2200)
 */
export async function postInvoiceToGL(invoiceId: string, approvedBy: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { customer: true, lines: true },
  });

  if (!invoice) throw new Error('Invoice not found');
  if (invoice.glPosted) throw new Error('Invoice is already posted to GL');

  const totalAmount = Number(invoice.total);
  const subtotal = Number(invoice.subtotal);
  const taxTotal = Number(invoice.taxTotal);

  // Resolve standard chart of accounts
  const arAccount = await getOrCreateAccount('1100', 'Accounts Receivable (Trade Debtors)', 'ASSET');
  const revAccount = await getOrCreateAccount('4000', 'Sales Revenue', 'REVENUE');
  const gstAccount = await getOrCreateAccount('2200', 'GST Output Tax Payable (10%)', 'LIABILITY');

  const s65aAmount = Number(invoice.s65aAmount || 0);
  const isS65a = Boolean(invoice.isS65aWithheld && s65aAmount > 0);
  const s65aAccount = isS65a
    ? await getOrCreateAccount('1250', 'Section 65A GST Withholding Tax Credit', 'ASSET')
    : null;
  const netArAmount = isS65a ? Math.max(0, totalAmount - s65aAmount) : totalAmount;

  const journalLines: Array<{
    lineNo: number;
    accountId: string;
    debit: number;
    credit: number;
    amount: number;
    currency: string;
    description: string;
    customerId?: string;
    projectId?: string | null;
  }> = [];

  let currentLineNo = 1;
  // Line 1: Debit Accounts Receivable
  journalLines.push({
    lineNo: currentLineNo++,
    accountId: arAccount.id,
    debit: netArAmount,
    credit: 0,
    amount: netArAmount,
    currency: invoice.currency,
    description: `Trade Debtors: ${invoice.customer.name}${isS65a ? ' (Net of S65A)' : ''}`,
    customerId: invoice.customerId,
    projectId: invoice.projectId,
  });

  // Line 2: Debit Section 65A GST Tax Credit (if withheld by Mining/Govt)
  if (isS65a && s65aAccount) {
    journalLines.push({
      lineNo: currentLineNo++,
      accountId: s65aAccount.id,
      debit: s65aAmount,
      credit: 0,
      amount: s65aAmount,
      currency: invoice.currency,
      description: `Section 65A GST Withheld at Source (${invoice.s65aCertificateNo || invoice.code})`,
      customerId: invoice.customerId,
      projectId: invoice.projectId,
    });
  }

  // Line 3: Credit Sales Revenue
  journalLines.push({
    lineNo: currentLineNo++,
    accountId: revAccount.id,
    debit: 0,
    credit: subtotal,
    amount: subtotal,
    currency: invoice.currency,
    description: `Sales Revenue (${invoice.code})`,
    customerId: invoice.customerId,
    projectId: invoice.projectId,
  });

  // Line 4: Credit GST Output Tax (IRC 10%)
  journalLines.push({
    lineNo: currentLineNo++,
    accountId: gstAccount.id,
    debit: 0,
    credit: taxTotal,
    amount: taxTotal,
    currency: invoice.currency,
    description: `GST Output Tax 10% (${invoice.code})`,
    customerId: invoice.customerId,
    projectId: invoice.projectId,
  });

  // Create General Ledger Journal Header & Lines
  const journalCode = `JRN-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;

  const journal = await prisma.journalHeader.create({
    data: {
      code: journalCode,
      date: invoice.issuedDate,
      sourceDocType: 'INVOICE',
      reference: invoice.code,
      description: `Sales Invoice - ${invoice.customer.name} (${invoice.code})`,
      totalDebit: totalAmount,
      totalCredit: totalAmount,
      isBalanced: true,
      status: 'POSTED',
      createdBy: approvedBy,
      lines: {
        create: journalLines,
      },
    },
  });

  const updatedInvoice = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: invoice.status === InvoiceStatus.DRAFT ? InvoiceStatus.SENT : invoice.status,
      glPosted: true,
      journalId: journal.id,
      approvedBy,
      approvedAt: new Date(),
    },
  });

  return { invoice: updatedInvoice, journal };
}

/**
 * Record Payment against Invoice (Supports Cash, Bank, and PNG Section 65A GST Certificate)
 */
export async function recordPayment(
  invoiceId: string,
  paymentData: {
    amount: number; // Actual cash/bank received
    paymentDate: Date;
    paymentMethod: string;
    reference?: string;
    referenceAccount?: string;
    s65aDeduction?: number; // GST withheld under Section 65A certificate
    s65aCertificateNo?: string;
  },
  createdBy: string
) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { customer: true },
  });

  if (!invoice) throw new Error('Invoice not found');

  const currentOutstanding = Number(invoice.outstanding);
  const currentPaid = Number(invoice.amountPaid);
  const payAmount = Number(paymentData.amount || 0);
  const s65a = Number(paymentData.s65aDeduction || 0);
  const totalSettlement = payAmount + s65a;

  if (totalSettlement <= 0) throw new Error('Payment or settlement amount must be greater than zero');
  if (totalSettlement > currentOutstanding + 0.01) {
    throw new Error('Total settlement exceeds invoice outstanding amount');
  }

  // Create payment record
  const payment = await prisma.payment.create({
    data: {
      code: `PAY-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`,
      type: 'CUSTOMER_RECEIPT',
      date: paymentData.paymentDate,
      amount: payAmount,
      s65aDeduction: s65a,
      currency: invoice.currency,
      paymentMethod: paymentData.paymentMethod,
      referenceAccount: paymentData.referenceAccount || '1110', // BSP / Bank Account
      status: 'CLEARED',
      customerId: invoice.customerId,
      invoiceId,
      projectId: invoice.projectId,
      notes: paymentData.reference,
      createdBy,
    },
  });

  const newOutstanding = Math.max(0, currentOutstanding - totalSettlement);
  const isFullyPaid = newOutstanding <= 0.01;

  const updatedInvoice = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      amountPaid: currentPaid + totalSettlement,
      outstanding: newOutstanding,
      s65aAmount: Number(invoice.s65aAmount) + s65a,
      isS65aWithheld: (Number(invoice.s65aAmount) + s65a) > 0,
      s65aCertificateNo: paymentData.s65aCertificateNo || invoice.s65aCertificateNo,
      status: isFullyPaid ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL,
    },
  });

  return { invoice: updatedInvoice, payment };
}
