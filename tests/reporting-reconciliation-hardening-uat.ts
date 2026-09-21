import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AccountTypeGL,
  BillStatus,
  InvoiceStatus,
  ItemType,
  JournalStatus,
  MovementType,
  NormalBalance,
  PaymentAllocationStatus,
  PaymentAllocationType,
  PaymentStatus,
  PaymentType,
  PrismaClient,
  ReconciliationStatus,
} from "@prisma/client";
import { buildCashFlowStatement } from "../lib/accounting/cash-flow";
import { buildTrialBalance } from "../lib/accounting/trial-balance";
import { buildFinancialReconciliationSnapshot } from "../lib/system/financial-reconciliation";

async function main() {
  const sourceDatabase = path.join(process.cwd(), "prisma", "dev.db");
  await fs.access(sourceDatabase);

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-phase8-reconciliation-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(sourceDatabase, temporaryDatabase);

  const client = new PrismaClient({
    datasourceUrl: `file:${temporaryDatabase.replace(/\\/g, "/")}`,
  });

  try {
    const suffix = String(process.pid);
    const createAccount = async (
      code: string,
      name: string,
      type: AccountTypeGL,
      normalBalance: NormalBalance,
      parentId?: string,
    ) => client.chartOfAccounts.create({
      data: {
        code,
        name,
        type,
        normalBalance,
        parentId: parentId || null,
        isActive: true,
      },
    });

    const arGroup = await createAccount(
      `UAT8-AR-G-${suffix}`,
      "Phase 8 AR Control",
      AccountTypeGL.ASSET,
      NormalBalance.DEBIT,
    );
    const ar = await createAccount(
      `UAT8-AR-${suffix}`,
      "Phase 8 AR Ledger",
      AccountTypeGL.ASSET,
      NormalBalance.DEBIT,
      arGroup.id,
    );
    const apGroup = await createAccount(
      `UAT8-AP-G-${suffix}`,
      "Phase 8 AP Control",
      AccountTypeGL.LIABILITY,
      NormalBalance.CREDIT,
    );
    const ap = await createAccount(
      `UAT8-AP-${suffix}`,
      "Phase 8 AP Ledger",
      AccountTypeGL.LIABILITY,
      NormalBalance.CREDIT,
      apGroup.id,
    );
    const inventoryGroup = await createAccount(
      `UAT8-INV-G-${suffix}`,
      "Phase 8 Inventory Control",
      AccountTypeGL.ASSET,
      NormalBalance.DEBIT,
    );
    const inventory = await createAccount(
      `UAT8-INV-${suffix}`,
      "Phase 8 Inventory Ledger",
      AccountTypeGL.ASSET,
      NormalBalance.DEBIT,
      inventoryGroup.id,
    );
    const bank = await createAccount(
      `UAT8-BANK-${suffix}`,
      "Phase 8 Bank",
      AccountTypeGL.ASSET,
      NormalBalance.DEBIT,
    );
    const revenue = await createAccount(
      `UAT8-REV-${suffix}`,
      "Phase 8 Revenue",
      AccountTypeGL.REVENUE,
      NormalBalance.CREDIT,
    );
    const expense = await createAccount(
      `UAT8-EXP-${suffix}`,
      "Phase 8 Expense",
      AccountTypeGL.EXPENSE,
      NormalBalance.DEBIT,
    );
    const grni = await createAccount(
      `UAT8-GRNI-${suffix}`,
      "Phase 8 GRNI",
      AccountTypeGL.LIABILITY,
      NormalBalance.CREDIT,
    );
    const equity = await createAccount(
      `UAT8-EQ-${suffix}`,
      "Phase 8 Equity",
      AccountTypeGL.EQUITY,
      NormalBalance.CREDIT,
    );

    await Promise.all([
      client.globalSettings.upsert({
        where: { key: "currency" },
        create: { key: "currency", value: "PGK" },
        update: { value: "PGK" },
      }),
      client.globalSettings.upsert({
        where: { key: "default_receivable_account" },
        create: { key: "default_receivable_account", value: arGroup.code },
        update: { value: arGroup.code },
      }),
      client.globalSettings.upsert({
        where: { key: "default_payable_account" },
        create: { key: "default_payable_account", value: apGroup.code },
        update: { value: apGroup.code },
      }),
      client.globalSettings.upsert({
        where: { key: "default_inventory_account" },
        create: { key: "default_inventory_account", value: inventoryGroup.code },
        update: { value: inventoryGroup.code },
      }),
    ]);

    const customer = await client.customer.create({
      data: {
        code: `UAT8-CUST-${suffix}`,
        name: "Phase 8 Customer",
        currency: "USD",
        isActive: true,
      },
    });
    const supplier = await client.supplier.create({
      data: {
        code: `UAT8-SUP-${suffix}`,
        name: "Phase 8 Supplier",
        currency: "USD",
        isActive: true,
      },
    });
    const item = await client.item.create({
      data: {
        code: `UAT8-ITEM-${suffix}`,
        name: "Phase 8 Stock Item",
        type: ItemType.GOOD,
        unit: "Each",
        purchasePrice: 50,
        trackQty: true,
        isActive: true,
      },
    });
    const warehouse = await client.warehouse.create({
      data: {
        code: `UAT8-WH-${suffix}`,
        name: "Phase 8 Warehouse",
        isDefault: true,
        isActive: true,
      },
    });

    async function journal(input: {
      code: string;
      date: string;
      debitAccountId: string;
      creditAccountId: string;
      amount: number;
      sourceDocType: string;
      sourceDocId: string;
    }) {
      return client.journalHeader.create({
        data: {
          code: input.code,
          date: new Date(`${input.date}T00:00:00+10:00`),
          description: input.sourceDocType,
          reference: input.code,
          sourceDocType: input.sourceDocType,
          sourceDocId: input.sourceDocId,
          status: JournalStatus.POSTED,
          currency: "PGK",
          baseCurrency: "PGK",
          exchangeRate: 1,
          totalDebit: input.amount,
          totalCredit: input.amount,
          transactionTotalDebit: input.amount,
          transactionTotalCredit: input.amount,
          isBalanced: true,
          createdBy: "phase8-uat",
          approvedBy: "phase8-uat",
          approvedAt: new Date(),
          postedAt: new Date(),
          lines: {
            create: [
              {
                lineNo: 1,
                accountId: input.debitAccountId,
                description: input.sourceDocType,
                debit: input.amount,
                credit: 0,
                amount: input.amount,
                currency: "PGK",
                transactionCurrency: "PGK",
                exchangeRate: 1,
                transactionDebit: input.amount,
                transactionCredit: 0,
                transactionAmount: input.amount,
              },
              {
                lineNo: 2,
                accountId: input.creditAccountId,
                description: input.sourceDocType,
                debit: 0,
                credit: input.amount,
                amount: input.amount,
                currency: "PGK",
                transactionCurrency: "PGK",
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

    await journal({
      code: `UAT8-JRN-BANK-${suffix}`,
      date: "2026-01-01",
      debitAccountId: bank.id,
      creditAccountId: equity.id,
      amount: 100,
      sourceDocType: "OPENING",
      sourceDocId: `UAT8-OPENING-${suffix}`,
    });

    const invoice = await client.invoice.create({
      data: {
        code: `UAT8-INV-${suffix}`,
        customerId: customer.id,
        issuedDate: new Date("2026-01-10T00:00:00+10:00"),
        dueDate: new Date("2026-01-20T00:00:00+10:00"),
        status: InvoiceStatus.PAID,
        currency: "USD",
        exchangeRate: 4,
        subtotal: 100,
        total: 100,
        amountPaid: 100,
        outstanding: 0,
        baseSubtotal: 400,
        baseTotal: 400,
        baseAmountPaid: 400,
        baseOutstanding: 0,
        glPosted: true,
        createdBy: "phase8-uat",
      },
    });
    await journal({
      code: `UAT8-JRN-AR-${suffix}`,
      date: "2026-01-10",
      debitAccountId: ar.id,
      creditAccountId: revenue.id,
      amount: 400,
      sourceDocType: "SALES_INVOICE",
      sourceDocId: invoice.id,
    });

    const bill = await client.supplierBill.create({
      data: {
        code: `UAT8-BILL-${suffix}`,
        supplierId: supplier.id,
        billDate: new Date("2026-01-12T00:00:00+10:00"),
        dueDate: new Date("2026-01-22T00:00:00+10:00"),
        status: BillStatus.PAID,
        currency: "USD",
        exchangeRate: 4,
        subtotal: 75,
        total: 75,
        amountPaid: 75,
        outstanding: 0,
        baseSubtotal: 300,
        baseTotal: 300,
        baseAmountPaid: 300,
        baseOutstanding: 0,
        glPosted: true,
        createdBy: "phase8-uat",
      },
    });
    await journal({
      code: `UAT8-JRN-AP-${suffix}`,
      date: "2026-01-12",
      debitAccountId: expense.id,
      creditAccountId: ap.id,
      amount: 300,
      sourceDocType: "SUPPLIER_INVOICE",
      sourceDocId: bill.id,
    });

    await client.stockMovement.create({
      data: {
        id: `UAT8-STOCK-${suffix}`,
        itemId: item.id,
        warehouseId: warehouse.id,
        type: MovementType.PURCHASE_RECEIPT,
        quantity: 5,
        unitCost: 50,
        totalCost: 250,
        referenceType: "PURCHASE_RECEIPT",
        referenceId: `UAT8-PR-${suffix}`,
        createdAt: new Date("2026-01-15T00:00:00+10:00"),
        createdBy: "phase8-uat",
      },
    });
    await journal({
      code: `UAT8-JRN-STOCK-${suffix}`,
      date: "2026-01-15",
      debitAccountId: inventory.id,
      creditAccountId: grni.id,
      amount: 250,
      sourceDocType: "PURCHASE_RECEIPT",
      sourceDocId: `UAT8-PR-${suffix}`,
    });

    const customerPayment = await client.payment.create({
      data: {
        code: `UAT8-PAY-C-${suffix}`,
        type: PaymentType.CUSTOMER_RECEIPT,
        date: new Date("2026-02-10T00:00:00+10:00"),
        amount: 100,
        baseAmount: 400,
        currency: "USD",
        exchangeRate: 4,
        paymentMethod: "BANK",
        status: PaymentStatus.CLEARED,
        customerId: customer.id,
        invoiceId: invoice.id,
        createdBy: "phase8-uat",
      },
    });
    await client.paymentAllocation.create({
      data: {
        code: `UAT8-ALLOC-C-${suffix}`,
        paymentId: customerPayment.id,
        invoiceId: invoice.id,
        allocationDate: new Date("2026-02-10T00:00:00+10:00"),
        amount: 100,
        baseAmount: 400,
        currency: "USD",
        exchangeRate: 4,
        realizedFx: 0,
        allocationType: PaymentAllocationType.DIRECT,
        status: PaymentAllocationStatus.POSTED,
        createdBy: "phase8-uat",
      },
    });

    const supplierPayment = await client.payment.create({
      data: {
        code: `UAT8-PAY-S-${suffix}`,
        type: PaymentType.SUPPLIER_PAYMENT,
        date: new Date("2026-02-12T00:00:00+10:00"),
        amount: 75,
        baseAmount: 300,
        currency: "USD",
        exchangeRate: 4,
        paymentMethod: "BANK",
        status: PaymentStatus.CLEARED,
        supplierId: supplier.id,
        billId: bill.id,
        createdBy: "phase8-uat",
      },
    });
    await client.paymentAllocation.create({
      data: {
        code: `UAT8-ALLOC-S-${suffix}`,
        paymentId: supplierPayment.id,
        billId: bill.id,
        allocationDate: new Date("2026-02-12T00:00:00+10:00"),
        amount: 75,
        baseAmount: 300,
        currency: "USD",
        exchangeRate: 4,
        realizedFx: 0,
        allocationType: PaymentAllocationType.DIRECT,
        status: PaymentAllocationStatus.POSTED,
        createdBy: "phase8-uat",
      },
    });

    const bankAccount = await client.bankAccount.create({
      data: {
        code: `UAT8-BA-${suffix}`,
        name: "Phase 8 Operating Bank",
        bankName: "UAT Bank",
        currency: "PGK",
        isActive: true,
        chartOfAccountsId: bank.id,
      },
    });
    await client.reconciliation.create({
      data: {
        bankAccountId: bankAccount.id,
        periodStart: new Date("2026-01-01T00:00:00+10:00"),
        periodEnd: new Date("2026-01-31T23:59:59.999+10:00"),
        statementBalance: 100,
        bookBalance: 100,
        difference: 0,
        status: ReconciliationStatus.COMPLETED,
        preparedBy: "phase8-uat",
        reviewedBy: "phase8-uat",
        reviewedAt: new Date(),
      },
    });

    const clean = await buildFinancialReconciliationSnapshot({
      client,
      asOf: "2026-01-31",
      generatedBy: "phase8-uat",
      source: "local-sqlite",
    });

    if (!clean.controls.ledgerBalanced) throw new Error("Controlled ledger is not balanced");
    if (!clean.controls.receivablesMatched || clean.receivables.outstanding !== 400) {
      throw new Error(`Historical AR reconstruction failed: ${clean.receivables.outstanding}/${clean.receivables.difference}`);
    }
    if (!clean.controls.payablesMatched || clean.payables.outstanding !== 300) {
      throw new Error(`Historical AP reconstruction failed: ${clean.payables.outstanding}/${clean.payables.difference}`);
    }
    if (!clean.controls.inventoryMatched || clean.inventory.estimatedValue !== 250) {
      throw new Error(`Inventory reconciliation failed: ${clean.inventory.estimatedValue}/${clean.inventory.difference}`);
    }
    if (!clean.controls.bankReconciliationsMatched || clean.banking.reconciliationDrift !== 0) {
      throw new Error(`Bank reconciliation control failed: ${clean.banking.reconciliationDrift}`);
    }
    if (!clean.controls.migrationReady) {
      throw new Error(`Clean reconciliation fixture is not ready: ${clean.controls.exceptions.join("; ")}`);
    }

    const trialBalance = await buildTrialBalance({
      startDate: "2026-01-01",
      asOf: "2026-01-31",
    }, client);
    if (
      trialBalance.currency !== "PGK"
      || !trialBalance.totals.balanced
      || trialBalance.totals.difference !== 0
      || trialBalance.totals.debit !== trialBalance.totals.credit
    ) {
      throw new Error(
        `Trial-balance control failed: ${trialBalance.currency}/${trialBalance.totals.debit}/${trialBalance.totals.credit}/${trialBalance.totals.difference}`,
      );
    }

    const cashFlow = await buildCashFlowStatement({
      from: "2026-01-01",
      asOf: "2026-01-31",
    }, client);
    if (cashFlow.currency !== "PGK" || cashFlow.totals.closingCash !== 100 || !cashFlow.control.balanced) {
      throw new Error(
        `Cash-flow base-currency control failed: ${cashFlow.currency}/${cashFlow.totals.closingCash}/${cashFlow.control.difference}`,
      );
    }

    await journal({
      code: `UAT8-JRN-BACKDATED-${suffix}`,
      date: "2026-01-25",
      debitAccountId: bank.id,
      creditAccountId: equity.id,
      amount: 10,
      sourceDocType: "BACKDATED_ADJUSTMENT",
      sourceDocId: `UAT8-BACKDATED-${suffix}`,
    });

    const drifted = await buildFinancialReconciliationSnapshot({
      client,
      asOf: "2026-01-31",
      generatedBy: "phase8-uat",
      source: "local-sqlite",
    });
    if (drifted.controls.bankReconciliationsMatched) {
      throw new Error("Backdated bank ledger change was not detected");
    }
    if (drifted.banking.reconciliationDrift !== 10) {
      throw new Error(`Expected bank reconciliation drift 10.00, received ${drifted.banking.reconciliationDrift}`);
    }
    if (drifted.controls.migrationReady) {
      throw new Error("Snapshot remained migration-ready after reconciliation drift");
    }

    console.log(JSON.stringify({
      database: "temporary clone",
      liveDatabaseChanged: false,
      asOf: clean.asOf,
      currency: clean.currency,
      ledgerBalanced: clean.controls.ledgerBalanced,
      ar: {
        controlAccount: clean.receivables.controlAccount,
        glBalance: clean.receivables.glBalance,
        historicalOutstanding: clean.receivables.outstanding,
        difference: clean.receivables.difference,
      },
      ap: {
        controlAccount: clean.payables.controlAccount,
        glBalance: clean.payables.glBalance,
        historicalOutstanding: clean.payables.outstanding,
        difference: clean.payables.difference,
      },
      inventory: {
        controlAccount: clean.inventory.controlAccount,
        glBalance: clean.inventory.glBalance,
        valuation: clean.inventory.estimatedValue,
        difference: clean.inventory.difference,
      },
      bank: {
        glBookBalance: clean.banking.glBookBalance,
        reconciliationDriftBefore: clean.banking.reconciliationDrift,
        reconciliationDriftAfterBackdatedEntry: drifted.banking.reconciliationDrift,
        backdatedEntryDetected: !drifted.controls.bankReconciliationsMatched,
      },
      trialBalance: {
        currency: trialBalance.currency,
        debit: trialBalance.totals.debit,
        credit: trialBalance.totals.credit,
        difference: trialBalance.totals.difference,
        balanced: trialBalance.totals.balanced,
      },
      cashFlow: {
        currency: cashFlow.currency,
        closingCash: cashFlow.totals.closingCash,
        ledgerClosingCash: cashFlow.control.ledgerClosingCash,
        difference: cashFlow.control.difference,
      },
      cleanMigrationReady: clean.controls.migrationReady,
      driftedMigrationReady: drifted.controls.migrationReady,
    }, null, 2));
  } finally {
    await client.$disconnect();
    const resolved = path.resolve(temporaryRoot);
    const tmp = path.resolve(os.tmpdir());
    if (!resolved.startsWith(`${tmp}${path.sep}`)) throw new Error("Unsafe UAT cleanup path");
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
