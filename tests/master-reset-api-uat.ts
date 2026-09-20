process.env.SESSION_SECRET = process.env.SESSION_SECRET || "easynet-preview-session-secret-change-before-production-2026";
import type { SessionUser } from "../lib/auth";

const baseUrl = process.env.UAT_BASE_URL || `http://localhost:${process.env.PORT || "3104"}`;

async function main() {
  const { createSessionToken, sessionCookie, ROLE_PERMISSIONS } = await import("../lib/auth");
  const admin: SessionUser = { email: "admin@easynet.local", name: "UAT Admin", roles: ["System Manager"], permissions: ROLE_PERMISSIONS["System Manager"] };
  const management: SessionUser = { email: "willie@easynet.local", name: "UAT Management", roles: ["Management"], permissions: ROLE_PERMISSIONS["Management"] };
  const cookie = (user: SessionUser) => ({ Cookie: `${sessionCookie.name}=${createSessionToken(user)}` });

  const unauthenticated = await fetch(`${baseUrl}/api/company/master-data`);
  if (unauthenticated.status !== 401) throw new Error(`Unauthenticated GET expected 401, got ${unauthenticated.status}`);
  const denied = await fetch(`${baseUrl}/api/company/master-data`, { headers: cookie(management) });
  if (denied.status !== 403) throw new Error(`Non-admin GET expected 403, got ${denied.status}`);
  const summary = await fetch(`${baseUrl}/api/company/master-data`, { headers: cookie(admin) });
  if (!summary.ok) throw new Error(`Admin summary expected 200, got ${summary.status}`);
  const badPassword = await fetch(`${baseUrl}/api/company/master-data`, { method: "POST", headers: { ...cookie(admin), "Content-Type": "application/json" }, body: JSON.stringify({ password: "wrong", confirmationPhrase: "WIPE ALL MASTER DATA", preserveAdminUser: true }) });
  if (badPassword.status !== 401) throw new Error(`Invalid password expected 401, got ${badPassword.status}`);
  const badPhrase = await fetch(`${baseUrl}/api/company/master-data`, { method: "POST", headers: { ...cookie(admin), "Content-Type": "application/json" }, body: JSON.stringify({ password: "Admin123!", confirmationPhrase: "WRONG", preserveAdminUser: true }) });
  if (badPhrase.status !== 400) throw new Error(`Invalid confirmation expected 400, got ${badPhrase.status}`);
  console.log(JSON.stringify({ database: "live read-only", liveDatabaseChanged: false, baseUrl, unauthenticated: unauthenticated.status, nonAdmin: denied.status, adminSummary: summary.status, badPassword: badPassword.status, badConfirmation: badPhrase.status }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
