import "dotenv/config";
process.env.SESSION_SECRET = "easynet-preview-session-secret-change-before-production";
import * as XLSX from "xlsx";
import { POST } from "../app/api/ui/accounts/import/route";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";

async function test() {
  console.log("Creating test Excel workbook in memory...");
  const headers = ["Account Code", "Account Name", "Account Type", "Parent Account", "Normal Balance", "Currency", "Description", "Status"];
  const rows = [
    ["9000", "Special Operations Group", "EXPENSE", "", "DEBIT", "PGK", "Test Root", "Active"],
    ["9100", "Regional IT Operations", "EXPENSE", "Special Operations Group", "DEBIT", "PGK", "Test Level 2 by Name", "Active"],
    ["9110", "Highlands Provincial Hub", "EXPENSE", "9100 - Regional IT Operations", "DEBIT", "PGK", "Test Level 3 by Code-Name", "Active"],
    ["9111", "Mt Hagen Base Station", "EXPENSE", "", "DEBIT", "PGK", "Test Level 4 Inferred from 9110", "Active"],
    ["9112", "Goroka Repeater Tower", "EXPENSE", "9110", "DEBIT", "PGK", "Test Level 4 by exact code", "Active"],
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  const base64 = buffer.toString("base64");
  const { createSessionToken } = await import("../lib/auth");
  const adminToken = createSessionToken({
    email: "admin@easynet.local",
    name: "System Administrator",
    roles: ["System Manager"],
    permissions: ["accounts.read", "accounts.write", "settings.manage"] as any,
  });

  const req = new NextRequest("http://localhost:3000/api/ui/accounts/import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cookie": `easynet_session=${adminToken}`,
    },
    body: JSON.stringify({ excelBase64: base64 }),
  });

  const res = await POST(req);
  const data = await res.json();
  console.log("Import response:", data);

  // Check how accounts were linked in database
  const imported = await prisma.chartOfAccounts.findMany({
    where: { code: { in: ["9000", "9100", "9110", "9111", "9112"] } },
    include: { parent: { select: { code: true, name: true } } },
    orderBy: { code: "asc" },
  });

  console.log("Imported accounts in DB:");
  imported.forEach((a) => {
    console.log(`  ${a.code} ${a.name} -> Parent: ${a.parent ? `${a.parent.code} (${a.parent.name})` : "ROOT"}`);
  });

  // Clean up test accounts
  await prisma.chartOfAccounts.deleteMany({
    where: { code: { in: ["9111", "9112", "9110", "9100", "9000"] } },
  });
  console.log("Cleaned up test accounts.");
}

test().catch(console.error);
