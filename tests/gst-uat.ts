process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'easynet-preview-session-secret-change-before-production-2026';
import type { Role, SessionUser } from "../lib/auth";

const baseUrl = process.env.UAT_BASE_URL || `http://localhost:${process.env.PORT || "3104"}`;

async function main() {
  const { createSessionToken, sessionCookie, ROLE_PERMISSIONS } = await import("../lib/auth");
  const manager: SessionUser = { email: "admin@easynet.local", name: "UAT Administrator", roles: ["System Manager"], permissions: ROLE_PERMISSIONS["System Manager"], sessionVersion: 1 };
  const cookie = `${sessionCookie.name}=${createSessionToken(manager)}`;
  const unauthenticated = await fetch(`${baseUrl}/api/reports/irc-gst?year=2026&month=1`);
  if (unauthenticated.status !== 401) throw new Error(`Unauthenticated GST report expected 401, got ${unauthenticated.status}`);
  const invalid = await fetch(`${baseUrl}/api/reports/irc-gst?year=2026&month=13`, { headers: { Cookie: cookie } });
  if (invalid.status !== 400) throw new Error(`Invalid GST period expected 400, got ${invalid.status}`);
  const response = await fetch(`${baseUrl}/api/reports/irc-gst?year=2026&month=1`, { headers: { Cookie: cookie } });
  if (!response.ok) throw new Error(`Authenticated GST report failed with ${response.status}: ${await response.text()}`);
  const body = await response.json();
  const report = body.data;
  for (const field of ["box1TotalSales", "box5TaxableSales", "box7GstOnSales", "box11GstOnPurchases", "box14NetGstPayable"]) if (typeof report?.[field] !== "number") throw new Error(`GST report omitted numeric ${field}`);
  console.log(JSON.stringify({ database: "live read-only", liveDatabaseChanged: false, baseUrl, routeChecks: { unauthenticated: unauthenticated.status, invalid: invalid.status, authenticated: response.status }, period: report.period, boxes: { box1TotalSales: report.box1TotalSales, box7GstOnSales: report.box7GstOnSales, box11GstOnPurchases: report.box11GstOnPurchases, box14NetGstPayable: report.box14NetGstPayable } }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
