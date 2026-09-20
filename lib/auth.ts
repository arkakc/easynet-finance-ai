import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { env } from "@/lib/env";
import bcrypt from "bcryptjs";
import { prisma } from "@/src/lib/prisma";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export type Role = "System Manager" | "Finance Controller" | "Accounts User" | "Sales User" | "Purchase User" | "Stock User" | "Management" | "Auditor";
export type Permission = "dashboard.read" | "sales.read" | "sales.write" | "purchase.read" | "purchase.write" | "stock.read" | "stock.write" | "accounts.read" | "accounts.write" | "reports.read" | "users.manage" | "settings.manage" | "post.approve";
export type SessionUser = { email: string; name: string; roles: Role[]; permissions: Permission[] };

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

const PRISMA_ROLE_MAP: Record<string, Role> = {
  SYSTEM_MANAGER: "System Manager",
  FINANCE_CONTROLLER: "Finance Controller",
  ACCOUNTS_USER: "Accounts User",
  SALES_USER: "Sales User",
  PURCHASE_USER: "Purchase User",
  STOCK_USER: "Stock User",
  MANAGEMENT: "Management",
  AUDITOR: "Auditor",
};

function permissionsFor(roles: Role[]) {
  return Array.from(new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] || []))) as Permission[];
}

function sign(value: string) {
  const secret = env.SESSION_SECRET || "";
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const found = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!found || found.status !== "ACTIVE" || !found.password) return null;
  if (!await bcrypt.compare(password, found.password)) return null;

  const role = PRISMA_ROLE_MAP[String(found.role)];
  if (!role) return null;
  await prisma.user.update({ where: { id: found.id }, data: { lastLoginAt: new Date() } });
  return { email: found.email, name: found.name || found.email, roles: [role], permissions: permissionsFor([role]) };
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

function cookieFromRawHeader(raw: string, name: string) {
  for (const part of raw.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key === name) return decodeURIComponent(valueParts.join("="));
  }
  return null;
}

function cookieFromRequest(request: Request, name: string) {
  return cookieFromRawHeader(request.headers.get("cookie") || "", name);
}

export function getRequestUser(request: Request) {
  return verifySessionToken(cookieFromRequest(request, COOKIE_NAME));
}

export async function getCurrentUser() {
  const store = await cookies();
  const cookieToken = store.get(COOKIE_NAME)?.value;
  if (cookieToken) return verifySessionToken(cookieToken);

  // Some Next.js route-handler execution paths can lose the cookie-store view
  // while still retaining the original Cookie header. Fall back to that raw
  // header so server-side permission checks stay consistent with proxy auth.
  const headerStore = await headers();
  return verifySessionToken(cookieFromRawHeader(headerStore.get("cookie") || "", COOKIE_NAME));
}

export function hasPermission(user: SessionUser | null, permission: Permission) { return Boolean(user?.permissions.includes(permission)); }

export function hasAnyPermission(user: SessionUser | null, permissions: Permission[]) {
  return permissions.some((permission) => hasPermission(user, permission));
}

export function requireRequestPermission(request: Request, permission: Permission) {
  const user = getRequestUser(request);
  if (!user) throw new Error("Unauthorized");
  if (!hasPermission(user, permission)) throw new Error("Forbidden");
  return user;
}

export async function requirePermission(permission: Permission) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!hasPermission(user, permission)) throw new Error("Forbidden");
  return user;
}

export async function listConfiguredUsers() {
  const users = await prisma.user.findMany({
    orderBy: { email: "asc" },
    select: { email: true, name: true, role: true, status: true },
  });
  return users.flatMap((user) => {
    const role = PRISMA_ROLE_MAP[String(user.role)];
    return role ? [{ email: user.email, name: user.name || user.email, roles: [role], disabled: user.status !== "ACTIVE" }] : [];
  });
}

export const sessionCookie = { name: COOKIE_NAME, maxAge: SESSION_TTL_SECONDS };
