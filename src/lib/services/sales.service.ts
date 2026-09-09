/**
 * Sales Service
 * Handles quotations, invoices, credit notes, and customer payments
 */

import { prisma } from '@/lib/prisma';
import { getNextDocumentNumber } from './document.service';
import { calculateTotals, calculateLineTotals } from '@/lib/utils';
import { z } from 'zod';
import { Quote, QuoteStatus, Invoice, InvoiceStatus, CreditNote, CreditNoteStatus, Customer } from '@prisma/client';

// Validation schemas
const createQuoteSchema = z.object({
  customerId: z.string(),
  projectId: z.string().optional(),
  validUntil: z.date().optional(),
  currency: z.string().default('USD'),
  taxRate: z.number().min(0).max(100).default(10),
  notes: z.string().optional(),
  terms: z.string().optional(),
  lines: z.array(z.object({
    itemId: z.string().optional(),
    description: z.string().min(1),
    quantity: z.number().positive(),
    unitPrice: z.number().positive(),
    unit: z.string().default('PCS'),
    discountPercent: z.number().min(0).max(100).default(0),
  })),
});

const updateQuoteSchema = z.object({
  status: z.nativeEnum(QuoteStatus).optional(),
  validUntil: z.date().optional(),
  notes: z.string().optional(),
  terms: z.string().optional(),
  lines: z.array(z.object({
    id: z.string(),
    description: z.string().min(1),
    quantity: z.number().positive(),
    unitPrice: z.number().positive(),
    discountPercent: z.number().min(0).max(100),
  })).optional(),
});

const createInvoiceSchema = z.object({
  customerId: z.string(),
  projectId: z.string().optional(),
  quoteId: z.string().optional(),
  issuedDate: z.date().optional(),
  dueDate: z.date().optional(),
  currency: z.string().default('USD'),
  taxRate: z.number().min(0).max(100).default(10),
  notes: z.string().optional(),
  terms: z.string().optional(),
  poReference: z.string().optional(),
  lines: z.array(z.object({
    itemId: z.string().optional(),
    description: z.string().min(1),
    quantity: z.number().positive(),
    unitPrice: z.number().positive(),
    unit: z.string().default('PCS'),
    discountPercent: z.number().min(0).max(100).default(0),
    revenueAccount: z.string().optional(),
  })),
});

const updateInvoiceSchema = z.object({
  status: z.nativeEnum(InvoiceStatus).optional(),
  dueDate: z.date().optional(),
  notes: z.string().optional(),
  terms: z.string().optional(),
  lines: z.array(z.object({
    id: z.string(),
    description: z.string().min(1),
    quantity: z.number().positive(),
    unitPrice: z.number().positive(),
    discountPercent: z.number().min(0).max(100),
    revenueAccount: z.string().optional(),
  })).optional(),
});

/**
 * Create a new quotation
 */
export async function createQuote(data: z.infer<typeof createQuoteSchema>, createdBy: string): Promise<{ quote: Quote; lines: unknown[] }> {
  // Validate customer exists
  const customer = await prisma.customer.findUnique({
    where: { id: data.customerId },
  });

  if (!customer) {
    throw new Error('Customer not found');
  }

  // Get next document number
  const docNumber = await getNextDocumentNumber({ type: 'QUOTE' });

  // Calculate totals
  const lines = data.lines.map((line, index) => ({
    ...line,
    lineNo: index + 1,
  }));

  const { subtotal, taxTotal, discountTotal, total } = calculateTotals(lines, data.taxRate);

  // Create quote
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
        create: lines.map((line) => ({
          ...line,
          taxAmount: parseFloat((line.quantity * line.unitPrice * (1 - line.discountPercent / 100) * data.taxRate / 100).toFixed(2)),
          amount: parseFloat((line.quantity * line.unitPrice * (1 - line.discountPercent / 100)).toFixed(2)),
        })),
      },
    },
    include: {
      lines: true,
    },
  });

  return {
    quote,
    lines: quote.lines,
  };
}

/**
 * Update a quotation
 */
export async function updateQuote(quoteId: string, data: z.infer<typeof updateQuoteSchema>, updatedBy: string): Promise<Quote> {
  const existingQuote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { lines: true },
  });

  if (!existingQuote) {
    throw new Error('Quote not found');
  }

  // Build update data
  const updateData: Record<string, unknown> = {};
  if (data.status !== undefined) updateData.status = data.status;
  if (data.validUntil !== undefined) updateData.validUntil = data.validUntil;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.terms !== undefined) updateData.terms = data.terms;
  updateData.updatedBy = updatedBy;

  // Update lines if provided
  if (data.lines) {
    // Delete existing lines and create new ones (simplified)
    await prisma.quoteLine.deleteMany({
      where: { quoteId },
    });

    const updatedLines = data.lines.map((line, index) => ({
      ...line,
      lineNo: index + 1,
      quoteId,
    }));

    await prisma.quoteLine.createMany({
      data: updatedLines,
    });

    // Recalculate totals
    const { subtotal, taxTotal, discountTotal, total } = calculateTotals(
      updatedLines.map((l) => ({
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
      })),
      existingQuote.taxTotal / (existingQuote.subtotal || 1) * 100 // Reconstruct tax rate
    );

    updateData.subtotal = subtotal;
    updateData.taxTotal = taxTotal;
    updateData.discountTotal = discountTotal;
    updateData.total = total;
  }

  const quote = await prisma.quote.update({
    where: { id: quoteId },
    data: updateData,
    include: { lines: true },
  });

  return quote;
}

/**
 * Convert quote to invoice
 */
export async function convertQuoteToInvoice(
  quoteId: string,
  data: z.infer<typeof createInvoiceSchema>,
  createdBy: string
): Promise<{ invoice: Invoice; lines: unknown[] }> {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { lines: true },
  });

  if (!quote) {
    throw new Error('Quote not found');
  }

  if (quote.status !== QuoteStatus.ACCEPTED) {
    throw new Error('Quote must be accepted before conversion');
  }

  if (quote.convertedToInvoiceId) {
    throw new Error('Quote already converted to invoice');
  }

  // Get next document number
  const docNumber = await getNextDocumentNumber({ type: 'INVOICE' });

  // Calculate totals (use quote values or recalculate)
  const { subtotal, taxTotal, discountTotal, total } = calculateTotals(
    quote.lines.map((l) => ({
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent || 0,
    })),
    data.taxRate
  );

  // Create invoice
  const invoice = await prisma.invoice.create({
    data: {
      code: docNumber.documentNumber,
      customerId: data.customerId || quote.customerId,
      projectId: data.projectId || quote.projectId,
      issuedDate: data.issuedDate || new Date(),
      dueDate: data.dueDate || quote.validUntil,
      status: InvoiceStatus.DRAFT,
      currency: data.currency || quote.currency,
      subtotal,
      taxTotal,
      discountTotal,
      total,
      amountPaid: 0,
      outstanding: total,
      notes: data.notes,
      terms: data.terms,
      poReference: data.poReference,
      sourceDocId: quote.code,
      createdBy,
      lines: {
        create: quote.lines.map((line, index) => ({
          lineNo: index + 1,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          unit: line.unit,
          taxRate: data.taxRate,
          taxAmount: parseFloat((line.quantity * line.unitPrice * (1 - (line.discountPercent || 0) / 100) * data.taxRate / 100).toFixed(2)),
          discountPercent: line.discountPercent || 0,
          discountAmount: parseFloat((line.quantity * line.unitPrice * (line.discountPercent || 0) / 100).toFixed(2)),
          amount: parseFloat((line.quantity * line.unitPrice * (1 - (line.discountPercent || 0) / 100)).toFixed(2)),
          revenueAccount: line.itemId ? `4100` : data.lines?.[index]?.revenueAccount || '4100',
        })),
      },
    },
    include: {
      lines: true,
    },
  });

  // Update quote status
  await prisma.quote.update({
    where: { id: quoteId },
    data: {
      status: QuoteStatus.CONVERTED,
      convertedToInvoiceId: invoice.id,
      convertedAt: new Date(),
    },
  });

  return {
    invoice,
    lines: invoice.lines,
  };
}

/**
 * Create a new invoice directly (without quote)
 */
export async function createInvoice(data: z.infer<typeof createInvoiceSchema>, createdBy: string): Promise<{ invoice: Invoice; lines: unknown[] }> {
  // Validate customer exists
  const customer = await prisma.customer.findUnique({
    where: { id: data.customerId },
  });

  if (!customer) {
    throw new Error('Customer not found');
  }

  // Get next document number
  const docNumber = await getNextDocumentNumber({ type: 'INVOICE' });

  // Calculate totals
  const lines = data.lines.map((line, index) => ({
    ...line,
    lineNo: index + 1,
  }));

  const { subtotal, taxTotal, discountTotal, total } = calculateTotals(lines, data.taxRate);

  // Create invoice
  const invoice = await prisma.invoice.create({
    data: {
      code: docNumber.documentNumber,
      customerId: data.customerId,
      projectId: data.projectId,
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
      notes: data.notes,
      terms: data.terms,
      poReference: data.poReference,
      sourceDocId: data.quoteId,
      createdBy,
      lines: {
        create: lines.map((line) => ({
          ...line,
          taxAmount: parseFloat((line.quantity * line.unitPrice * (1 - line.discountPercent / 100) * data.taxRate / 100).toFixed(2)),
          discountAmount: parseFloat((line.quantity * line.unitPrice * line.discountPercent / 100).toFixed(2)),
          amount: parseFloat((line.quantity * line.unitPrice * (1 - line.discountPercent / 100)).toFixed(2)),
        })),
      },
    },
    include: {
      lines: true,
    },
  });

  return {
    invoice,
    lines: invoice.lines,
  };
}

/**
 * Update an invoice
 */
export async function updateInvoice(invoiceId: string, data: z.infer<typeof updateInvoiceSchema>, updatedBy: string): Promise<Invoice> {
  const existingInvoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { lines: true },
  });

  if (!existingInvoice) {
    throw new Error('Invoice not found');
  }

  // Build update data
  const updateData: Record<string, unknown> = {};
  if (data.status !== undefined) updateData.status = data.status;
  if (data.dueDate !== undefined) updateData.dueDate = data.dueDate;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.terms !== undefined) updateData.terms = data.terms;
  updateData.updatedBy = updatedBy;

  // Update lines if provided
  if (data.lines) {
    // Delete existing lines and create new ones
    await prisma.invoiceLine.deleteMany({
      where: { invoiceId },
    });

    const updatedLines = data.lines.map((line, index) => ({
      ...line,
      lineNo: index + 1,
      invoiceId,
    }));

    await prisma.invoiceLine.createMany({
      data: updatedLines,
    });

    // Recalculate totals
    const { subtotal, taxTotal, discountTotal, total } = calculateTotals(
      updatedLines.map((l) => ({
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
      })),
      existingInvoice.taxTotal / (existingInvoice.subtotal || 1) * 100
    );

    updateData.subtotal = subtotal;
    updateData.taxTotal = taxTotal;
    updateData.discountTotal = discountTotal;
    updateData.total = total;
    updateData.outstanding = total - existingInvoice.amountPaid;
  }

  const invoice = await prisma.invoice.update({
    where: { id: invoiceId },
    data: updateData,
    include: { lines: true },
  });

  return invoice;
}

/**
 * Post invoice (GL entry)
 */
export async function postInvoice(invoiceId: string, approvedBy: string): Promise<Invoice> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { lines: true, customer: true },
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (invoice.status !== InvoiceStatus.SENT) {
    throw new Error('Invoice must be sent before posting');
  }

  if (invoice.glPosted) {
    throw new Error('Invoice already posted to GL');
  }

  // Create journal entry
  const journal = await prisma.journalHeader.create({
    data: {
      code: `JRN-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`,
      date: invoice.issuedDate || new Date(),
      description: `Invoice ${invoice.code}`,
      reference: invoice.code,
      sourceDocType: 'INVOICE',
      sourceDocId: invoice.id,
      status: 'POSTED',
      currency: invoice.currency,
      totalDebit: invoice.total,
      totalCredit: invoice.total,
      isBalanced: true,
      createdBy: approvedBy,
      approvedBy,
      postedAt: new Date(),
      lines: {
        create: [
          {
            lineNo: 1,
            accountId: '1130', // Accounts Receivable
            description: `Invoice ${invoice.code} - ${invoice.customer.name}`,
            debit: invoice.total,
            credit: 0,
            amount: invoice.total,
            currency: invoice.currency,
            projectId: invoice.projectId,
            customerId: invoice.customerId,
            taxAmount: invoice.taxTotal,
          },
          {
            lineNo: 2,
            accountId: '4100', // Sales Revenue
            description: `Invoice ${invoice.code} - Revenue`,
            debit: 0,
            credit: invoice.subtotal,
            amount: invoice.subtotal,
            currency: invoice.currency,
            projectId: invoice.projectId,
            customerId: invoice.customerId,
          },
          {
            lineNo: 3,
            accountId: '2120', // GST Payable (assuming 10% tax)
            description: `Invoice ${invoice.code} - GST`,
            debit: 0,
            credit: invoice.taxTotal,
            amount: invoice.taxTotal,
            currency: invoice.currency,
            taxAmount: invoice.taxTotal,
            taxCode: 'GST',
          },
        ],
      },
    },
  });

  // Update invoice
  const updatedInvoice = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: InvoiceStatus.POSTED,
      glPosted: true,
      journalId: journal.id,
    },
  });

  // Create audit log
  await prisma.auditLog.create({
    data: {
      action: 'POST',
      entityType: 'Invoice',
      entityId: invoice.id,
      entityCode: invoice.code,
      description: `Invoice posted to GL: ${invoice.code}`,
      userId: approvedBy,
    },
  });

  return updatedInvoice;
}

/**
 * Record payment against invoice
 */
export async function recordPayment(
  invoiceId: string,
  paymentData: {
    amount: number;
    paymentDate: Date;
    paymentMethod: string;
    reference?: string;
    referenceAccount?: string;
  },
  createdBy: string
): Promise<{ invoice: Invoice; payment: unknown }> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { customer: true },
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (invoice.outstanding < paymentData.amount) {
    throw new Error('Payment amount exceeds outstanding balance');
  }

  // Create payment record
  const payment = await prisma.payment.create({
    data: {
      code: `PAY-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`,
      type: 'CUSTOMER_RECEIPT',
      date: paymentData.paymentDate,
      amount: paymentData.amount,
      currency: invoice.currency,
      paymentMethod: paymentData.paymentMethod,
      _referenceAccount: paymentData.referenceAccount || '1110', // Cash/Bank
      status: 'CLEARED',
      customerId: invoice.customerId,
      invoiceId,
      projectId: invoice.projectId,
      notes: paymentData.reference,
      createdBy,
    },
  });

  // Update invoice
  const updatedInvoice = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      amountPaid: invoice.amountPaid + paymentData.amount,
      outstanding: invoice.outstanding - paymentData.amount,
      status: invoice.outstanding - paymentData.amount <= 0 ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL,
    },
  });

  return { invoice: updatedInvoice, payment };
}
