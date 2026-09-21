import { createHmac, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { env } from "@/lib/env";
import { prisma } from "@/src/lib/prisma";

type AuditClient = PrismaClient | Prisma.TransactionClient;

export type AuditOutcome = "SUCCESS" | "FAILURE" | "DENIED" | "LOCKED" | "INFO";

export type AuditEventInput = {
  action: string;
  entityType: string;
  entityId?: string | null;
  entityCode?: string | null;
  description?: string | null;
  changes?: unknown;
  metadata?: unknown;
  outcome?: AuditOutcome;
  requestId?: string | null;
  actorEmail?: string | null;
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type AuditIntegrityReport = {
  sealedEntries: number;
  legacyUnsealedEntries: number;
  valid: boolean;
  brokenAtId: string | null;
  headHash: string | null;
};

function integritySecret() {
  const secret = env.AUDIT_LOG_SECRET || env.SESSION_SECRET || "";
  if (!secret) throw new Error("AUDIT_LOG_SECRET or SESSION_SECRET must be configured");
  return secret;
}

function json(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function auditPayload(row: {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityCode: string | null;
  description: string | null;
  changes: string | null;
  metadata: string | null;
  outcome: string;
  requestId: string | null;
  actorEmail: string | null;
  userId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  previousHash: string | null;
  createdAt: Date;
}) {
  return JSON.stringify({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    entityCode: row.entityCode,
    description: row.description,
    changes: row.changes,
    metadata: row.metadata,
    outcome: row.outcome,
    requestId: row.requestId,
    actorEmail: row.actorEmail,
    userId: row.userId,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    previousHash: row.previousHash,
    createdAt: row.createdAt.toISOString(),
  });
}

function hashPayload(payload: string) {
  return createHmac("sha256", integritySecret()).update(payload).digest("base64url");
}

export function requestAuditContext(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    requestId: request.headers.get("x-request-id") || randomUUID(),
    ipAddress: forwardedFor || request.headers.get("x-real-ip") || null,
    userAgent: request.headers.get("user-agent") || null,
  };
}

export async function appendAuditEvent(
  input: AuditEventInput,
  client: AuditClient = prisma,
) {
  const latest = await client.auditLog.findFirst({
    where: { integrityHash: { not: null } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { integrityHash: true },
  });

  const createdAt = new Date();
  const id = randomUUID();
  const row = {
    id,
    action: String(input.action || "UNKNOWN").trim().toUpperCase(),
    entityType: String(input.entityType || "System").trim(),
    entityId: input.entityId || null,
    entityCode: input.entityCode || null,
    description: input.description || null,
    changes: json(input.changes),
    metadata: json(input.metadata),
    outcome: input.outcome || "SUCCESS",
    requestId: input.requestId || null,
    actorEmail: input.actorEmail?.trim().toLowerCase() || null,
    userId: input.userId || null,
    ipAddress: input.ipAddress || null,
    userAgent: input.userAgent || null,
    previousHash: latest?.integrityHash || null,
    createdAt,
  };
  const integrityHash = hashPayload(auditPayload(row));

  return client.auditLog.create({
    data: {
      ...row,
      integrityHash,
    },
  });
}

export async function verifyAuditIntegrity(
  client: AuditClient = prisma,
): Promise<AuditIntegrityReport> {
  const [sealed, legacyUnsealedEntries] = await Promise.all([
    client.auditLog.findMany({
      where: { integrityHash: { not: null } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    client.auditLog.count({ where: { integrityHash: null } }),
  ]);

  const knownHashes = new Set(sealed.map((row) => row.integrityHash).filter(Boolean));
  for (const row of sealed) {
    const expected = hashPayload(auditPayload({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      entityCode: row.entityCode,
      description: row.description,
      changes: row.changes,
      metadata: row.metadata,
      outcome: row.outcome,
      requestId: row.requestId,
      actorEmail: row.actorEmail,
      userId: row.userId,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      previousHash: row.previousHash,
      createdAt: row.createdAt,
    }));
    if (row.integrityHash !== expected) {
      return {
        sealedEntries: sealed.length,
        legacyUnsealedEntries,
        valid: false,
        brokenAtId: row.id,
        headHash: sealed.at(-1)?.integrityHash || null,
      };
    }
    if (row.previousHash && !knownHashes.has(row.previousHash)) {
      return {
        sealedEntries: sealed.length,
        legacyUnsealedEntries,
        valid: false,
        brokenAtId: row.id,
        headHash: sealed.at(-1)?.integrityHash || null,
      };
    }
  }

  return {
    sealedEntries: sealed.length,
    legacyUnsealedEntries,
    valid: true,
    brokenAtId: null,
    headHash: sealed.at(-1)?.integrityHash || null,
  };
}
