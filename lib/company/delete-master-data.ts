import { prisma } from "@/src/lib/prisma";
import { Prisma } from "@prisma/client";
import { deleteCompanyTransactions } from "./delete-transactions";
import { appendAuditEvent } from "@/lib/security/audit";

type DbClient = typeof prisma | Prisma.TransactionClient;

export type MasterDataSummary = {
  chartOfAccounts: number;
  customers: number;
  suppliers: number;
  contacts: number;
  items: number;
  bankAccounts: number;
  taxCodes: number;
  currencies: number;
  employees: number;
  projects: number;
  globalSettings: number;
  users: number;
  totalMasterRecords: number;
};

export async function getMasterDataSummary(client: DbClient = prisma): Promise<MasterDataSummary> {
  const [
    chartOfAccounts,
    customers,
    suppliers,
    contacts,
    items,
    bankAccounts,
    taxCodes,
    currencies,
    employees,
    projects,
    globalSettings,
    users,
  ] = await Promise.all([
    client.chartOfAccounts.count(),
    client.customer.count(),
    client.supplier.count(),
    client.contact.count(),
    client.item.count(),
    client.bankAccount.count(),
    client.taxCode.count(),
    client.currency.count(),
    client.employee.count(),
    client.project.count(),
    client.globalSettings.count(),
    client.user.count(),
  ]);

  const totalMasterRecords =
    chartOfAccounts +
    customers +
    suppliers +
    contacts +
    items +
    bankAccounts +
    taxCodes +
    currencies +
    employees +
    projects +
    globalSettings +
    users;

  return {
    chartOfAccounts,
    customers,
    suppliers,
    contacts,
    items,
    bankAccounts,
    taxCodes,
    currencies,
    employees,
    projects,
    globalSettings,
    users,
    totalMasterRecords,
  };
}

export type DeleteMasterDataOptions = {
  adminUserId?: string;
  adminEmail: string;
  adminName?: string;
  preserveAdminUser?: boolean;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  // Injectable Prisma client for isolated UAT clones; production callers use the default singleton.
  database?: typeof prisma;
};

export async function deleteCompanyMasterData(options: DeleteMasterDataOptions) {
  const database = options.database || prisma;
  const masterSummaryBefore = await getMasterDataSummary(database);

  // Transactions and master data must be removed in one transaction. Otherwise a
  // failed master delete could leave the company half-wiped after transactions
  // have already been committed.
  const result = await database.$transaction(async (tx) => {
    // Step 1: Ensure all dependent transactional data is wiped first
    await deleteCompanyTransactions({
      adminEmail: options.adminEmail,
      adminName: options.adminName,
      resetStockQuantities: true,
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
      requestId: options.requestId,
      transactionClient: tx,
    });

    // Step 2: Atomic deletion of all Master Data records
    // 1. Delete Contacts & Projects
    await tx.contact.deleteMany({});
    // Budgets reference projects, customers and chart-of-accounts rows.
    await tx.budget.deleteMany({});
    await tx.project.deleteMany({});

    // 2. Delete Fixed Assets
    await tx.fixedAsset.deleteMany({});

    // 3. Delete Item Stock Levels & Items
    await tx.stockLevel.deleteMany({});
    await tx.item.deleteMany({});

    // 4. Delete Customers & Suppliers
    await tx.customer.deleteMany({});
    await tx.supplier.deleteMany({});

    // 5. Unlink Chart of Accounts from Bank Accounts and delete Bank Accounts
    await tx.bankAccount.updateMany({
      data: { chartOfAccountsId: null },
    });
    await tx.bankAccount.deleteMany({});

    // 6. Break Chart of Accounts self-referential hierarchy cycles then delete all accounts
    await tx.chartOfAccounts.updateMany({
      data: { parentId: null },
    });
    await tx.chartOfAccounts.deleteMany({});

    // 7. Delete Tax Codes, Exchange Rates, and Currencies
    await tx.taxCode.deleteMany({});
    await tx.exchangeRate.deleteMany({});
    await tx.currency.deleteMany({});

    // 8. Delete Employees
    await tx.employee.deleteMany({});

    // 9. Delete Global Settings & Company Profile
    await tx.globalSettings.deleteMany({});

    // 10. Delete all retained source documents for a true fresh-company reset.
    // Approval requests were already cleared by the transaction wipe.
    await tx.favorite.deleteMany({});
    await tx.document.deleteMany({});

    // 11. Handle User accounts. Phase 9 AuditLog.userId uses ON DELETE SET NULL,
    // so sealed audit records must never be rewritten during a factory reset.
    const adminUser = await tx.user.findFirst({
      where: options.preserveAdminUser !== false
        ? { OR: [{ email: options.adminEmail.toLowerCase() }, { role: "SYSTEM_MANAGER" }, { email: "admin@easynet.local" }] }
        : { email: "admin@easynet.local" },
    });
    if (!adminUser) throw new Error("Cannot complete factory reset: a primary System Manager account is required");
    const preservedAdminId = adminUser.id;
    await tx.authThrottle.deleteMany({});
    await tx.session.deleteMany({ where: { userId: { not: preservedAdminId } } });
    await tx.userPreferences.deleteMany({ where: { userId: { not: preservedAdminId } } });
    await tx.favorite.deleteMany({ where: { userId: { not: preservedAdminId } } });
    await tx.user.deleteMany({ where: { id: { not: preservedAdminId } } });

    // 12. Record a sealed Phase 9 audit event after the reset.
    const audit = await appendAuditEvent({
      action: "DELETE_COMPANY_MASTER_DATA",
      entityType: "Company",
      entityCode: "ALL_MASTER_DATA",
      description: `Complete Master Data Factory Reset executed by ${options.adminName || options.adminEmail} (${options.adminEmail}). All master entities wiped.`,
      changes: {
        wipedMasterSummary: masterSummaryBefore,
        preservedAdminId,
      },
      outcome: "SUCCESS",
      requestId: options.requestId || null,
      actorEmail: options.adminEmail,
      userId: preservedAdminId,
      ipAddress: options.ipAddress || null,
      userAgent: options.userAgent || null,
    }, tx);

    return {
      success: true,
      wiped: masterSummaryBefore,
      auditId: audit.id,
    };
  });

  return result;
}
