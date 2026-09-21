import { prisma } from "@/src/lib/prisma";
import { companyBaseCurrency, normalizeCurrency, roundCurrency } from "@/lib/accounting/currency";

type PreviewBlocker = {
  model: string;
  id: string;
  code: string;
  currency: string;
  reason: string;
};

export async function backfillMultiCurrency(options: { apply?: boolean } = {}) {
  const apply = options.apply === true;
  const baseCurrency = await prisma.$transaction((tx) => companyBaseCurrency(tx));

  const [quotes, purchaseOrders, invoices, bills, payments, allocations, journals, journalLines] = await Promise.all([
    prisma.quote.findMany(),
    prisma.purchaseOrder.findMany(),
    prisma.invoice.findMany(),
    prisma.supplierBill.findMany(),
    prisma.payment.findMany(),
    prisma.paymentAllocation.findMany(),
    prisma.journalHeader.findMany(),
    prisma.journalLine.findMany(),
  ]);

  const blockers: PreviewBlocker[] = [];
  const inspect = (
    model: string,
    rows: Array<{ id: string; code?: string | null; currency?: string | null; exchangeRate?: unknown; status?: unknown }>,
    posted: (row: any) => boolean,
  ) => {
    for (const row of rows) {
      const currency = normalizeCurrency(row.currency || baseCurrency);
      const rate = Number(row.exchangeRate || 0);
      if (currency !== baseCurrency && posted(row) && !(rate > 0)) {
        blockers.push({
          model,
          id: row.id,
          code: String(row.code || row.id),
          currency,
          reason: "Posted foreign-currency record has no historical exchange rate",
        });
      }
    }
  };

  inspect("Quote", quotes as any[], (row) => String(row.status || "") !== "DRAFT");
  inspect("PurchaseOrder", purchaseOrders as any[], (row) => String(row.status || "") !== "DRAFT");
  inspect("Invoice", invoices as any[], (row) => Boolean(row.glPosted));
  inspect("SupplierBill", bills as any[], (row) => Boolean(row.glPosted));
  inspect("Payment", payments as any[], (row) => ["CAPTURED", "CLEARED", "REVERSED"].includes(String(row.status || "")));
  inspect("JournalHeader", journals as any[], (row) => String(row.status || "") === "POSTED");

  const baseStats = {
    quotes: quotes.filter((row) => normalizeCurrency(row.currency || baseCurrency) === baseCurrency).length,
    purchaseOrders: purchaseOrders.filter((row) => normalizeCurrency(row.currency || baseCurrency) === baseCurrency).length,
    invoices: invoices.filter((row) => normalizeCurrency(row.currency || baseCurrency) === baseCurrency).length,
    bills: bills.filter((row) => normalizeCurrency(row.currency || baseCurrency) === baseCurrency).length,
    payments: payments.filter((row) => normalizeCurrency(row.currency || baseCurrency) === baseCurrency).length,
    allocations: allocations.filter((row) => normalizeCurrency(row.currency || baseCurrency) === baseCurrency).length,
    journals: journals.filter((row) => normalizeCurrency(row.currency || baseCurrency) === baseCurrency).length,
    journalLines: journalLines.filter((row) => normalizeCurrency(row.currency || baseCurrency) === baseCurrency).length,
  };

  if (!apply) {
    return {
      mode: "PREVIEW" as const,
      baseCurrency,
      blockers,
      safeBaseCurrencyRows: baseStats,
      action: blockers.length
        ? "Resolve posted foreign-currency records with missing historical rates before applying."
        : "Safe to backfill base-currency records and FX audit fields.",
    };
  }

  if (blockers.length) {
    throw new Error(
      `Multi-currency backfill blocked: ${blockers.length} posted foreign-currency record(s) have no historical exchange rate`,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const counts = {
      quotes: 0,
      purchaseOrders: 0,
      invoices: 0,
      bills: 0,
      payments: 0,
      allocations: 0,
      journals: 0,
      journalLines: 0,
    };

    for (const row of quotes) {
      const currency = normalizeCurrency(row.currency || baseCurrency);
      if (currency !== baseCurrency) continue;
      await tx.quote.update({
        where: { id: row.id },
        data: {
          currency: baseCurrency,
          exchangeRate: 1,
          baseSubtotal: roundCurrency(Number(row.subtotal || 0)),
          baseTaxTotal: roundCurrency(Number(row.taxTotal || 0)),
          baseDiscountTotal: roundCurrency(Number(row.discountTotal || 0)),
          baseTotal: roundCurrency(Number(row.total || 0)),
        },
      });
      counts.quotes += 1;
    }

    for (const row of purchaseOrders) {
      const currency = normalizeCurrency(row.currency || baseCurrency);
      if (currency !== baseCurrency) continue;
      await tx.purchaseOrder.update({
        where: { id: row.id },
        data: {
          currency: baseCurrency,
          exchangeRate: 1,
          baseSubtotal: roundCurrency(Number(row.subtotal || 0)),
          baseTaxTotal: roundCurrency(Number(row.taxTotal || 0)),
          baseFreight: roundCurrency(Number(row.freight || 0)),
          baseDiscountTotal: roundCurrency(Number(row.discountTotal || 0)),
          baseTotal: roundCurrency(Number(row.total || 0)),
        },
      });
      counts.purchaseOrders += 1;
    }

    for (const row of invoices) {
      const currency = normalizeCurrency(row.currency || baseCurrency);
      if (currency !== baseCurrency) continue;
      await tx.invoice.update({
        where: { id: row.id },
        data: {
          currency: baseCurrency,
          exchangeRate: 1,
          baseSubtotal: roundCurrency(Number(row.subtotal || 0)),
          baseTaxTotal: roundCurrency(Number(row.taxTotal || 0)),
          baseDiscountTotal: roundCurrency(Number(row.discountTotal || 0)),
          baseTotal: roundCurrency(Number(row.total || 0)),
          baseAmountPaid: roundCurrency(Number(row.amountPaid || 0)),
          baseOutstanding: roundCurrency(Number(row.outstanding || 0)),
        },
      });
      counts.invoices += 1;
    }

    for (const row of bills) {
      const currency = normalizeCurrency(row.currency || baseCurrency);
      if (currency !== baseCurrency) continue;
      await tx.supplierBill.update({
        where: { id: row.id },
        data: {
          currency: baseCurrency,
          exchangeRate: 1,
          baseSubtotal: roundCurrency(Number(row.subtotal || 0)),
          baseTaxTotal: roundCurrency(Number(row.taxTotal || 0)),
          baseDiscountTotal: roundCurrency(Number(row.discountTotal || 0)),
          baseFreight: roundCurrency(Number(row.freight || 0)),
          baseTotal: roundCurrency(Number(row.total || 0)),
          baseAmountPaid: roundCurrency(Number(row.amountPaid || 0)),
          baseOutstanding: roundCurrency(Number(row.outstanding || 0)),
        },
      });
      counts.bills += 1;
    }

    for (const row of payments) {
      const currency = normalizeCurrency(row.currency || baseCurrency);
      if (currency !== baseCurrency) continue;
      await tx.payment.update({
        where: { id: row.id },
        data: {
          currency: baseCurrency,
          exchangeRate: 1,
          baseAmount: roundCurrency(Number(row.amount || 0)),
        },
      });
      counts.payments += 1;
    }

    for (const row of allocations) {
      const currency = normalizeCurrency(row.currency || baseCurrency);
      if (currency !== baseCurrency) continue;
      await tx.paymentAllocation.update({
        where: { id: row.id },
        data: {
          currency: baseCurrency,
          exchangeRate: 1,
          baseAmount: roundCurrency(Number(row.amount || 0)),
          realizedFx: 0,
        },
      });
      counts.allocations += 1;
    }

    for (const row of journals) {
      const currency = normalizeCurrency(row.currency || baseCurrency);
      if (currency !== baseCurrency) continue;
      await tx.journalHeader.update({
        where: { id: row.id },
        data: {
          currency: baseCurrency,
          baseCurrency,
          exchangeRate: 1,
          transactionTotalDebit: roundCurrency(Number(row.totalDebit || 0)),
          transactionTotalCredit: roundCurrency(Number(row.totalCredit || 0)),
        },
      });
      counts.journals += 1;
    }

    for (const row of journalLines) {
      const currency = normalizeCurrency(row.currency || baseCurrency);
      if (currency !== baseCurrency) continue;
      await tx.journalLine.update({
        where: { id: row.id },
        data: {
          currency: baseCurrency,
          transactionCurrency: baseCurrency,
          exchangeRate: 1,
          transactionDebit: roundCurrency(Number(row.debit || 0)),
          transactionCredit: roundCurrency(Number(row.credit || 0)),
          transactionAmount: roundCurrency(Math.max(Number(row.debit || 0), Number(row.credit || 0))),
        },
      });
      counts.journalLines += 1;
    }

    return counts;
  });

  return {
    mode: "LIVE" as const,
    baseCurrency,
    blockers: [],
    updated: result,
  };
}
