(process.env as Record<string, string>).NODE_ENV = "development";

import { prisma } from "../src/lib/prisma";
import { getMasterDataSummary } from "../lib/company/delete-master-data";
import { GET, POST } from "../app/api/company/master-data/route";
import { createSessionToken, sessionCookie } from "../lib/auth";

async function runMasterDataTest() {
  console.log("==================================================");
  console.log("🧪 Testing Delete Master Data (Factory Reset) Feature");
  console.log("==================================================");

  // 1. Initial State Check
  const before = await getMasterDataSummary();
  console.log(`Initial total master records: ${before.totalMasterRecords}`);
  console.log(`- Chart of Accounts: ${before.chartOfAccounts}`);
  console.log(`- Customers: ${before.customers}`);
  console.log(`- Suppliers: ${before.suppliers}`);
  console.log(`- Items: ${before.items}`);
  console.log(`- Bank Accounts: ${before.bankAccounts}`);
  console.log(`- Tax Codes: ${before.taxCodes}`);
  console.log(`- Employees: ${before.employees}`);
  console.log(`- Global Settings: ${before.globalSettings}`);
  console.log(`- Users: ${before.users}`);

  // Setup admin session cookie header
  const adminUser = {
    email: "admin@easynet.local",
    name: "System Administrator",
    roles: ["System Manager" as const],
    permissions: ["settings.manage" as const, "dashboard.read" as const],
  };
  const token = createSessionToken(adminUser);
  const headers = {
    "Content-Type": "application/json",
    cookie: `${sessionCookie.name}=${token}`,
  };

  // 2. Test GET route
  const getReq = new Request("http://localhost:3000/api/company/master-data", {
    method: "GET",
    headers,
  });
  const getRes = await GET(getReq);
  const getData = await getRes.json();
  console.log(`\nGET master data summary: HTTP ${getRes.status}`);
  console.log(`Total Master Records: ${getData.summary?.totalMasterRecords}`);
  if (getRes.status !== 200) throw new Error("Expected 200 from GET");

  // 3. Test Invalid Password (re-authentication failure)
  const badPassReq = new Request("http://localhost:3000/api/company/master-data", {
    method: "POST",
    headers,
    body: JSON.stringify({
      password: "WrongPassword123!",
      confirmationPhrase: "WIPE ALL MASTER DATA",
    }),
  });
  const badPassRes = await POST(badPassReq);
  const badPassData = await badPassRes.json();
  console.log(`\nInvalid password test: HTTP ${badPassRes.status}`);
  console.log(`Error: ${badPassData.error}`);
  if (badPassRes.status !== 401) throw new Error("Expected 401 for wrong password");

  // 4. Test Invalid Confirmation Phrase
  const badPhraseReq = new Request("http://localhost:3000/api/company/master-data", {
    method: "POST",
    headers,
    body: JSON.stringify({
      password: "Admin123!",
      confirmationPhrase: "delete please",
    }),
  });
  const badPhraseRes = await POST(badPhraseReq);
  const badPhraseData = await badPhraseRes.json();
  console.log(`\nInvalid confirmation phrase test: HTTP ${badPhraseRes.status}`);
  console.log(`Error: ${badPhraseData.error}`);
  if (badPhraseRes.status !== 400) throw new Error("Expected 400 for wrong confirmation phrase");

  // 5. Test Valid Master Data Wipe Execution
  console.log("\n⚡ Calling POST with valid credentials & confirmation phrase...");
  const validReq = new Request("http://localhost:3000/api/company/master-data", {
    method: "POST",
    headers,
    body: JSON.stringify({
      password: "Admin123!",
      confirmationPhrase: "WIPE ALL MASTER DATA",
      preserveAdminUser: true,
    }),
  });
  const validRes = await POST(validReq);
  const validData = await validRes.json();
  console.log(`Valid master data wipe test: HTTP ${validRes.status}`);
  console.log(`Message: ${validData.message}`);
  console.log(`Audit ID: ${validData.auditId}`);
  if (validRes.status !== 200 || !validData.ok) {
    throw new Error(`Master data wipe failed: ${validData.error}`);
  }

  // 6. Verify post-wipe state
  const after = await getMasterDataSummary();
  console.log(`\nPost-wipe master data breakdown:`);
  console.log(`- Chart of Accounts: ${after.chartOfAccounts} (expected 0)`);
  console.log(`- Customers: ${after.customers} (expected 0)`);
  console.log(`- Suppliers: ${after.suppliers} (expected 0)`);
  console.log(`- Items: ${after.items} (expected 0)`);
  console.log(`- Bank Accounts: ${after.bankAccounts} (expected 0)`);
  console.log(`- Tax Codes: ${after.taxCodes} (expected 0)`);
  console.log(`- Employees: ${after.employees} (expected 0)`);
  console.log(`- Global Settings: ${after.globalSettings} (expected 0)`);
  console.log(`- Users: ${after.users} (expected 1 preserved admin user)`);

  if (after.chartOfAccounts !== 0) throw new Error("Chart of Accounts not wiped!");
  if (after.customers !== 0) throw new Error("Customers not wiped!");
  if (after.suppliers !== 0) throw new Error("Suppliers not wiped!");
  if (after.items !== 0) throw new Error("Items not wiped!");
  if (after.bankAccounts !== 0) throw new Error("Bank accounts not wiped!");
  if (after.taxCodes !== 0) throw new Error("Tax codes not wiped!");
  if (after.employees !== 0) throw new Error("Employees not wiped!");
  if (after.globalSettings !== 0) throw new Error("Settings not wiped!");
  if (after.users !== 1) throw new Error("Expected exactly 1 preserved admin user!");

  // Verify preserved user is the admin
  const preservedUser = await prisma.user.findFirst();
  console.log(`Preserved user: ${preservedUser?.email} (${preservedUser?.name}) - Role: ${preservedUser?.role}`);
  if (preservedUser?.email.toLowerCase() !== "admin@easynet.local") {
    throw new Error("Preserved user is not the admin user!");
  }

  // Verify Audit Log
  const audit = await prisma.auditLog.findUnique({
    where: { id: validData.auditId },
  });
  if (!audit || audit.action !== "DELETE_COMPANY_MASTER_DATA") {
    throw new Error("Audit log entry for master data wipe missing!");
  }
  console.log(`✓ Audit log verified: [${audit.action}] ${audit.description}`);

  console.log("\n🎉 ALL MASTER DATA TESTS PASSED 100%!");
}

runMasterDataTest()
  .catch((e) => {
    console.error("❌ Test failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
