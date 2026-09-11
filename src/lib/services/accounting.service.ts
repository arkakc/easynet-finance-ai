/**
 * Accounting & Tax Service (Papua New Guinea SME Edition)
 * Handles Chart of Accounts, Journal Entries, Double-Entry Validation,
 * and IRC Form GST-01 Tax Return Generation.
 */

import { prisma } from '@/lib/prisma';

export interface Gst01ReturnData {
  period: string; // e.g. "2026-08"
  periodStart: Date;
  periodEnd: Date;
  box1TotalSales: number; // Gross sales including GST
  box2ZeroRated: number; // Zero rated exports
  box3Exempt: number; // Exempt sales
  box5TaxableSales: number; // Box 1 - Box 2 - Box 3
  box7GstOnSales: number; // Output tax (10%)
  box11GstOnPurchases: number; // Input tax credits on business purchases (10%)
  box13Section65aCredits: number; // S65A GST Withheld by Mining/Govt clients
  box14NetGstPayable: number; // Box 7 - Box 11 - Box 13
  isRefundDue: boolean;
}

/**
 * Generate Papua New Guinea IRC Form GST-01 Data for a given month
 */
export async function generateIrcGst01Return(year: number, month: number): Promise<Gst01ReturnData> {
  const periodStart = new Date(year, month - 1, 1);
  const periodEnd = new Date(year, month, 0, 23, 59, 59, 999);
  const periodStr = `${year}-${String(month).padStart(2, '0')}`;

  // 1. Fetch Sales Invoices issued in this period
  const invoices = await prisma.invoice.findMany({
    where: {
      issuedDate: {
        gte: periodStart,
        lte: periodEnd,
      },
      status: {
        notIn: ['CANCELLED', 'VOID'],
      },
    },
  });

  let box1TotalSales = 0;
  let box7GstOnSales = 0;
  let box13Section65aCredits = 0;

  for (const inv of invoices) {
    box1TotalSales += Number(inv.total);
    box7GstOnSales += Number(inv.taxTotal);
    box13Section65aCredits += Number(inv.s65aAmount || 0);
  }

  // 2. Fetch Supplier Bills recorded in this period for Input Tax Credits
  const bills = await prisma.supplierBill.findMany({
    where: {
      billDate: {
        gte: periodStart,
        lte: periodEnd,
      },
      status: {
        notIn: ['CANCELLED', 'VOID'],
      },
    },
  });

  let box11GstOnPurchases = 0;
  for (const bill of bills) {
    box11GstOnPurchases += Number(bill.taxTotal);
  }

  const box2ZeroRated = 0;
  const box3Exempt = 0;
  const box5TaxableSales = Math.max(0, box1TotalSales - box2ZeroRated - box3Exempt);

  const netGst = box7GstOnSales - box11GstOnPurchases - box13Section65aCredits;
  const isRefundDue = netGst < 0;

  return {
    period: periodStr,
    periodStart,
    periodEnd,
    box1TotalSales: parseFloat(box1TotalSales.toFixed(2)),
    box2ZeroRated: parseFloat(box2ZeroRated.toFixed(2)),
    box3Exempt: parseFloat(box3Exempt.toFixed(2)),
    box5TaxableSales: parseFloat(box5TaxableSales.toFixed(2)),
    box7GstOnSales: parseFloat(box7GstOnSales.toFixed(2)),
    box11GstOnPurchases: parseFloat(box11GstOnPurchases.toFixed(2)),
    box13Section65aCredits: parseFloat(box13Section65aCredits.toFixed(2)),
    box14NetGstPayable: parseFloat(Math.abs(netGst).toFixed(2)),
    isRefundDue,
  };
}

/**
 * Validate Double-Entry balancing
 */
export function validateJournalBalance(lines: Array<{ debit: number; credit: number }>) {
  const totalDebit = lines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + Number(l.credit || 0), 0);
  const diff = Math.abs(totalDebit - totalCredit);

  return {
    totalDebit: parseFloat(totalDebit.toFixed(2)),
    totalCredit: parseFloat(totalCredit.toFixed(2)),
    isBalanced: diff < 0.01,
    difference: parseFloat(diff.toFixed(2)),
  };
}

/**
 * Helper to get or create a standard Chart of Accounts entry
 */
export async function getOrCreateAccount(
  code: string,
  name: string,
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'
) {
  let account = await prisma.chartOfAccounts.findUnique({
    where: { code },
  });

  if (!account) {
    account = await prisma.chartOfAccounts.create({
      data: {
        code,
        name,
        type,
        currency: 'PGK',
        isSystem: true,
      },
    });
  }

  return account;
}
