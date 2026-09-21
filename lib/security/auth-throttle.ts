import { createHmac } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { env } from "@/lib/env";
import { prisma } from "@/src/lib/prisma";

type SecurityClient = PrismaClient | Prisma.TransactionClient;

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const IDENTITY_LIMIT = 5;
const IP_LIMIT = 20;

function throttleSecret() {
  const secret = env.SESSION_SECRET || "";
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  return secret;
}

function hashKey(value: string) {
  return createHmac("sha256", throttleSecret()).update(value).digest("base64url");
}

function normalizedIp(value?: string | null) {
  return String(value || "unknown").trim().toLowerCase().slice(0, 128);
}

function normalizedEmail(value?: string | null) {
  return String(value || "unknown").trim().toLowerCase().slice(0, 320);
}

function keys(ip: string | null | undefined, email: string | null | undefined) {
  const cleanIp = normalizedIp(ip);
  const cleanEmail = normalizedEmail(email);
  return [
    { keyHash: hashKey(`ip:${cleanIp}`), limit: IP_LIMIT },
    { keyHash: hashKey(`identity:${cleanIp}:${cleanEmail}`), limit: IDENTITY_LIMIT },
  ];
}

export async function loginThrottleStatus(
  ip: string | null | undefined,
  email: string | null | undefined,
  client: SecurityClient = prisma,
) {
  const rows = await client.authThrottle.findMany({
    where: { keyHash: { in: keys(ip, email).map((row) => row.keyHash) } },
  });
  const now = Date.now();
  const blocked = rows
    .map((row) => row.blockedUntil?.getTime() || 0)
    .filter((value) => value > now)
    .sort((a, b) => b - a)[0] || 0;
  return {
    blocked: blocked > now,
    retryAfterSeconds: blocked > now ? Math.max(1, Math.ceil((blocked - now) / 1000)) : 0,
  };
}

export async function recordLoginFailure(
  ip: string | null | undefined,
  email: string | null | undefined,
  client: SecurityClient = prisma,
) {
  const now = new Date();
  for (const definition of keys(ip, email)) {
    const existing = await client.authThrottle.findUnique({ where: { keyHash: definition.keyHash } });
    const staleWindow = !existing || now.getTime() - existing.windowStartedAt.getTime() >= WINDOW_MS;
    const attempts = staleWindow ? 1 : existing.attempts + 1;
    const blockedUntil = attempts >= definition.limit
      ? new Date(now.getTime() + BLOCK_MS)
      : existing?.blockedUntil && existing.blockedUntil > now
        ? existing.blockedUntil
        : null;

    await client.authThrottle.upsert({
      where: { keyHash: definition.keyHash },
      create: {
        keyHash: definition.keyHash,
        attempts,
        windowStartedAt: now,
        blockedUntil,
      },
      update: {
        attempts,
        windowStartedAt: staleWindow ? now : existing!.windowStartedAt,
        blockedUntil,
      },
    });
  }
  return loginThrottleStatus(ip, email, client);
}

export async function clearSuccessfulIdentityThrottle(
  ip: string | null | undefined,
  email: string | null | undefined,
  client: SecurityClient = prisma,
) {
  const identity = keys(ip, email)[1];
  await client.authThrottle.deleteMany({ where: { keyHash: identity.keyHash } });
}

export async function purgeExpiredLoginThrottles(client: SecurityClient = prisma) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return client.authThrottle.deleteMany({
    where: {
      updatedAt: { lt: cutoff },
      OR: [{ blockedUntil: null }, { blockedUntil: { lt: new Date() } }],
    },
  });
}
