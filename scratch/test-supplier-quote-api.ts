import { createSessionToken } from "../lib/auth";

async function test() {
  const token = createSessionToken({
    email: "admin@easynet.local",
    name: "Test System Administrator",
    roles: ["System Manager"],
    permissions: [
      "dashboard.read",
      "sales.read",
      "sales.write",
      "purchase.read",
      "purchase.write",
      "stock.read",
      "stock.write",
      "accounts.read",
      "accounts.write",
      "reports.read",
      "users.manage",
      "settings.manage",
      "post.approve",
    ],
  });

  console.log("--- 1. Testing POST /api/erp/actions (create supplier) ---");
  const res1 = await fetch("http://localhost:3000/api/erp/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `easynet_session=${token}` },
    body: JSON.stringify({
      target: "masters",
      body: {
        type: "supplier",
        mode: "create",
        record: {
          supplierName: "Papua IT Supplies Ltd",
          contactPerson: "John Doe",
          phone: "71234567",
          email: "john@papuaitsupplies.com",
        }
      }
    })
  });
  const data1 = await res1.json();
  console.log("Status create supplier:", res1.status, data1);
  const createdSupplierId = data1.row?.supplierId || data1.result?.row?.supplierId;

  console.log("\n--- 2. Testing POST /api/erp/actions (create project) ---");
  const res2 = await fetch("http://localhost:3000/api/erp/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `easynet_session=${token}` },
    body: JSON.stringify({
      target: "masters",
      body: {
        type: "project",
        mode: "create",
        record: {
          projectName: "POM Data Center Upgrade",
          customerId: "",
          status: "OPEN",
        }
      }
    })
  });
  const data2 = await res2.json();
  console.log("Status create project (empty customerId):", res2.status, data2);
  const createdProjectId = data2.row?.projectId || data2.result?.row?.projectId;

  console.log("\n--- 3. Testing GET /api/masters/scoped?scope=supplier ---");
  const res3 = await fetch("http://localhost:3000/api/masters/scoped?scope=supplier", {
    headers: { Cookie: `easynet_session=${token}` }
  });
  const data3 = await res3.json();
  console.log("Status /api/masters/scoped:", res3.status, "Suppliers count:", data3.suppliers?.length);

  console.log("\n--- 4. Testing POST /api/erp/transactions (createSupplierQuote) ---");
  const res4 = await fetch("http://localhost:3000/api/erp/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `easynet_session=${token}` },
    body: JSON.stringify({
      action: "createSupplierQuote",
      payload: {
        partyId: createdSupplierId,
        projectId: createdProjectId,
        documentDate: "2026-09-11",
        lines: [
          {
            description: "Server Rack 42U",
            qty: 2,
            uom: "Units",
            rate: 2500,
          }
        ]
      }
    })
  });
  const data4 = await res4.json();
  console.log("Status createSupplierQuote:", res4.status, data4);
  const quoteId = data4.result?.recordId;

  if (quoteId) {
    console.log("\n--- 5. Testing GET /api/erp/transaction-document (purchaseOrder) ---");
    const res5 = await fetch(`http://localhost:3000/api/erp/transaction-document?type=purchaseOrder&id=${quoteId}`, {
      headers: { Cookie: `easynet_session=${token}` }
    });
    const data5 = await res5.json();
    console.log("Status get document:", res5.status, "Number:", data5.number, "Lines:", data5.lines?.length);

    console.log("\n--- 6. Testing createSupplierQuote #2 for sequential numbering ---");
    const res6 = await fetch("http://localhost:3000/api/erp/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `easynet_session=${token}` },
      body: JSON.stringify({
        action: "createSupplierQuote",
        payload: {
          partyId: createdSupplierId,
          projectId: createdProjectId,
          documentDate: "2026-09-11",
          lines: [
            {
              description: "Fiber Optic Patch Cable 10m",
              qty: 10,
              uom: "Units",
              rate: 45,
            }
          ]
        }
      })
    });
    const data6 = await res6.json();
    console.log("Status createSupplierQuote #2:", res6.status, "Document number:", data6.result?.documentNumber);

    console.log("\n--- 7. Testing approval via POST /api/erp/actions (approvals) ---");
    const res7 = await fetch("http://localhost:3000/api/erp/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `easynet_session=${token}` },
      body: JSON.stringify({
        target: "approvals",
        body: {
          payload: {
            recordType: "purchaseOrder",
            recordId: quoteId,
            decision: "APPROVE",
            note: "Approved by manager"
          }
        }
      })
    });
    const data7 = await res7.json();
    console.log("Status approval:", res7.status, data7);
  }
}

test().catch(console.error);
