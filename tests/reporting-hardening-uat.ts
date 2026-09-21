import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AccountTypeGL,
  InvoiceStatus,
  ItemType,
  JournalStatus,
  NormalBalance,
  PrismaClient,
} from "@prisma/client";
import { buildCashFlowStatement } from "../lib/accounting/cash-flow";
import { buildFinancialStatements } from "../lib/accounting/financial-statements";
import { buildFinancialReconciliationSnapshot } from "../lib/system/financial-reconciliation";
import { databasePath } from "../lib/system/database-backup";

async function main() {
  await fs.access(databasePath);
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-reporting-hardening-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(databasePath, temporaryDatabase);
  const client = new PrismaClient({ datasourceUrl: `file:${temporaryDatabase.replace(/\\/g, "/")}` });

  try {
    const suffix = String(process.pid);
    await Promise.all([
      client.globalSettings.upsert({
        where: { key: "currency" },
        create: { key: "currency", value: "USD" },
        update: { value: "USD" },
      }),
      client.globalSettings.upsert({
        where: { key: "base_currency" },
        create: { key: "base_currency", value: "USD" },
        update: { value: "USD" },
      }),
    ]);

    const makeAccount = (
      code: string,
      name: string,
      type: AccountTypeGL,
      normalBalance: NormalBalance,
    ) => client.chartOfAccounts.create({
      data: { code, name, type, normalBalance, isActive: true, currency: "USD" },
    });

    const [cash, equity, revenue, ar, fixedAsset, loan, unrealizedFx] = await Promise.all([
      makeAccount(`CASH-${suffix}`, "UAT Reporting Cash", AccountTypeGL.ASSET, NormalBalance.DEBIT),
      makeAccount(`3108-${suffix}`, "UAT Reporting Equity", AccountTypeGL.EQUITY, NormalBalance.CREDIT),
      makeAccount(`4108-${suffix}`, "UAT Reporting Revenue", AccountTypeGL.REVENUE, NormalBalance.CREDIT),
      makeAccount(`1138-${suffix}`, "UAT Reporting Receivable", AccountTypeGL.ASSET, NormalBalance.DEBIT),
      makeAccount(`1218-${suffix}`, "UAT Reporting Fixed Asset", AccountTypeGL.ASSET, NormalBalance.DEBIT),
      makeAccount(`2218-${suffix}`, "UAT Reporting Loan", AccountTypeGL.LIABILITY, NormalBalance.CREDIT),
      makeAccount(`4938-${suffix}`, "UAT Reporting Unrealized FX", AccountTypeGL.REVENUE, NormalBalance.CREDIT),
    ]);

    await Promise.all([
      client.globalSettings.upsert({
        where: { key: "default_cash_account" },
        create: { key: "default_cash_account", value: `ACC-${cash.code}` },
        update: { value: `ACC-${cash.code}` },
      }),
      client.globalSettings.upsert({
        where: { key: "default_receivable_account" },
        create: { key: "default_receivable_account", value: `ACC-${ar.code}` },
        update: { value: `ACC-${ar.code}` },
      }),
      client.globalSettings.upsert({
        where: { key: "default_payable_account" },
        create: { key: "default_payable_account", value: "ACC-299999" },
        update: { value: "ACC-299999" },
      }),
    ]);

    async function postJournal(input: {
      code: string;
      date: string;
      sourceDocType: string;
      sourceDocId?: string;
      reversalOfJournalId?: string;
      debitAccountId: string;
      creditAccountId: string;
      amount: number;
    }) {
      return client.journalHeader.create({
        data: {
          code: input.code,
          date: new Date(`${input.date}T00:00:00+10:00`),
          description: input.code,
          reference: input.code,
          sourceDocType: input.sourceDocType,
          sourceDocId: input.sourceDocId,
          reversalOfJournalId: input.reversalOfJournalId,
          status: JournalStatus.POSTED,
          currency: "USD",
          baseCurrency: "USD",
          exchangeRate: 1,
          totalDebit: input.amount,
          totalCredit: input.amount,
          transactionTotalDebit: input.amount,
          transactionTotalCredit: input.amount,
          isBalanced: true,
          createdBy: "reporting-hardening-uat",
          approvedBy: "reporting-hardening-uat",
          approvedAt: new Date(),
          postedAt: new Date(),
          lines: {
            create: [
              {
                lineNo: 1,
                accountId: input.debitAccountId,
                description: input.code,
                debit: input.amount,
                credit: 0,
                amount: input.amount,
                currency: "USD",
                transactionCurrency: "USD",
                exchangeRate: 1,
                transactionDebit: input.amount,
                transactionCredit: 0,
                transactionAmount: input.amount,
              },
              {
                lineNo: 2,
                accountId: input.creditAccountId,
                description: input.code,
                debit: 0,
                credit: input.amount,
                amount: input.amount,
                currency: "USD",
                transactionCurrency: "USD",
                exchangeRate: 1,
                transactionDebit: 0,
                transactionCredit: input.amount,
                transactionAmount: input.amount,
              },
            ],
          },
        },
      });
    }

    await postJournal({
      code: `UAT-RPT-OPEN-${suffix}`,
      date: "2098-01-01",
      sourceDocType: "OPENING",
      debitAccountId: cash.id,
      creditAccountId: equity.id,
      amount: 1000,
    });
    await postJournal({
      code: `UAT-RPT-OPER-${suffix}`,
      date: "2098-01-05",
      sourceDocType: "CUSTOMER_RECEIPT",
      debitAccountId: cash.id,
      creditAccountId: revenue.id,
      amount: 200,
    });
    await postJournal({
      code: `UAT-RPT-INVEST-${suffix}`,
      date: "2098-01-10",
      sourceDocType: "ASSET_PURCHASE",
      debitAccountId: fixedAsset.id,
      creditAccountId: cash.id,
      amount: 100,
    });
    await postJournal({
      code: `UAT-RPT-FIN-${suffix}`,
      date: "2098-01-15",
      sourceDocType: "FUNDING_LOAN",
      debitAccountId: cash.id,
      creditAccountId: loan.id,
      amount: 300,
    });
    await postJournal({
      code: `UAT-RPT-FX-${suffix}`,
      date: "2098-01-20",
      sourceDocType: "FX_REVALUATION",
      debitAccountId: cash.id,
      creditAccountId: unrealizedFx.id,
      amount: 50,
    });

    const customer = await client.customer.create({
      data: {
        code: `UAT-RPT-CUST-${suffix}`,
        name: "UAT Historical Customer",
        currency: "USD",
        isActive: true,
      },
    });
    const invoice = await client.invoice.create({
      data: {
        code: `UAT-RPT-INV-${suffix}`,
        customerId: customer.id,
        issuedDate: new Date("2098-01-07T00:00:00+10:00"),
        dueDate: new Date("2098-01-31T00:00:00+10:00"),
        status: InvoiceStatus.VOID,
        currency: "USD",
        exchangeRate: 1,
        subtotal: 100,
        total: 100,
        outstanding: 0,
        baseSubtotal: 100,
        baseTotal: 100,
        baseOutstanding: 0,
        glPosted: true,
        createdBy: "reporting-hardening-uat",
      },
    });
    const invoiceJournal = await postJournal({
      code: `UAT-RPT-AR-${suffix}`,
      date: "2098-01-07",
      sourceDocType: "SALES_INVOICE",
      sourceDocId: invoice.id,
      debitAccountId: ar.id,
      creditAccountId: revenue.id,
      amount: 100,
    });
    await client.invoice.update({
      where: { id: invoice.id },
      data: { journalId: invoiceJournal.code },
    });
    await postJournal({
      code: `UAT-RPT-AR-REV-${suffix}`,
      date: "2098-02-01",
      sourceDocType: "JOURNAL_REVERSAL",
      sourceDocId: `UAT-RPT-AR-REV-DOC-${suffix}`,
      reversalOfJournalId: invoiceJournal.id,
      debitAccountId: revenue.id,
      creditAccountId: ar.id,
      amount: 100,
    });

    const cashFlow = await buildCashFlowStatement(
      { from: "2098-01-01", asOf: "2098-01-31" },
      client,
    );
    if (cashFlow.currency !== "USD") throw new Error("Cash flow did not use configured base currency");
    if (cashFlow.totals.openingCash !== 1000) throw new Error(`Unexpected opening cash: ${cashFlow.totals.openingCash}`);
    if (cashFlow.totals.operating !== 200) throw new Error(`Unexpected operating cash flow: ${cashFlow.totals.operating}`);
    if (cashFlow.totals.investing !== -100) throw new Error(`Unexpected investing cash flow: ${cashFlow.totals.investing}`);
    if (cashFlow.totals.financing !== 300) throw new Error(`Unexpected financing cash flow: ${cashFlow.totals.financing}`);
    if (cashFlow.totals.exchangeRateEffect !== 50) throw new Error(`Unexpected FX translation effect: ${cashFlow.totals.exchangeRateEffect}`);
    if (cashFlow.totals.netCashFlow !== 400) throw new Error(`Unexpected net cash flow: ${cashFlow.totals.netCashFlow}`);
    if (cashFlow.totals.closingCash !== 1450) throw new Error(`Unexpected closing cash: ${cashFlow.totals.closingCash}`);
    if (!cashFlow.control.balanced) throw new Error("Cash flow control does not reconcile to ledger cash");
    if (!cashFlow.rows.some((row) => row.date === "2098-01-20" && row.category === "Exchange Rate Effect")) {
      throw new Error("Cash flow did not preserve PNG accounting date / FX category");
    }

    const beforeReversal = await buildFinancialStatements(
      { from: "2098-01-01", asOf: "2098-01-31" },
      client,
    );
    const beforeRow = beforeReversal.aging.receivables.rows.find((row) => row.id === invoice.id);
    if (!beforeRow || beforeRow.outstanding !== 100) {
      throw new Error("Historical AR aging omitted a document reversed after the reporting date");
    }
    if (beforeRow.dueDate !== "2098-01-31") {
      throw new Error(`AR due date shifted timezone: ${beforeRow.dueDate}`);
    }
    if (!beforeReversal.controls.receivables.matched || beforeReversal.controls.receivables.glBalance !== 100) {
      throw new Error("Configured AR control account did not reconcile before reversal");
    }

    const afterReversal = await buildFinancialStatements(
      { from: "2098-01-01", asOf: "2098-02-02" },
      client,
    );
    if (afterReversal.aging.receivables.rows.some((row) => row.id === invoice.id)) {
      throw new Error("AR aging retained a document after its posted reversal");
    }
    if (!afterReversal.controls.receivables.matched || afterReversal.controls.receivables.glBalance !== 0) {
      throw new Error("AR control did not reconcile after reversal");
    }

    const stockItem = await client.item.create({
      data: {
        code: `UAT-RPT-STOCK-${suffix}`,
        name: "UAT Historical Stock",
        type: ItemType.GOOD,
        unit: "EA",
        trackQty: true,
        purchasePrice: 10,
        isActive: true,
      },
    });
    await client.stockMovement.create({
      data: {
        id: `UAT-RPT-STOCK-IN-${suffix}`,
        itemId: stockItem.id,
        type: "PURCHASE_RECEIPT",
        quantity: 10,
        unitCost: 10,
        totalCost: 100,
        referenceType: "UAT",
        createdAt: new Date("2098-01-12T00:00:00+10:00"),
        createdBy: "reporting-hardening-uat",
      },
    });
    await client.stockMovement.create({
      data: {
        id: `UAT-RPT-STOCK-OUT-${suffix}`,
        itemId: stockItem.id,
        type: "SALES_ISSUE",
        quantity: 4,
        unitCost: 10,
        totalCost: 40,
        referenceType: "UAT",
        createdAt: new Date("2098-02-03T00:00:00+10:00"),
        createdBy: "reporting-hardening-uat",
      },
    });

    const snapshot = await buildFinancialReconciliationSnapshot({
      client,
      asOf: "2098-01-31",
      generatedBy: "reporting-hardening-uat",
      fileName: "reconciliation-20980131-000000-deadbeef.json",
    });
    if (snapshot.currency !== "USD") throw new Error("Reconciliation snapshot did not use configured base currency");
    if (snapshot.receivables.outstanding !== 100 || !snapshot.receivables.matched) {
      throw new Error("Reconciliation snapshot did not use historical AR subledger");
    }
    if (snapshot.inventory.quantityOnHand !== 10 || snapshot.inventory.estimatedValue !== 100) {
      throw new Error(
        `Historical inventory cutoff failed: qty ${snapshot.inventory.quantityOnHand}, value ${snapshot.inventory.estimatedValue}`,
      );
    }
    if (!cashFlow.cashAccounts.some((account) => account.code === cash.code)) {
      throw new Error("Configured non-legacy cash account was omitted from cash flow");
    }

    console.log(JSON.stringify({
      database: "temporary clone",
      liveDatabaseChanged: false,
      baseCurrency: cashFlow.currency,
      cashFlow: cashFlow.totals,
      cashFlowBalanced: cashFlow.control.balanced,
      fxTranslationSeparated: cashFlow.totals.exchangeRateEffect === 50,
      historicalArBeforeReversal: beforeRow.outstanding,
      historicalArAfterReversal: afterReversal.aging.receivables.total,
      configuredArControlMatched: beforeReversal.controls.receivables.matched,
      pngDueDatePreserved: beforeRow.dueDate,
      reconciliationCurrency: snapshot.currency,
      reconciliationHistoricalAr: snapshot.receivables.outstanding,
      configuredCashAccountIncluded: cashFlow.cashAccounts.some((account) => account.code === cash.code),
      historicalInventoryQuantity: snapshot.inventory.quantityOnHand,
      historicalInventoryValue: snapshot.inventory.estimatedValue,
    }, null, 2));
  } finally {
    await client.$disconnect();
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
