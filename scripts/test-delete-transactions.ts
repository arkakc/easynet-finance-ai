import { prisma } from "../src/lib/prisma";
import {
  getCompanyTransactionsSummary,
  deleteCompanyTransactions,
} from "../lib/company/delete-transactions";

async function runTest() {
  console.log("==================================================");
  console.log("🧪 Testing Delete Company Transactions Feature");
  console.log("==================================================");

  // 1. Initial State Check
  const before = await getCompanyTransactionsSummary();
  console.log(`Initial total transactions: ${before.totalTransactions}`);
  console.log(`- Journal headers: ${before.journalHeaders}`);
  console.log(`- Invoices: ${before.invoices}`);
  console.log(`- Supplier bills: ${before.supplierBills}`);
  console.log(`- Payments: ${before.payments}`);

  const initialCoaCount = await prisma.chartOfAccounts.count();
  const initialCustomerCount = await prisma.customer.count();
  const initialSupplierCount = await prisma.supplier.count();
  const initialItemCount = await prisma.item.count();
  const initialUserCount = await prisma.user.count();

  console.log("\nMaster data baseline:");
  console.log(`- Chart of Accounts: ${initialCoaCount}`);
  console.log(`- Customers: ${initialCustomerCount}`);
  console.log(`- Suppliers: ${initialSupplierCount}`);
  console.log(`- Items: ${initialItemCount}`);
  console.log(`- Users: ${initialUserCount}`);

  // 2. Perform Delete Company Transactions
  console.log("\n⚡ Executing deleteCompanyTransactions() with admin credentials...");
  const deleteResult = await deleteCompanyTransactions({
    adminEmail: "admin@easynet.local",
    adminName: "Arka C (System Administrator)",
    resetStockQuantities: true,
    ipAddress: "127.0.0.1",
    userAgent: "AutomatedTestRunner/1.0",
  });

  console.log(`✅ Delete completed. Audit Log ID: ${deleteResult.auditId}`);

  // 3. Verify Transactions are Wiped
  const after = await getCompanyTransactionsSummary();
  console.log(`\nPost-wipe total transactions: ${after.totalTransactions}`);
  if (after.totalTransactions !== 0) {
    throw new Error(`Expected 0 transactions after wipe, but found ${after.totalTransactions}`);
  }
  console.log("✓ All transactional data confirmed wiped (0 records)");

  // 4. Verify Master Data is Intact
  const afterCoaCount = await prisma.chartOfAccounts.count();
  const afterCustomerCount = await prisma.customer.count();
  const afterSupplierCount = await prisma.supplier.count();
  const afterItemCount = await prisma.item.count();
  const afterUserCount = await prisma.user.count();

  if (afterCoaCount !== initialCoaCount) throw new Error("Chart of accounts was modified!");
  if (afterCustomerCount !== initialCustomerCount) throw new Error("Customer master was modified!");
  if (afterSupplierCount !== initialSupplierCount) throw new Error("Supplier master was modified!");
  if (afterItemCount !== initialItemCount) throw new Error("Item catalog was modified!");
  if (afterUserCount !== initialUserCount) throw new Error("User accounts were modified!");

  console.log("✓ All master data confirmed preserved 100%");

  // 5. Verify Audit Log entry
  const audit = await prisma.auditLog.findUnique({
    where: { id: deleteResult.auditId },
  });
  if (!audit || audit.action !== "DELETE_COMPANY_TRANSACTIONS") {
    throw new Error("Audit log entry missing or invalid!");
  }
  console.log(`✓ Audit log verified: [${audit.action}] ${audit.description}`);

  console.log("\n🎉 ALL TESTS PASSED!");
}

runTest()
  .catch((e) => {
    console.error("❌ Test failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
