import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

export type Role = "System Manager" | "Finance Controller" | "Accounts User" | "Sales User" | "Purchase User" | "Stock User" | "Management" | "Auditor";
export type Permission = "dashboard.read" | "sales.read" | "sales.write" | "purchase.read" | "purchase.write" | "stock.read" | "stock.write" | "accounts.read" | "accounts.write" | "reports.read" | "users.manage" | "settings.manage" | "post.approve";
export type SessionUser = { email: string; name: string; roles: Role[]; permissions: Permission[] };
type ConfigUser = { email: string; name?: string; passwordHash: string; roles: Role[]; disabled?: boolean };

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  "System Manager": ["dashboard.read","sales.read","sales.write","purchase.read","purchase.write","stock.read","stock.write","accounts.read","accounts.write","reports.read","users.manage","settings.manage","post.approve"],
  "Finance Controller": ["dashboard.read","sales.read","sales.write","purchase.read","purchase.write","stock.read","accounts.read","accounts.write","reports.read","post.approve"],
  "Accounts User": ["dashboard.read","accounts.read","accounts.write","reports.read","sales.read","purchase.read"],
  "Sales User": ["dashboard.read","sales.read","sales.write","reports.read"],
  "Purchase User": ["dashboard.read","purchase.read","purchase.write","stock.read","reports.read"],
  "Stock User": ["dashboard.read","stock.read","stock.write","purchase.read","reports.read"],
  "Management": ["dashboard.read","sales.read","purchase.read","stock.read","accounts.read","reports.read"],
  "Auditor": ["dashboard.read","sales.read","purchase.read","stock.read","accounts.read","reports.read"],
};

const COOKIE_NAME = "easynet_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

const TEST_ADMIN: ConfigUser = {
  email: "admin@easynet.local",
  name: "Test System Administrator",
  passwordHash: "scrypt$easynet-test-admin$cbcc6442f9b6a5b35f8ab0b0c92e161760c0a56deee87e21f92dd1b8027d778c89ebad5a2de05ebb87d8a80cbfcfb209d3dcf56e73c61dd8e92d4eb1f8997f9d",
  roles: ["System Manager"],
};

function users(): ConfigUser[] {
  // Temporary simple-login mode: ignore ERP_USERS_JSON and use the built-in
  // administrator account in all environments until persistent user management is enabled.
  return [TEST_ADMIN];
}

function permissionsFor(roles: Role[]) {
  return Array.from(new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] || []))) as Permission[];
}

function sign(value: string) {
  const secret = env.SESSION_SECRET || (process.env.VERCEL_ENV === "preview" || process.env.NODE_ENV === "development" ? "easynet-preview-session-secret-change-before-production" : "");
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function verifyPassword(password: string, stored: string) {
  const [scheme, salt, expectedHex] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function authenticate(email: string, password: string): SessionUser | null {
  const found = users().find((u) => !u.disabled && u.email.toLowerCase() === email.trim().toLowerCase());
  if (!found || !verifyPassword(password, found.passwordHash)) return null;
  return { email: found.email, name: found.name || found.email, roles: found.roles, permissions: permissionsFor(found.roles) };
}

export function createSessionToken(user: SessionUser) {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token?: string | null): SessionUser | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return { email: decoded.email, name: decoded.name, roles: decoded.roles || [], permissions: decoded.permissions || [] };
  } catch { return null; }
}

export async function getCurrentUser() {
  const store = await cookies();
  return verifySessionToken(store.get(COOKIE_NAME)?.value);
}

export function hasPermission(user: SessionUser | null, permission: Permission) { return Boolean(user?.permissions.includes(permission)); }

export async function requirePermission(permission: Permission) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!hasPermission(user, permission)) throw new Error("Forbidden");
  return user;
}

export function listConfiguredUsers() {
  return users().map((u) => ({ email: u.email, name: u.name || u.email, roles: u.roles, disabled: Boolean(u.disabled) }));
}

export const sessionCookie = { name: COOKIE_NAME, maxAge: SESSION_TTL_SECONDS };
