import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AccountTypeGL,
  NormalBalance,
  PaymentStatus,
  PaymentType,
} from "@prisma/client";

async function main() {
  const liveDatabase = path.join(process.cwd(), "prisma", "dev.db");
  await fs.access(liveDatabase);

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-multi-currency-uat-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(liveDatabase, temporaryDatabase);
  process.env.EASYNET_PRISMA_DATASOURCE_URL = `file:${temporaryDatabase.replace(/\\/g, "/")}`;

  const [
    { finalizeSalesInvoiceAtomic },
    { finalizeSupplierBillAtomic },
    { finalizePaymentAtomic },
    { postFxRevaluationAtomic },
    { reversePostedJournal },
    { latestExchangeRate },
    { prisma },
  ] = await Promise.all([
    import("../lib/accounting/atomic-sales-invoice"),
    import("../lib/accounting/atomic-supplier-bill"),
    import("../lib/accounting/atomic-payment"),
    import("../lib/accounting/fx-revaluation"),
    import("../lib/accounting/journal-reversal"),
    import("../lib/accounting/currency"),
    import("../src/lib/prisma"),
  ]);

  try {
    const suffix = String(process.pid);
    const account = async (
      code: string,
      name: string,
      type: AccountTypeGL,
      normalBalance: NormalBalance,
    ) => prisma.chartOfAccounts.upsert({
      where: { code },
      update: { name, type, normalBalance, parentId: null, isActive: true },
      create: { code, name, type, normalBalance, isActive: true },
    });

    const [bank, ar, ap, revenue, expense, deferred, fxGain, fxLoss, unrealizedGain, unrealizedLoss, grni, cogs] =
      await Promise.all([
        account(`UAT-FX-BANK-${suffix}`, "UAT FX Bank", AccountTypeGL.ASSET, NormalBalance.DEBIT),
        account(`UAT-FX-AR-${suffix}`, "UAT FX Receivable", AccountTypeGL.ASSET, NormalBalance.DEBIT),
        account(`UAT-FX-AP-${suffix}`, "UAT FX Payable", AccountTypeGL.LIABILITY, NormalBalance.CREDIT),
        account(`UAT-FX-REV-${suffix}`, "UAT FX Revenue", AccountTypeGL.REVENUE, NormalBalance.CREDIT),
        account(`UAT-FX-EXP-${suffix}`, "UAT FX Expense", AccountTypeGL.EXPENSE, NormalBalance.DEBIT),
        account(`UAT-FX-DEF-${suffix}`, "UAT FX Customer Credit", AccountTypeGL.LIABILITY, NormalBalance.CREDIT),
        account(`UAT-FX-GAIN-${suffix}`, "UAT Realized FX Gain", AccountTypeGL.REVENUE, NormalBalance.CREDIT),
        account(`UAT-FX-LOSS-${suffix}`, "UAT Realized FX Loss", AccountTypeGL.EXPENSE, NormalBalance.DEBIT),
        account(`UAT-FX-UGAIN-${suffix}`, "UAT Unrealized FX Gain", AccountTypeGL.REVENUE, NormalBalance.CREDIT),
        account(`UAT-FX-ULOSS-${suffix}`, "UAT Unrealized FX Loss", AccountTypeGL.EXPENSE, NormalBalance.DEBIT),
        account(`UAT-FX-GRNI-${suffix}`, "UAT FX GRNI", AccountTypeGL.LIABILITY, NormalBalance.CREDIT),
        account(`UAT-FX-COGS-${suffix}`, "UAT FX COGS", AccountTypeGL.EXPENSE, NormalBalance.DEBIT),
      ]);

    await Promise.all([
      prisma.globalSettings.upsert({
        where: { key: "currency" },
        create: { key: "currency", value: "PGK" },
        update: { value: "PGK" },
      }),
      prisma.globalSettings.upsert({
        where: { key: "posting_lock_date" },
        create: { key: "posting_lock_date", value: "2098-12-31" },
        update: { value: "2098-12-31" },
      }),
    ]);

    for (const [rateDate, rate] of [
      ["2099-01-01", 4.0],
      ["2099-01-10", 4.2],
      ["2099-01-20", 4.5],
    ] as const) {
      await prisma.exchangeRate.upsert({
        where: {
          rateDate_fromCurrency_toCurrency: {
            rateDate: new Date(`${rateDate}T00:00:00+10:00`),
            fromCurrency: "USD",
            toCurrency: "PGK",
          },
        },
        create: {
          rateDate: new Date(`${rateDate}T00:00:00+10:00`),
          fromCurrency: "USD",
          toCurrency: "PGK",
          rate,
          source: "UAT",
          isManual: true,
          createdBy: "multi-currency-uat",
        },
        update: { rate, source: "UAT" },
      });
    }

    const inverse = await prisma.$transaction((tx) => latestExchangeRate(tx, {
      fromCurrency: "PGK",
      toCurrency: "USD",
      rateDate: "2099-01-10",
    }));
    if (Math.abs(inverse - 1 / 4.2) > 0.00000001) {
      throw new Error("Inverse exchange-rate resolution failed");
    }

    const customer = await prisma.customer.create({
      data: {
        code: `UAT-FX-CUST-${suffix}`,
        name: "UAT USD Customer",
        currency: "USD",
        isActive: true,
      },
    });
    const supplier = await prisma.supplier.create({
      data: {
        code: `UAT-FX-SUP-${suffix}`,
        name: "UAT USD Supplier",
        currency: "USD",
        isActive: true,
      },
    });

    async function createAndPostInvoice(code: string, total: number) {
      const invoice = await prisma.invoice.create({
        data: {
          code,
          customerId: customer.id,
          issuedDate: new Date("2099-01-01T00:00:00+10:00"),
          currency: "USD",
          subtotal: total,
          total,
          outstanding: total,
          status: "DRAFT",
          glPosted: false,
          createdBy: "multi-currency-uat",
        },
      });
      const posted = await finalizeSalesInvoiceAtomic({
        invoiceId: invoice.id,
        postingDate: "2099-01-01",
        documentNumber: invoice.code,
        reference: "USD Sales Invoice UAT",
        customerId: customer.code,
        projectId: "",
        total,
        gst: 0,
        revenueLines: [{
          accountId: `ACC-${revenue.code}`,
          amount: total,
          description: "USD service revenue",
        }],
        stockLines: [],
        receivableAccountId: `ACC-${ar.code}`,
        deferredRevenueAccountId: `ACC-${deferred.code}`,
        inventoryAccountId: "ACC-1200",
        approveIfDraft: true,
        createdBy: "multi-currency-uat",
        approvedBy: "multi-currency-uat",
      });
      return { invoice, posted };
    }

    const invoiceA = await createAndPostInvoice(`UAT-FX-INV-A-${suffix}`, 100);
    const invoiceAAfterPost = await prisma.invoice.findUnique({ where: { id: invoiceA.invoice.id } });
    const invoiceAJournal = await prisma.journalHeader.findUnique({
      where: { code: invoiceA.posted.journalId },
      include: { lines: true },
    });
    if (
      !invoiceAAfterPost
      || Number(invoiceAAfterPost.exchangeRate) !== 4
      || Number(invoiceAAfterPost.baseTotal) !== 400
      || Number(invoiceAAfterPost.baseOutstanding) !== 400
      || !invoiceAJournal
      || invoiceAJournal.currency !== "USD"
      || invoiceAJournal.baseCurrency !== "PGK"
      || Number(invoiceAJournal.totalDebit) !== 400
      || Number(invoiceAJournal.transactionTotalDebit) !== 100
    ) {
      throw new Error("Foreign Sales Invoice base/transaction posting failed");
    }

    const receipt = await prisma.payment.create({
      data: {
        code: `UAT-FX-REC-${suffix}`,
        type: PaymentType.CUSTOMER_RECEIPT,
        date: new Date("2099-01-20T00:00:00+10:00"),
        amount: 100,
        currency: "USD",
        paymentMethod: "BANK",
        status: PaymentStatus.AUTHORIZED,
        customerId: customer.id,
        invoiceId: invoiceA.invoice.id,
        depositAccount: `ACC-${bank.code}`,
        createdBy: "multi-currency-uat",
      },
    });

    const receiptPosted = await finalizePaymentAtomic({
      paymentId: receipt.id,
      postingDate: "2099-01-20",
      amount: 100,
      paymentMethod: "BANK",
      cashBankAccountId: `ACC-${bank.code}`,
      reference: "USD receipt at new rate",
      documentType: "CUSTOMER_RECEIPT",
      documentNumber: receipt.code,
      againstInvoiceId: invoiceA.invoice.id,
      exchangeGainAccountId: `ACC-${fxGain.code}`,
      exchangeLossAccountId: `ACC-${fxLoss.code}`,
      createdBy: "multi-currency-uat",
      approvedBy: "multi-currency-uat",
      lines: [
        { accountId: `ACC-${bank.code}`, debit: 100 },
        { accountId: `ACC-${ar.code}`, credit: 100 },
      ],
    });

    const [receiptAfter, invoiceAAfterReceipt, allocationA, receiptJournal] = await Promise.all([
      prisma.payment.findUnique({ where: { id: receipt.id } }),
      prisma.invoice.findUnique({ where: { id: invoiceA.invoice.id } }),
      prisma.paymentAllocation.findFirst({ where: { paymentId: receipt.id } }),
      prisma.journalHeader.findUnique({ where: { code: receiptPosted.journalId }, include: { lines: { include: { account: true } } } }),
    ]);
    const receiptByCode = new Map((receiptJournal?.lines || []).map((line) => [line.account.code, line]));
    if (
      !receiptAfter
      || Number(receiptAfter.exchangeRate) !== 4.5
      || Number(receiptAfter.baseAmount) !== 450
      || !invoiceAAfterReceipt
      || Number(invoiceAAfterReceipt.outstanding) !== 0
      || Number(invoiceAAfterReceipt.baseOutstanding) !== 0
      || !allocationA
      || Number(allocationA.baseAmount) !== 400
      || Number(allocationA.realizedFx) !== 50
      || Number(receiptByCode.get(fxGain.code)?.credit || 0) !== 50
      || Number(receiptByCode.get(bank.code)?.debit || 0) !== 450
      || Number(receiptByCode.get(ar.code)?.credit || 0) !== 400
    ) {
      throw new Error("Customer receipt realized FX posting failed");
    }

    await reversePostedJournal({
      journalId: receiptPosted.journalId,
      reversalDate: "2099-01-21",
      reason: "Reverse USD receipt UAT",
      createdBy: "multi-currency-uat",
      approvedBy: "multi-currency-uat",
    }, prisma);

    const [invoiceAAfterReverse, allocationAAfterReverse] = await Promise.all([
      prisma.invoice.findUnique({ where: { id: invoiceA.invoice.id } }),
      prisma.paymentAllocation.findUnique({ where: { id: allocationA.id } }),
    ]);
    if (
      !invoiceAAfterReverse
      || Number(invoiceAAfterReverse.outstanding) !== 100
      || Number(invoiceAAfterReverse.baseOutstanding) !== 400
      || !allocationAAfterReverse
      || allocationAAfterReverse.status !== "REVERSED"
    ) {
      throw new Error("FX payment reversal did not restore transaction/base subledger balances");
    }

    const bill = await prisma.supplierBill.create({
      data: {
        code: `UAT-FX-BILL-${suffix}`,
        supplierId: supplier.id,
        billDate: new Date("2099-01-01T00:00:00+10:00"),
        currency: "USD",
        subtotal: 100,
        total: 100,
        outstanding: 100,
        status: "DRAFT",
        glPosted: false,
        createdBy: "multi-currency-uat",
        lines: {
          create: [{
            lineNo: 1,
            description: "USD service cost",
            quantity: 1,
            unitPrice: 100,
            amount: 100,
            costAccount: `ACC-${expense.code}`,
          }],
        },
      },
    });

    const billPosted = await finalizeSupplierBillAtomic({
      billId: bill.id,
      postingDate: "2099-01-01",
      documentNumber: bill.code,
      payableAccountId: `ACC-${ap.code}`,
      stockReceivedButNotBilledAccountId: `ACC-${grni.code}`,
      defaultCostAccountId: `ACC-${cogs.code}`,
      exchangeGainAccountId: `ACC-${fxGain.code}`,
      exchangeLossAccountId: `ACC-${fxLoss.code}`,
      purchasePriceVarianceTolerancePct: 100,
      approveIfDraft: true,
      createdBy: "multi-currency-uat",
      approvedBy: "multi-currency-uat",
    });

    const billAfterPost = await prisma.supplierBill.findUnique({ where: { id: bill.id } });
    if (
      !billAfterPost
      || Number(billAfterPost.baseTotal) !== 400
      || Number(billAfterPost.baseOutstanding) !== 400
    ) {
      throw new Error("Foreign Supplier Invoice base posting failed");
    }

    const supplierPayment = await prisma.payment.create({
      data: {
        code: `UAT-FX-SPAY-${suffix}`,
        type: PaymentType.SUPPLIER_PAYMENT,
        date: new Date("2099-01-20T00:00:00+10:00"),
        amount: 100,
        currency: "USD",
        paymentMethod: "BANK",
        status: PaymentStatus.AUTHORIZED,
        supplierId: supplier.id,
        billId: bill.id,
        depositAccount: `ACC-${bank.code}`,
        createdBy: "multi-currency-uat",
      },
    });

    const supplierPaymentPosted = await finalizePaymentAtomic({
      paymentId: supplierPayment.id,
      postingDate: "2099-01-20",
      amount: 100,
      paymentMethod: "BANK",
      cashBankAccountId: `ACC-${bank.code}`,
      reference: "USD supplier payment at new rate",
      documentType: "SUPPLIER_PAYMENT",
      documentNumber: supplierPayment.code,
      againstBillId: bill.id,
      exchangeGainAccountId: `ACC-${fxGain.code}`,
      exchangeLossAccountId: `ACC-${fxLoss.code}`,
      createdBy: "multi-currency-uat",
      approvedBy: "multi-currency-uat",
      lines: [
        { accountId: `ACC-${ap.code}`, debit: 100 },
        { accountId: `ACC-${bank.code}`, credit: 100 },
      ],
    });

    const supplierPaymentJournal = await prisma.journalHeader.findUnique({
      where: { code: supplierPaymentPosted.journalId },
      include: { lines: { include: { account: true } } },
    });
    const supplierByCode = new Map((supplierPaymentJournal?.lines || []).map((line) => [line.account.code, line]));
    if (
      Number(supplierByCode.get(ap.code)?.debit || 0) !== 400
      || Number(supplierByCode.get(bank.code)?.credit || 0) !== 450
      || Number(supplierByCode.get(fxLoss.code)?.debit || 0) !== 50
    ) {
      throw new Error("Supplier payment realized FX posting failed");
    }

    const invoiceB = await createAndPostInvoice(`UAT-FX-INV-B-${suffix}`, 200);
    const laterPayment = await prisma.payment.create({
      data: {
        code: `UAT-FX-LATE-${suffix}`,
        type: PaymentType.CUSTOMER_RECEIPT,
        date: new Date("2099-01-20T00:00:00+10:00"),
        amount: 200,
        currency: "USD",
        paymentMethod: "BANK",
        status: PaymentStatus.AUTHORIZED,
        customerId: customer.id,
        invoiceId: invoiceB.invoice.id,
        depositAccount: `ACC-${bank.code}`,
        createdBy: "multi-currency-uat",
      },
    });
    await finalizePaymentAtomic({
      paymentId: laterPayment.id,
      postingDate: "2099-01-20",
      amount: 200,
      paymentMethod: "BANK",
      cashBankAccountId: `ACC-${bank.code}`,
      reference: "Post-closing-date receipt",
      documentType: "CUSTOMER_RECEIPT",
      documentNumber: laterPayment.code,
      againstInvoiceId: invoiceB.invoice.id,
      exchangeGainAccountId: `ACC-${fxGain.code}`,
      exchangeLossAccountId: `ACC-${fxLoss.code}`,
      createdBy: "multi-currency-uat",
      approvedBy: "multi-currency-uat",
      lines: [
        { accountId: `ACC-${bank.code}`, debit: 200 },
        { accountId: `ACC-${ar.code}`, credit: 200 },
      ],
    });

    const revaluation = await postFxRevaluationAtomic({
      revaluationDate: "2099-01-10",
      receivableAccountId: `ACC-${ar.code}`,
      payableAccountId: `ACC-${ap.code}`,
      exchangeGainAccountId: `ACC-${unrealizedGain.code}`,
      exchangeLossAccountId: `ACC-${unrealizedLoss.code}`,
      createdBy: "multi-currency-uat",
      approvedBy: "multi-currency-uat",
    });

    const revaluationRecord = await prisma.fxRevaluation.findUnique({
      where: { id: revaluation.revaluationId },
      include: { lines: true },
    });
    const invoiceBRevaluation = revaluationRecord?.lines.find((line) => line.documentId === invoiceB.invoice.id);
    if (
      !invoiceBRevaluation
      || Number(invoiceBRevaluation.outstandingAmount) !== 200
      || Number(invoiceBRevaluation.historicalBase) !== 800
      || Number(invoiceBRevaluation.closingBase) !== 840
      || Number(invoiceBRevaluation.gainAmount) !== 40
    ) {
      throw new Error("Retrospective FX revaluation did not reconstruct closing-date outstanding correctly");
    }

    const [revaluationJournal, reversalJournal] = await Promise.all([
      prisma.journalHeader.findUnique({ where: { code: revaluation.journalId } }),
      prisma.journalHeader.findUnique({ where: { code: revaluation.reversalJournalId } }),
    ]);
    if (
      !revaluationJournal
      || !reversalJournal
      || Number(revaluationJournal.totalDebit) !== Number(revaluationJournal.totalCredit)
      || Number(reversalJournal.totalDebit) !== Number(reversalJournal.totalCredit)
      || reversalJournal.date.toISOString().slice(0, 10) === revaluationJournal.date.toISOString().slice(0, 10)
    ) {
      throw new Error("FX revaluation / auto reversal journals are not balanced or dated correctly");
    }

    const crossCurrencyPayment = await prisma.payment.create({
      data: {
        code: `UAT-FX-CROSS-${suffix}`,
        type: PaymentType.CUSTOMER_RECEIPT,
        date: new Date("2099-01-20T00:00:00+10:00"),
        amount: 10,
        currency: "PGK",
        exchangeRate: 1,
        paymentMethod: "BANK",
        status: PaymentStatus.AUTHORIZED,
        customerId: customer.id,
        invoiceId: invoiceA.invoice.id,
        depositAccount: `ACC-${bank.code}`,
        createdBy: "multi-currency-uat",
      },
    });

    let crossCurrencyBlocked = false;
    try {
      await finalizePaymentAtomic({
        paymentId: crossCurrencyPayment.id,
        postingDate: "2099-01-20",
        amount: 10,
        paymentMethod: "BANK",
        cashBankAccountId: `ACC-${bank.code}`,
        reference: "Cross-currency payment should fail",
        documentType: "CUSTOMER_RECEIPT",
        documentNumber: crossCurrencyPayment.code,
        againstInvoiceId: invoiceA.invoice.id,
        exchangeGainAccountId: `ACC-${fxGain.code}`,
        exchangeLossAccountId: `ACC-${fxLoss.code}`,
        lines: [
          { accountId: `ACC-${bank.code}`, debit: 10 },
          { accountId: `ACC-${ar.code}`, credit: 10 },
        ],
      });
    } catch (error) {
      crossCurrencyBlocked = /cross-currency allocation/i.test(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!crossCurrencyBlocked) throw new Error("Cross-currency settlement was not blocked");

    console.log(JSON.stringify({
      database: "temporary clone",
      liveDatabaseChanged: false,
      baseCurrency: "PGK",
      foreignInvoiceHistoricalRateResolved: Number(invoiceAAfterPost.exchangeRate) === 4,
      foreignInvoiceBaseAmountCorrect: Number(invoiceAAfterPost.baseTotal) === 400,
      journalPreservesTransactionCurrency:
        invoiceAJournal.currency === "USD"
        && Number(invoiceAJournal.transactionTotalDebit) === 100
        && Number(invoiceAJournal.totalDebit) === 400,
      customerReceiptSettlementRateResolved: Number(receiptAfter.exchangeRate) === 4.5,
      customerReceiptRealizedGainPosted: Number(receiptByCode.get(fxGain.code)?.credit || 0) === 50,
      customerReceiptCashBaseCorrect: Number(receiptByCode.get(bank.code)?.debit || 0) === 450,
      paymentAllocationHistoricalBaseCorrect: Number(allocationA.baseAmount) === 400,
      fxPaymentReversalRestoresTransactionOutstanding: Number(invoiceAAfterReverse.outstanding) === 100,
      fxPaymentReversalRestoresBaseOutstanding: Number(invoiceAAfterReverse.baseOutstanding) === 400,
      supplierInvoiceBaseAmountCorrect: Number(billAfterPost.baseTotal) === 400,
      supplierPaymentRealizedLossPosted: Number(supplierByCode.get(fxLoss.code)?.debit || 0) === 50,
      retrospectiveRevaluationUsesClosingDateOutstanding:
        Number(invoiceBRevaluation.outstandingAmount) === 200,
      closingRevaluationGainCorrect: Number(invoiceBRevaluation.gainAmount) === 40,
      revaluationJournalBalanced:
        Number(revaluationJournal.totalDebit) === Number(revaluationJournal.totalCredit),
      automaticReversalJournalBalanced:
        Number(reversalJournal.totalDebit) === Number(reversalJournal.totalCredit),
      inverseRateResolutionWorks: Math.abs(inverse - 1 / 4.2) <= 0.00000001,
      crossCurrencyAllocationBlocked: crossCurrencyBlocked,
      supplierBillJournalId: billPosted.journalId,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
    const resolved = path.resolve(temporaryRoot);
    const root = path.resolve(os.tmpdir());
    if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Unsafe UAT cleanup path");
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
