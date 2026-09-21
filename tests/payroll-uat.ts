process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'easynet-preview-session-secret-change-before-production-2026';

import type { Role, SessionUser } from "../lib/auth";

const baseUrl = process.env.UAT_BASE_URL || `http://localhost:${process.env.PORT || "3104"}`;
async function main() {
  const [{ createSessionToken, sessionCookie, ROLE_PERMISSIONS }, { calculateFortnightlySWT, calculateSuperannuation }, { prisma }] = await Promise.all([
    import("../lib/auth"), import("../src/lib/services/payroll.service"), import("../src/lib/prisma"),
  ]);
  const roleUsers: Partial<Record<Role, { email: string; name: string }>> = {
    "System Manager": { email: "admin@easynet.local", name: "UAT Administrator" },
    "Sales User": { email: "sales@easynet.local", name: "UAT Sales User" },
  };
  const user = (role: Role): SessionUser => {
    const identity = roleUsers[role];
    if (!identity) throw new Error(`No seeded UAT identity for ${role}`);
    return { ...identity, roles: [role], permissions: ROLE_PERMISSIONS[role], sessionVersion: 1 };
  };
  const headers = (role: Role) => ({ Cookie: `${sessionCookie.name}=${createSessionToken(user(role))}` });
  const lowTax = calculateFortnightlySWT(500);
  if (lowTax !== 0) throw new Error(`PNG SWT low band expected 0, got ${lowTax}`);
  const superResult = calculateSuperannuation(1000);
  if (superResult.employerSuper !== 84 || superResult.employeeSuper !== 60) throw new Error("PNG superannuation calculation failed");

  const unauthenticated = await fetch(`${baseUrl}/api/payroll/runs`);
  if (unauthenticated.status !== 401) throw new Error(`Unauthenticated payroll GET expected 401, got ${unauthenticated.status}`);
  const sales = await fetch(`${baseUrl}/api/payroll/runs`, { headers: headers("Sales User") });
  if (sales.status !== 403) throw new Error(`Sales payroll GET expected 403, got ${sales.status}`);
  const manager = await fetch(`${baseUrl}/api/payroll/runs`, { headers: headers("System Manager") });
  if (!manager.ok) throw new Error(`Manager payroll GET failed with ${manager.status}`);
  const managerBody = await manager.json();
  if (!Array.isArray(managerBody.employees) || !Array.isArray(managerBody.data) || !Array.isArray(managerBody.unregisteredPayrollJournals)) throw new Error("Payroll GET omitted employee/run/reconciliation registers");

  const badConfirmation = await fetch(`${baseUrl}/api/payroll/runs`, { method: "POST", headers: { ...headers("System Manager"), "Content-Type": "application/json" }, body: JSON.stringify({ periodStart: "2026-09-01", periodEnd: "2026-09-14", paymentDate: "2026-09-15", confirmation: "WRONG" }) });
  if (badConfirmation.status !== 409) throw new Error(`Payroll confirmation guard expected 409, got ${badConfirmation.status}: ${await badConfirmation.text()}`);
  const invalidDate = await fetch(`${baseUrl}/api/payroll/runs`, { method: "POST", headers: { ...headers("System Manager"), "Content-Type": "application/json" }, body: JSON.stringify({ periodStart: "2026-99-01", periodEnd: "2026-09-14", paymentDate: "2026-09-15", confirmation: "PROCESS PAYROLL 2026-99-01 TO 2026-09-14" }) });
  if (invalidDate.status !== 400) throw new Error(`Payroll date validation expected 400, got ${invalidDate.status}: ${await invalidDate.text()}`);

  const counts = await prisma.$transaction([
    prisma.payrollRun.count(),
    prisma.journalHeader.count({ where: { sourceDocType: "PAYROLL" } }),
  ]);
  console.log(JSON.stringify({ database: "live read-only", liveDatabaseChanged: false, baseUrl, formulaChecks: { lowTax, superResult }, routeChecks: { unauthenticated: unauthenticated.status, sales: sales.status, manager: manager.status, activeEmployees: managerBody.employees.length, payrollRuns: managerBody.data.length, unregisteredPayrollJournals: managerBody.unregisteredPayrollJournals.length, badConfirmation: badConfirmation.status, invalidDate: invalidDate.status }, liveCounts: { payrollRuns: counts[0], payrollJournals: counts[1] } }, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
