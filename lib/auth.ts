import { createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { cookies, headers } from "next/headers";
import bcrypt from "bcryptjs";
import { env } from "@/lib/env";
import { prisma } from "@/src/lib/prisma";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export type Role =
  | "System Manager"
  | "Finance Controller"
  | "Accounts User"
  | "Sales User"
  | "Purchase User"
  | "Stock User"
  | "Management"
  | "Auditor";

export type Permission =
  | "dashboard.read"
  | "sales.read"
  | "sales.write"
  | "purchase.read"
  | "purchase.write"
  | "stock.read"
  | "stock.write"
  | "accounts.read"
  | "accounts.write"
  | "reports.read"
  | "audit.read"
  | "users.manage"
  | "settings.manage"
  | "security.manage"
  | "post.approve";

export type SessionUser = {
  userId?: string;
  email: string;
  name: string;
  roles: Role[];
  permissions: Permission[];
  sessionVersion?: number;
};

export type AuthenticationResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: "INVALID" | "LOCKED"; retryAfterSeconds: number };

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  "System Manager": [
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
    "audit.read",
    "users.manage",
    "settings.manage",
    "security.manage",
    "post.approve",
  ],
  "Finance Controller": [
    "dashboard.read",
    "sales.read",
    "sales.write",
    "purchase.read",
    "purchase.write",
    "stock.read",
    "accounts.read",
    "accounts.write",
    "reports.read",
    "audit.read",
    "post.approve",
  ],
  "Accounts User": ["dashboard.read", "accounts.read", "accounts.write", "reports.read", "sales.read", "purchase.read"],
  "Sales User": ["dashboard.read", "sales.read", "sales.write", "reports.read"],
  "Purchase User": ["dashboard.read", "purchase.read", "purchase.write", "stock.read", "reports.read"],
  "Stock User": ["dashboard.read", "stock.read", "stock.write", "purchase.read", "reports.read"],
  "Management": ["dashboard.read", "sales.read", "purchase.read", "stock.read", "accounts.read", "reports.read"],
  "Auditor": ["dashboard.read", "sales.read", "purchase.read", "stock.read", "accounts.read", "reports.read", "audit.read"],
};

const COOKIE_NAME = "easynet_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const ACCOUNT_FAILURE_LIMIT = 5;
const ACCOUNT_LOCK_MS = 15 * 60 * 1000;

export const PRISMA_ROLE_MAP: Record<string, Role> = {
  SYSTEM_MANAGER: "System Manager",
  FINANCE_CONTROLLER: "Finance Controller",
  ACCOUNTS_USER: "Accounts User",
  SALES_USER: "Sales User",
  PURCHASE_USER: "Purchase User",
  STOCK_USER: "Stock User",
  MANAGEMENT: "Management",
  AUDITOR: "Auditor",
};

export const ROLE_TO_PRISMA = Object.fromEntries(
  Object.entries(PRISMA_ROLE_MAP).map(([key, value]) => [value, key]),
) as Record<Role, string>;

function permissionsFor(roles: Role[]) {
  return Array.from(new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role] || []))) as Permission[];
}

function sign(value: string) {
  const secret = env.SESSION_SECRET || "";
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function sessionUserFromDatabase(user: {
  id: string;
  email: string;
  name: string;
  role: unknown;
  sessionVersion: number;
}): SessionUser | null {
  const role = PRISMA_ROLE_MAP[String(user.role)];
  if (!role) return null;
  return {
    userId: user.id,
    email: user.email,
    name: user.name || user.email,
    roles: [role],
    permissions: permissionsFor([role]),
    sessionVersion: user.sessionVersion,
  };
}

type AuthClient = PrismaClient | Prisma.TransactionClient;

export async function authenticateDetailed(
  email: string,
  password: string,
  client: AuthClient = prisma,
): Promise<AuthenticationResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const found = await client.user.findUnique({ where: { email: normalizedEmail } });
  if (!found || found.status !== "ACTIVE" || !found.password || !PRISMA_ROLE_MAP[String(found.role)]) {
    return { ok: false, reason: "INVALID", retryAfterSeconds: 0 };
  }

  const now = new Date();
  if (found.lockedUntil && found.lockedUntil > now) {
    return {
      ok: false,
      reason: "LOCKED",
      retryAfterSeconds: Math.max(1, Math.ceil((found.lockedUntil.getTime() - now.getTime()) / 1000)),
    };
  }

  const validPassword = await bcrypt.compare(password, found.password);
  if (!validPassword) {
    const lockExpired = Boolean(found.lockedUntil && found.lockedUntil <= now);
    const nextCount = (lockExpired ? 0 : found.failedLoginCount) + 1;
    const lockedUntil = nextCount >= ACCOUNT_FAILURE_LIMIT
      ? new Date(now.getTime() + ACCOUNT_LOCK_MS)
      : null;
    await client.user.update({
      where: { id: found.id },
      data: {
        failedLoginCount: nextCount,
        lastFailedLoginAt: now,
        lockedUntil,
      },
    });
    return {
      ok: false,
      reason: lockedUntil ? "LOCKED" : "INVALID",
      retryAfterSeconds: lockedUntil ? Math.ceil(ACCOUNT_LOCK_MS / 1000) : 0,
    };
  }

  const updated = await client.user.update({
    where: { id: found.id },
    data: {
      lastLoginAt: now,
      lastFailedLoginAt: null,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  const user = sessionUserFromDatabase(updated);
  return user
    ? { ok: true, user }
    : { ok: false, reason: "INVALID", retryAfterSeconds: 0 };
}

export async function authenticate(
  email: string,
  password: string,
  client: AuthClient = prisma,
): Promise<SessionUser | null> {
  const result = await authenticateDetailed(email, password, client);
  return result.ok ? result.user : null;
}

export function createSessionToken(user: SessionUser) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    userId: user.userId || null,
    email: user.email,
    name: user.name,
    roles: user.roles,
    permissions: user.permissions,
    sessionVersion: user.sessionVersion ?? 1,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token?: string | null): SessionUser | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (!decoded.exp || decoded.exp < now) return null;
    if (!decoded.iat || decoded.iat > now + 300) return null;
    if (!decoded.email || !Number.isInteger(decoded.sessionVersion)) return null;
    if (!Array.isArray(decoded.roles) || !Array.isArray(decoded.permissions)) return null;
    return {
      userId: decoded.userId ? String(decoded.userId) : undefined,
      email: String(decoded.email).trim().toLowerCase(),
      name: String(decoded.name || decoded.email),
      roles: decoded.roles as Role[],
      permissions: decoded.permissions as Permission[],
      sessionVersion: Number(decoded.sessionVersion),
    };
  } catch {
    return null;
  }
}

export async function validateSessionUser(
  tokenUser: SessionUser | null,
  client: AuthClient = prisma,
): Promise<SessionUser | null> {
  if (!tokenUser) return null;
  const found = await client.user.findUnique({
    where: tokenUser.userId
      ? { id: tokenUser.userId }
      : { email: tokenUser.email.trim().toLowerCase() },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      sessionVersion: true,
    },
  });
  if (!found || found.status !== "ACTIVE") return null;
  if (found.email.trim().toLowerCase() !== tokenUser.email.trim().toLowerCase()) return null;
  if (found.sessionVersion !== (tokenUser.sessionVersion ?? 1)) return null;
  return sessionUserFromDatabase(found);
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

export async function getValidatedRequestUser(request: Request) {
  return validateSessionUser(getRequestUser(request));
}

export async function getCurrentUser() {
  const store = await cookies();
  const cookieToken = store.get(COOKIE_NAME)?.value;
  let tokenUser = cookieToken ? verifySessionToken(cookieToken) : null;

  if (!tokenUser) {
    const headerStore = await headers();
    tokenUser = verifySessionToken(cookieFromRawHeader(headerStore.get("cookie") || "", COOKIE_NAME));
  }
  return validateSessionUser(tokenUser);
}

export function hasPermission(user: SessionUser | null, permission: Permission) {
  return Boolean(user?.permissions.includes(permission));
}

export function hasAnyPermission(user: SessionUser | null, permissions: Permission[]) {
  return permissions.some((permission) => hasPermission(user, permission));
}

/**
 * Token-only compatibility helper. New sensitive route handlers should use
 * requireValidatedRequestPermission or requirePermission so role/status/session
 * revocations in the database take effect immediately.
 */
export function requireRequestPermission(request: Request, permission: Permission) {
  const user = getRequestUser(request);
  if (!user) throw new Error("Unauthorized");
  if (!hasPermission(user, permission)) throw new Error("Forbidden");
  return user;
}

export async function requireValidatedRequestPermission(request: Request, permission: Permission) {
  const user = await getValidatedRequestUser(request);
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

export async function listConfiguredUsers(client: AuthClient = prisma) {
  const users = await client.user.findMany({
    orderBy: { email: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      lastLoginAt: true,
      lastFailedLoginAt: true,
      failedLoginCount: true,
      lockedUntil: true,
      sessionVersion: true,
    },
  });
  return users.flatMap((user) => {
    const role = PRISMA_ROLE_MAP[String(user.role)];
    return role
      ? [{
          userId: user.id,
          email: user.email,
          name: user.name || user.email,
          roles: [role],
          disabled: user.status !== "ACTIVE",
          status: String(user.status),
          lastLoginAt: user.lastLoginAt?.toISOString() || null,
          lastFailedLoginAt: user.lastFailedLoginAt?.toISOString() || null,
          failedLoginCount: user.failedLoginCount,
          lockedUntil: user.lockedUntil?.toISOString() || null,
          sessionVersion: user.sessionVersion,
        }]
      : [];
  });
}

export const sessionCookie = {
  name: COOKIE_NAME,
  maxAge: SESSION_TTL_SECONDS,
  sameSite: "strict" as const,
};
