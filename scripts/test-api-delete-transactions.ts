(process.env as Record<string, string>).NODE_ENV = "development";

import { POST } from "../app/api/company/transactions/route";
import { GET } from "../app/api/company/transactions/route";
import { prisma } from "../src/lib/prisma";
import { createSessionToken, sessionCookie } from "../lib/auth";

async function testApi() {
  console.log("==================================================");
  console.log("🧪 Testing Delete Transactions API Route");
  console.log("==================================================");

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

  // 1. Test GET summary
  const getReq = new Request("http://localhost:3000/api/company/transactions", {
    method: "GET",
    headers,
  });
  const getRes = await GET(getReq);
  const getData = await getRes.json();
  console.log(`GET summary response status: ${getRes.status}`);
  console.log(`Configured Company: ${getData.companyName}`);
  console.log(`Total Transactions before: ${getData.summary?.totalTransactions}`);

  // 2. Test Invalid Password (re-authentication failure)
  const badPassReq = new Request("http://localhost:3000/api/company/transactions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      password: "WrongPassword123!",
      companyNameConfirmation: "Easynet IT Solutions Limited",
    }),
  });
  const badPassRes = await POST(badPassReq);
  const badPassData = await badPassRes.json();
  console.log(`\nInvalid password test: HTTP ${badPassRes.status}`);
  console.log(`Error: ${badPassData.error}`);
  if (badPassRes.status !== 401) throw new Error("Expected 401 for wrong password");

  // 3. Test Invalid Company Name Confirmation
  const badNameReq = new Request("http://localhost:3000/api/company/transactions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      password: "Admin123!",
      companyNameConfirmation: "Wrong Company Name",
    }),
  });
  const badNameRes = await POST(badNameReq);
  const badNameData = await badNameRes.json();
  console.log(`\nInvalid company confirmation test: HTTP ${badNameRes.status}`);
  console.log(`Error: ${badNameData.error}`);
  if (badNameRes.status !== 400) throw new Error("Expected 400 for wrong company confirmation");

  // 4. Test Valid Delete Execution
  console.log("\n⚡ Calling POST with valid credentials & confirmation...");
  const validReq = new Request("http://localhost:3000/api/company/transactions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      password: "Admin123!",
      companyNameConfirmation: "Easynet IT Solutions Limited",
      resetStockQuantities: true,
    }),
  });
  const validRes = await POST(validReq);
  const validData = await validRes.json();
  console.log(`Valid delete test: HTTP ${validRes.status}`);
  console.log(`Message: ${validData.message}`);
  console.log(`Audit ID: ${validData.auditId}`);
  if (validRes.status !== 200 || !validData.ok) {
    throw new Error(`Delete failed: ${validData.error}`);
  }

  // 5. Verify post-wipe state
  const postGetReq = new Request("http://localhost:3000/api/company/transactions", {
    method: "GET",
    headers,
  });
  const postGetRes = await GET(postGetReq);
  const postGetData = await postGetRes.json();
  console.log(`\nTransactions count after API wipe: ${postGetData.summary?.totalTransactions}`);
  if (postGetData.summary?.totalTransactions !== 0) {
    throw new Error("Expected 0 transactions after API delete!");
  }

  console.log("\n🎉 API ROUTE TESTS PASSED 100%!");
}

testApi()
  .catch((e) => {
    console.error("❌ Test failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
