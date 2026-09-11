import { prisma } from "@/src/lib/prisma";

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

export async function getCompanyTransactionsSummary(): Promise<TransactionSummary> {
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
    prisma.journalHeader.count(),
    prisma.journalLine.count(),
    prisma.invoice.count(),
    prisma.invoiceLine.count(),
    prisma.quote.count(),
    prisma.quoteLine.count(),
    prisma.creditNote.count(),
    prisma.creditNoteLine.count(),
    prisma.purchaseOrder.count(),
    prisma.pOLine.count(),
    prisma.goodsReceipt.count(),
    prisma.supplierBill.count(),
    prisma.billLine.count(),
    prisma.payment.count(),
    prisma.refund.count(),
    prisma.expense.count(),
    prisma.bankTransaction.count(),
    prisma.reconciliation.count(),
    prisma.stockMovement.count(),
    prisma.payrollRun.count(),
    prisma.payrollItem.count(),
    prisma.posSession.count(),
    prisma.landedCostVoucher.count(),
    prisma.landedCostItem.count(),
    prisma.loan.count(),
    prisma.loanEvent.count(),
    prisma.fixedAsset.count(),
    prisma.taxReport.count(),
    prisma.timeEntry.count(),
    prisma.approvalRequest.count(),
    prisma.document.count({
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
};

export async function deleteCompanyTransactions(options: DeleteTransactionsOptions) {
  const summaryBefore = await getCompanyTransactionsSummary();

  // Execute in careful order to handle foreign keys
  const result = await prisma.$transaction(async (tx) => {
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

    // 3. Delete Payments & Refunds
    await tx.payment.deleteMany({});
    await tx.refund.deleteMany({});

    // 4. Landed cost items & vouchers
    await tx.landedCostItem.deleteMany({});
    await tx.landedCostVoucher.deleteMany({});

    // 5. Credit notes
    await tx.creditNoteLine.deleteMany({});
    await tx.creditNote.deleteMany({});

    // 6. Invoices & InvoiceLines
    await tx.invoiceLine.deleteMany({});
    await tx.invoice.deleteMany({});

    // 7. Time entries
    await tx.timeEntry.deleteMany({});

    // 8. Goods receipts & Purchase Orders & Supplier Bills
    await tx.goodsReceipt.deleteMany({});
    await tx.pOLine.deleteMany({});
    await tx.billLine.deleteMany({});

    // Disconnect PO from SupplierBill
    await tx.supplierBill.updateMany({
      data: { orderId: null },
    });
    await tx.purchaseOrder.deleteMany({});
    await tx.supplierBill.deleteMany({});

    // 9. Quotes
    await tx.quoteLine.deleteMany({});
    await tx.quote.deleteMany({});

    // 10. Expenses
    await tx.expense.deleteMany({});

    // 11. Stock Movements & optional StockLevel balance reset
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

    // 12. Payroll runs & items
    await tx.payrollItem.deleteMany({});
    await tx.payrollRun.deleteMany({});

    // 13. POS sessions
    await tx.posSession.deleteMany({});

    // 14. Loans & LoanEvents
    await tx.loanEvent.deleteMany({});
    await tx.loan.deleteMany({});

    // 15. Fixed assets (or reset depreciation & source doc)
    await tx.fixedAsset.deleteMany({});

    // 16. Tax Reports
    await tx.taxReport.deleteMany({});

    // 17. Approval Requests
    await tx.approvalRequest.deleteMany({});

    // 18. General Ledger Journal Lines & Headers
    await tx.journalLine.deleteMany({});
    await tx.journalHeader.deleteMany({});

    // 19. Transactional Documents (leave CERTIFICATE, GST_REGISTRATION, ID_DOCUMENT untouched)
    await tx.document.deleteMany({
      where: {
        OR: [
          { type: { in: ["INVOICE", "QUOTE", "PURCHASE_ORDER", "BILL", "RECEIPT", "BANK_STATEMENT"] } },
          { documentType: { in: ["INVOICE", "QUOTE", "PO", "BILL", "RECEIPT"] } },
        ],
      },
    });

    // 20. Find admin user ID for audit log
    let adminUserId = options.adminUserId;
    if (!adminUserId) {
      const u = await tx.user.findFirst({
        where: {
          OR: [{ email: options.adminEmail }, { role: "SYSTEM_MANAGER" }],
        },
      });
      adminUserId = u?.id;
    }

    // Fallback if no user ID exists in DB
    if (!adminUserId) {
      const firstUser = await tx.user.findFirst();
      adminUserId = firstUser?.id || "admin-system";
    }

    // 21. Write an immutable AuditLog entry
    const audit = await tx.auditLog.create({
      data: {
        action: "DELETE_COMPANY_TRANSACTIONS",
        entityType: "Company",
        entityCode: "ALL_TRANSACTIONS",
        description: `Company transactions wiped by ${options.adminName || options.adminEmail} (${options.adminEmail}). ERPNext-style transaction reset executed.`,
        changes: JSON.stringify({
          wipedSummary: summaryBefore,
          resetStockQuantities: options.resetStockQuantities !== false,
          timestamp: new Date().toISOString(),
        }),
        userId: adminUserId,
        ipAddress: options.ipAddress || null,
        userAgent: options.userAgent || null,
      },
    });

    return {
      success: true,
      wiped: summaryBefore,
      auditId: audit.id,
    };
  });

  return result;
}
