import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

export type Role = "System Manager" | "Finance Controller" | "Accounts User" | "Sales User" | "Purchase User" | "Stock User" | "Management" | "Auditor";
export type Permission = "dashboard.read" | "sales.read" | "sales.write" | "purchase.read" | "purchase.write" | "stock.read" | "stock.write" | "accounts.read" | "accounts.write" | "reports.read" | "users.manage" | "settings.manage" | "post.approve";
export type SessionUser = { email: string; name: string; roles: Role[]; permissions: Permission[] };

type ConfigUser = { email: string; name?: string; passwordHash: string; roles: Role[]; disabled?: boolean };

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
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

function users(): ConfigUser[] {
  if (!env.ERP_USERS_JSON) return [];
  const parsed = JSON.parse(env.ERP_USERS_JSON) as ConfigUser[];
  return parsed.filter((u) => !u.disabled && u.email && u.passwordHash && Array.isArray(u.roles));
}

function permissionsFor(roles: Role[]) {
  return Array.from(new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] || []))) as Permission[];
}

function sign(value: string) {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is not configured");
  return createHmac("sha256", env.SESSION_SECRET).update(value).digest("base64url");
}

export function verifyPassword(password: string, stored: string) {
  const [scheme, salt, expectedHex] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function authenticate(email: string, password: string): SessionUser | null {
  const found = users().find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
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
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
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

export function hasPermission(user: SessionUser | null, permission: Permission) {
  return Boolean(user?.permissions.includes(permission));
}

export async function requirePermission(permission: Permission) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!hasPermission(user, permission)) throw new Error("Forbidden");
  return user;
}

export const sessionCookie = { name: COOKIE_NAME, maxAge: SESSION_TTL_SECONDS };
