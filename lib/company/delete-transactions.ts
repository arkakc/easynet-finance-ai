import { prisma } from "@/src/lib/prisma";
import { Prisma } from "@prisma/client";
import { appendAuditEvent } from "@/lib/security/audit";

type DbClient = typeof prisma | Prisma.TransactionClient;

export type TransactionSummary = {
  journalHeaders: number;
  journalLines: number;
  invoices: number;
  invoiceLines: number;
  quotes: number;
  quoteLines: number;
  creditNotes: number;
  creditNoteLines: number;
  purchaseOrders: number;
  poLines: number;
  goodsReceipts: number;
  supplierBills: number;
  billLines: number;
  payments: number;
  paymentAllocations: number;
  refunds: number;
  expenses: number;
  bankTransactions: number;
  reconciliations: number;
  stockMovements: number;
  payrollRuns: number;
  payrollItems: number;
  posSessions: number;
  landedCostVouchers: number;
  landedCostItems: number;
  loans: number;
  loanEvents: number;
  fixedAssets: number;
  taxReports: number;
  timeEntries: number;
  approvalRequests: number;
  transactionalDocuments: number;
  totalTransactions: number;
};

export async function getCompanyTransactionsSummary(client: DbClient = prisma): Promise<TransactionSummary> {
  const [
    journalHeaders,
    journalLines,
    invoices,
    invoiceLines,
    quotes,
    quoteLines,
    creditNotes,
    creditNoteLines,
    purchaseOrders,
    poLines,
    goodsReceipts,
    supplierBills,
    billLines,
    payments,
    paymentAllocations,
    refunds,
    expenses,
    bankTransactions,
    reconciliations,
    stockMovements,
    payrollRuns,
    payrollItems,
    posSessions,
    landedCostVouchers,
    landedCostItems,
    loans,
    loanEvents,
    fixedAssets,
    taxReports,
    timeEntries,
    approvalRequests,
    transactionalDocuments,
  ] = await Promise.all([
    client.journalHeader.count(),
    client.journalLine.count(),
    client.invoice.count(),
    client.invoiceLine.count(),
    client.quote.count(),
    client.quoteLine.count(),
    client.creditNote.count(),
    client.creditNoteLine.count(),
    client.purchaseOrder.count(),
    client.pOLine.count(),
    client.goodsReceipt.count(),
    client.supplierBill.count(),
    client.billLine.count(),
    client.payment.count(),
    client.paymentAllocation.count(),
    client.refund.count(),
    client.expense.count(),
    client.bankTransaction.count(),
    client.reconciliation.count(),
    client.stockMovement.count(),
    client.payrollRun.count(),
    client.payrollItem.count(),
    client.posSession.count(),
    client.landedCostVoucher.count(),
    client.landedCostItem.count(),
    client.loan.count(),
    client.loanEvent.count(),
    client.fixedAsset.count(),
    client.taxReport.count(),
    client.timeEntry.count(),
    client.approvalRequest.count(),
    client.document.count({
      where: {
        OR: [
          { type: { in: ["INVOICE", "QUOTE", "PURCHASE_ORDER", "BILL", "RECEIPT", "BANK_STATEMENT"] } },
          { documentType: { in: ["INVOICE", "QUOTE", "PO", "BILL", "RECEIPT"] } },
        ],
      },
    }),
  ]);

  const totalTransactions =
    journalHeaders +
    invoices +
    quotes +
    creditNotes +
    purchaseOrders +
    goodsReceipts +
    supplierBills +
    payments +
    paymentAllocations +
    refunds +
    expenses +
    bankTransactions +
    reconciliations +
    stockMovements +
    payrollRuns +
    posSessions +
    landedCostVouchers +
    loans +
    fixedAssets +
    taxReports +
    timeEntries +
    approvalRequests +
    transactionalDocuments;

  return {
    journalHeaders,
    journalLines,
    invoices,
    invoiceLines,
    quotes,
    quoteLines,
    creditNotes,
    creditNoteLines,
    purchaseOrders,
    poLines,
    goodsReceipts,
    supplierBills,
    billLines,
    payments,
    paymentAllocations,
    refunds,
    expenses,
    bankTransactions,
    reconciliations,
    stockMovements,
    payrollRuns,
    payrollItems,
    posSessions,
    landedCostVouchers,
    landedCostItems,
    loans,
    loanEvents,
    fixedAssets,
    taxReports,
    timeEntries,
    approvalRequests,
    transactionalDocuments,
    totalTransactions,
  };
}

export type DeleteTransactionsOptions = {
  adminUserId?: string;
  adminEmail: string;
  adminName?: string;
  resetStockQuantities?: boolean;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  transactionClient?: Prisma.TransactionClient;
};

export async function deleteCompanyTransactions(options: DeleteTransactionsOptions) {
  const summaryBefore = await getCompanyTransactionsSummary(options.transactionClient || prisma);

  // Execute in careful order to handle foreign keys
  const execute = async (tx: Prisma.TransactionClient) => {
    // 1. Clear references between BankTransactions and payments/invoices/bills
    await tx.bankTransaction.updateMany({
      data: {
        matchedPaymentId: null,
        matchedInvoiceId: null,
        matchedBillId: null,
        reconciliationId: null,
      },
    });
    await tx.bankTransaction.deleteMany({});
    await tx.reconciliation.deleteMany({});

    // 2. Unlink quotes convertedToInvoiceId
    await tx.quote.updateMany({
      data: {
        convertedToInvoiceId: null,
      },
    });

    // 3. Delete payment allocations before Payments / Invoices / Supplier Bills.
    // PaymentAllocation uses ON DELETE RESTRICT for paymentId, invoiceId and billId,
    // so deleting any parent first will fail the factory reset.
    await tx.paymentAllocation.deleteMany({});

    // 4. Delete Payments & Refunds
    await tx.payment.deleteMany({});
    await tx.refund.deleteMany({});

    // 5. Landed cost items & vouchers
    await tx.landedCostItem.deleteMany({});
    await tx.landedCostVoucher.deleteMany({});

    // 6. Credit notes
    await tx.creditNoteLine.deleteMany({});
    await tx.creditNote.deleteMany({});

    // 7. Invoices & InvoiceLines
    await tx.invoiceLine.deleteMany({});
    await tx.invoice.deleteMany({});

    // 8. Time entries
    await tx.timeEntry.deleteMany({});

    // 9. Goods receipts & Purchase Orders & Supplier Bills
    await tx.goodsReceipt.deleteMany({});
    await tx.pOLine.deleteMany({});
    await tx.billLine.deleteMany({});

    // Disconnect PO from SupplierBill
    await tx.supplierBill.updateMany({
      data: { orderId: null },
    });
    await tx.purchaseOrder.deleteMany({});
    await tx.supplierBill.deleteMany({});

    // 10. Quotes
    await tx.quoteLine.deleteMany({});
    await tx.quote.deleteMany({});

    // 11. Expenses
    await tx.expense.deleteMany({});

    // 12. Stock Movements & optional StockLevel balance reset
    await tx.stockMovement.deleteMany({});
    if (options.resetStockQuantities !== false) {
      await tx.stockLevel.updateMany({
        data: {
          quantity: 0,
          reserved: 0,
          available: 0,
        },
      });
    }

    // 13. Payroll runs & items
    await tx.payrollItem.deleteMany({});
    await tx.payrollRun.deleteMany({});

    // 14. POS sessions
    await tx.posSession.deleteMany({});

    // 15. Loans & LoanEvents
    await tx.loanEvent.deleteMany({});
    await tx.loan.deleteMany({});

    // 16. Fixed assets (or reset depreciation & source doc)
    await tx.fixedAsset.deleteMany({});

    // 17. Tax Reports
    await tx.taxReport.deleteMany({});

    // 18. Approval Requests
    await tx.approvalRequest.deleteMany({});

    // 19. General Ledger Journal Lines & Headers
    await tx.journalLine.deleteMany({});
    await tx.journalHeader.deleteMany({});

    // 20. Transactional Documents (leave CERTIFICATE, GST_REGISTRATION, ID_DOCUMENT untouched)
    await tx.document.deleteMany({
      where: {
        OR: [
          { type: { in: ["INVOICE", "QUOTE", "PURCHASE_ORDER", "BILL", "RECEIPT", "BANK_STATEMENT"] } },
          { documentType: { in: ["INVOICE", "QUOTE", "PO", "BILL", "RECEIPT"] } },
        ],
      },
    });

    // 21. Find admin user ID for audit log
    let adminUserId = options.adminUserId;
    if (!adminUserId) {
      const u = await tx.user.findFirst({
        where: {
          OR: [{ email: options.adminEmail }, { role: "SYSTEM_MANAGER" }],
        },
      });
      adminUserId = u?.id;
    }

    // 22. Write a Phase 9 sealed audit event. userId may be null for
    // imported/legacy administrators; actorEmail remains the immutable actor snapshot.
    const audit = await appendAuditEvent({
      action: "DELETE_COMPANY_TRANSACTIONS",
      entityType: "Company",
      entityCode: "ALL_TRANSACTIONS",
      description: `Company transactions wiped by ${options.adminName || options.adminEmail} (${options.adminEmail}). Controlled transaction reset executed.`,
      changes: {
        wipedSummary: summaryBefore,
        resetStockQuantities: options.resetStockQuantities !== false,
      },
      outcome: "SUCCESS",
      requestId: options.requestId || null,
      actorEmail: options.adminEmail,
      userId: adminUserId || null,
      ipAddress: options.ipAddress || null,
      userAgent: options.userAgent || null,
    }, tx);

    return {
      success: true,
      wiped: summaryBefore,
      auditId: audit.id,
    };
  };
  const result = options.transactionClient ? await execute(options.transactionClient) : await prisma.$transaction(execute);

  return result;
}
