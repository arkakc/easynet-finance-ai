import { prisma } from "@/src/lib/prisma";
import { deleteCompanyTransactions } from "./delete-transactions";

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

export async function getMasterDataSummary(): Promise<MasterDataSummary> {
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
    prisma.chartOfAccounts.count(),
    prisma.customer.count(),
    prisma.supplier.count(),
    prisma.contact.count(),
    prisma.item.count(),
    prisma.bankAccount.count(),
    prisma.taxCode.count(),
    prisma.currency.count(),
    prisma.employee.count(),
    prisma.project.count(),
    prisma.globalSettings.count(),
    prisma.user.count(),
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
};

export async function deleteCompanyMasterData(options: DeleteMasterDataOptions) {
  // Step 1: Ensure all dependent transactional data is wiped first
  await deleteCompanyTransactions({
    adminEmail: options.adminEmail,
    adminName: options.adminName,
    resetStockQuantities: true,
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
  });

  const masterSummaryBefore = await getMasterDataSummary();

  // Step 2: Atomic deletion of all Master Data records
  const result = await prisma.$transaction(async (tx) => {
    // 1. Delete Contacts & Projects
    await tx.contact.deleteMany({});
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

    // 10. Handle User accounts
    let preservedAdminId: string | null = null;
    if (options.preserveAdminUser !== false) {
      const adminUser = await tx.user.findFirst({
        where: {
          OR: [
            { email: options.adminEmail.toLowerCase() },
            { role: "SYSTEM_MANAGER" },
            { email: "admin@easynet.local" },
          ],
        },
      });

      if (adminUser) {
        preservedAdminId = adminUser.id;
        // Delete all other users
        await tx.user.deleteMany({
          where: { id: { not: adminUser.id } },
        });
        // Clear non-admin sessions & accounts
        await tx.session.deleteMany({
          where: { userId: { not: adminUser.id } },
        });
        await tx.userPreferences.deleteMany({
          where: { userId: { not: adminUser.id } },
        });
        await tx.favorite.deleteMany({
          where: { userId: { not: adminUser.id } },
        });
      }
    } else {
      // If full wipe without preservation, clear all sessions and preferences
      await tx.session.deleteMany({});
      await tx.userPreferences.deleteMany({});
      await tx.favorite.deleteMany({});
      await tx.account.deleteMany({});
      // Keep at least one admin account to prevent absolute lock-out
      const primaryAdmin = await tx.user.findFirst({
        where: { email: "admin@easynet.local" },
      });
      if (primaryAdmin) {
        preservedAdminId = primaryAdmin.id;
        await tx.user.deleteMany({ where: { id: { not: primaryAdmin.id } } });
      }
    }

    // 11. Record immutable audit log entry
    const audit = await tx.auditLog.create({
      data: {
        action: "DELETE_COMPANY_MASTER_DATA",
        entityType: "Company",
        entityCode: "ALL_MASTER_DATA",
        description: `Complete Master Data Factory Reset executed by ${options.adminName || options.adminEmail} (${options.adminEmail}). All master entities wiped.`,
        changes: JSON.stringify({
          wipedMasterSummary: masterSummaryBefore,
          preservedAdminId,
          timestamp: new Date().toISOString(),
        }),
        userId: preservedAdminId || "admin-system",
        ipAddress: options.ipAddress || null,
        userAgent: options.userAgent || null,
      },
    });

    return {
      success: true,
      wiped: masterSummaryBefore,
      auditId: audit.id,
    };
  });

  return result;
}
