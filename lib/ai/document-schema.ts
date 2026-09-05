import { z } from "zod";

export const extractedLineSchema = z.object({
  description: z.string().default(""),
  itemCode: z.string().nullable().default(null),
  qty: z.number().nonnegative().default(0),
  uom: z.string().nullable().default(null),
  rate: z.number().nonnegative().default(0),
  netAmount: z.number().nonnegative().default(0),
  gstAmount: z.number().nonnegative().default(0),
  totalAmount: z.number().nonnegative().default(0),
});

export const documentSchema = z.object({
  documentType: z.enum([
    "SERVICE_PROPOSAL",
    "QUOTATION",
    "SALES_INVOICE",
    "PURCHASE_ORDER",
    "SUPPLIER_INVOICE",
    "CUSTOMER_RECEIPT",
    "SUPPLIER_PAYMENT",
    "EXPENSE_RECEIPT",
    "FUNDING_LOAN",
    "LOAN_REPAYMENT",
    "ASSET_PURCHASE",
    "SERVICE_COMPLETION",
    "DELIVERY_NOTE",
    "GST_REGISTRATION",
    "UNKNOWN",
  ]),
  documentNo: z.string().nullable(),
  documentDate: z.string().nullable(),
  counterparty: z.string().nullable(),
  partyType: z.enum(["Customer", "Supplier", "Lender", "Unknown"]).default("Unknown"),
  projectId: z.string().nullable(),
  currency: z.string().default("PGK"),
  netAmount: z.number().nonnegative(),
  gstAmount: z.number().nonnegative(),
  grossAmount: z.number().nonnegative(),
  paymentTerms: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1),
  lines: z.array(extractedLineSchema).default([]),
  notes: z.array(z.string()).default([]),
});

export type ExtractedDocument = z.infer<typeof documentSchema>;
