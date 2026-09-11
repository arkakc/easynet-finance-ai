async function main() {
  const loginRes = await fetch("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@easynet.local", password: "Admin123!" }),
  });
  console.log("Login status:", loginRes.status);
  const cookie = loginRes.headers.get("set-cookie");
  console.log("Set-Cookie:", cookie ? cookie.split(";")[0] : null);

  const cookieHeader = cookie ? cookie.split(";")[0] : "";

  console.log("\n=== 1. Fetching /api/erp/transactions with Referer (purchase) ===");
  const res1 = await fetch("http://localhost:3000/api/erp/transactions", {
    headers: {
      Cookie: cookieHeader,
      Referer: "http://localhost:3000/transactions?module=purchase&tab=supplierQuote&mode=list"
    }
  });
  const data1 = await res1.json();
  console.log("Status:", res1.status, "Scope:", data1.scope, "supplierQuotes:", data1.supplierQuotes?.length);
  if (data1.supplierQuotes?.length) {
    console.log("Found quotation:", data1.supplierQuotes[0].poNumber, data1.supplierQuotes[0].totalAmount, data1.supplierQuotes[0].status);
  }

  console.log("\n=== 2. Fetching /api/erp/transactions with Referer (sales) ===");
  const res2 = await fetch("http://localhost:3000/api/erp/transactions", {
    headers: {
      Cookie: cookieHeader,
      Referer: "http://localhost:3000/transactions?module=sales&tab=salesQuote&mode=list"
    }
  });
  const data2 = await res2.json();
  console.log("Status:", res2.status, "Scope:", data2.scope, "quotes:", data2.quotes?.length, "invoices:", data2.invoices?.length);

  console.log("\n=== 3. Fetching /api/erp/transactions with Referer (expense) ===");
  const res3 = await fetch("http://localhost:3000/api/erp/transactions", {
    headers: {
      Cookie: cookieHeader,
      Referer: "http://localhost:3000/transactions?module=expense&tab=expense&mode=list"
    }
  });
  const data3 = await res3.json();
  console.log("Status:", res3.status, "Scope:", data3.scope, "expenses:", data3.expenses?.length);

  console.log("\n=== 4. Fetching /api/masters with Referer (purchase) ===");
  const res4 = await fetch("http://localhost:3000/api/masters", {
    headers: {
      Cookie: cookieHeader,
      Referer: "http://localhost:3000/transactions?module=purchase&tab=supplierQuote&mode=list"
    }
  });
  const data4 = await res4.json();
  console.log("Status:", res4.status, "Scope:", data4.scope, "suppliers:", data4.suppliers?.length);
}

main().catch(console.error);
