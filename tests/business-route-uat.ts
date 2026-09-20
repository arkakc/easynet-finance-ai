process.env.SESSION_SECRET = process.env.SESSION_SECRET || "easynet-preview-session-secret-change-before-production-2026";

import type { Role, SessionUser } from "../lib/auth";

const baseUrl = process.env.UAT_BASE_URL || `http://localhost:${process.env.PORT || "3104"}`;

async function main() {
  const { createSessionToken, sessionCookie, ROLE_PERMISSIONS } = await import("../lib/auth");
  const user = (role: Role): SessionUser => ({ email: `${role.toLowerCase().replace(/\s+/g, ".")}@uat.local`, name: "Business UAT", roles: [role], permissions: ROLE_PERMISSIONS[role] });
  const headers = (role: Role) => ({ Cookie: `${sessionCookie.name}=${createSessionToken(user(role))}` });
  const jsonHeaders = (role: Role) => ({ ...headers(role), "Content-Type": "application/json" });
  const checks: Record<string, number> = {};

  const unauthenticated = await fetch(`${baseUrl}/api/sales/invoices`);
  if (unauthenticated.status !== 401) throw new Error(`Sales invoice unauthenticated GET expected 401, got ${unauthenticated.status}`);
  checks.salesInvoiceUnauthenticated = unauthenticated.status;

  const salesRead = await fetch(`${baseUrl}/api/sales/invoices`, { headers: headers("Sales User") });
  if (!salesRead.ok) throw new Error(`Sales User invoice GET failed with ${salesRead.status}`);
  checks.salesInvoiceRead = salesRead.status;

  const invalidInvoice = await fetch(`${baseUrl}/api/sales/invoices`, { method: "POST", headers: jsonHeaders("Sales User"), body: JSON.stringify({}) });
  if (invalidInvoice.status !== 400) throw new Error(`Invalid invoice payload expected 400, got ${invalidInvoice.status}`);
  checks.salesInvoiceValidation = invalidInvoice.status;

  const salesLandedCost = await fetch(`${baseUrl}/api/purchases/landed-cost`, { headers: headers("Sales User") });
  if (salesLandedCost.status !== 403) throw new Error(`Sales User landed-cost GET expected 403, got ${salesLandedCost.status}`);
  checks.landedCostDenied = salesLandedCost.status;

  const purchaseLandedCost = await fetch(`${baseUrl}/api/purchases/landed-cost`, { headers: headers("Purchase User") });
  if (!purchaseLandedCost.ok) throw new Error(`Purchase User landed-cost GET failed with ${purchaseLandedCost.status}`);
  checks.landedCostRead = purchaseLandedCost.status;

  const reverseDenied = await fetch(`${baseUrl}/api/journals/reverse`, { method: "POST", headers: jsonHeaders("Sales User"), body: JSON.stringify({ journalId: "missing", reversalDate: "2026-09-13", reason: "UAT guard" }) });
  if (reverseDenied.status !== 403) throw new Error(`Sales User reversal expected 403, got ${reverseDenied.status}`);
  checks.reversalDenied = reverseDenied.status;

  const backupDenied = await fetch(`${baseUrl}/api/system/backups`, { headers: headers("Sales User") });
  if (backupDenied.status !== 403) throw new Error(`Sales User backup GET expected 403, got ${backupDenied.status}`);
  checks.backupDenied = backupDenied.status;
  const backupRead = await fetch(`${baseUrl}/api/system/backups`, { headers: headers("System Manager") });
  if (!backupRead.ok) throw new Error(`System Manager backup GET failed with ${backupRead.status}`);
  checks.backupRead = backupRead.status;

  console.log(JSON.stringify({ database: "local SQLite", liveDatabaseChanged: false, baseUrl, routeChecks: checks }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
