import { createHmac, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { env } from "@/lib/env";
import { prisma } from "@/src/lib/prisma";

type AuditClient = PrismaClient | Prisma.TransactionClient;
const CHAIN_ID = "primary";

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
  unsequencedSealedEntries: number;
  valid: boolean;
  brokenAtId: string | null;
  headHash: string | null;
  chainSequence: number;
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

function hashPayload(payload: string) {
  return createHmac("sha256", integritySecret()).update(payload).digest("base64url");
}

function auditPayload(row: {
  id: string;
  sequence: number;
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
  ipAddress: string | null;
  userAgent: string | null;
  previousHash: string | null;
  createdAt: Date;
}) {
  return JSON.stringify({
    id: row.id,
    sequence: row.sequence,
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
    // userId is deliberately excluded: the FK may be set null if the actor
    // account is deleted, while actorEmail remains the immutable audit snapshot.
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    previousHash: row.previousHash,
    createdAt: row.createdAt.toISOString(),
  });
}

function chainStatePayload(sequence: number, headHash: string | null) {
  return JSON.stringify({ chainId: CHAIN_ID, sequence, headHash });
}

function isRootClient(client: AuditClient): client is PrismaClient {
  return typeof (client as PrismaClient).$transaction === "function";
}

export function requestAuditContext(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    requestId: request.headers.get("x-request-id") || randomUUID(),
    ipAddress: forwardedFor || request.headers.get("x-real-ip") || null,
    userAgent: request.headers.get("user-agent") || null,
  };
}

async function appendAuditEventInTransaction(
  input: AuditEventInput,
  tx: Prisma.TransactionClient,
) {
  // Updating one chain-state row first gives all audit writers a common
  // serialization point. This prevents same-millisecond/concurrent events
  // from forking the HMAC chain.
  const state = await tx.auditChainState.upsert({
    where: { id: CHAIN_ID },
    create: {
      id: CHAIN_ID,
      nextSequence: 1,
      headHash: null,
      integrityHash: null,
    },
    update: { nextSequence: { increment: 1 } },
    select: { nextSequence: true, headHash: true },
  });

  const createdAt = new Date();
  const id = randomUUID();
  const sequence = state.nextSequence;
  const row = {
    id,
    sequence,
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
    previousHash: state.headHash,
    createdAt,
  };
  const integrityHash = hashPayload(auditPayload(row));

  const event = await tx.auditLog.create({
    data: {
      ...row,
      integrityHash,
    },
  });

  const stateIntegrityHash = hashPayload(chainStatePayload(sequence, integrityHash));
  await tx.auditChainState.update({
    where: { id: CHAIN_ID },
    data: {
      headHash: integrityHash,
      integrityHash: stateIntegrityHash,
    },
  });

  return event;
}

export async function appendAuditEvent(
  input: AuditEventInput,
  client: AuditClient = prisma,
) {
  if (isRootClient(client)) {
    return client.$transaction(
      (tx) => appendAuditEventInTransaction(input, tx),
      { timeout: 15_000 },
    );
  }
  return appendAuditEventInTransaction(input, client);
}

export async function verifyAuditIntegrity(
  client: AuditClient = prisma,
): Promise<AuditIntegrityReport> {
  const [sealed, legacyUnsealedEntries, unsequencedSealedEntries, state] = await Promise.all([
    client.auditLog.findMany({
      where: { integrityHash: { not: null }, sequence: { not: null } },
      orderBy: { sequence: "asc" },
    }),
    client.auditLog.count({ where: { integrityHash: null } }),
    client.auditLog.count({ where: { integrityHash: { not: null }, sequence: null } }),
    client.auditChainState.findUnique({ where: { id: CHAIN_ID } }),
  ]);

  const fail = (brokenAtId: string | null, headHash: string | null, chainSequence: number): AuditIntegrityReport => ({
    sealedEntries: sealed.length,
    legacyUnsealedEntries,
    unsequencedSealedEntries,
    valid: false,
    brokenAtId,
    headHash,
    chainSequence,
  });

  if (unsequencedSealedEntries > 0) {
    const first = await client.auditLog.findFirst({
      where: { integrityHash: { not: null }, sequence: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    return fail(first?.id || null, state?.headHash || null, state?.nextSequence || 0);
  }

  let previousHash: string | null = null;
  let expectedSequence = 1;

  for (const row of sealed) {
    if (row.sequence !== expectedSequence || row.previousHash !== previousHash) {
      return fail(row.id, state?.headHash || previousHash, state?.nextSequence || 0);
    }

    const expected = hashPayload(auditPayload({
      id: row.id,
      sequence: Number(row.sequence),
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
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      previousHash: row.previousHash,
      createdAt: row.createdAt,
    }));
    if (row.integrityHash !== expected) {
      return fail(row.id, state?.headHash || previousHash, state?.nextSequence || 0);
    }

    previousHash = row.integrityHash;
    expectedSequence += 1;
  }

  const expectedStateSequence = sealed.length;
  const expectedStateHash = hashPayload(chainStatePayload(expectedStateSequence, previousHash));

  if (!state) {
    if (sealed.length === 0) {
      return {
        sealedEntries: 0,
        legacyUnsealedEntries,
        unsequencedSealedEntries: 0,
        valid: true,
        brokenAtId: null,
        headHash: null,
        chainSequence: 0,
      };
    }
    return fail(null, previousHash, 0);
  }

  if (
    state.nextSequence !== expectedStateSequence
    || state.headHash !== previousHash
    || state.integrityHash !== expectedStateHash
  ) {
    return fail(null, state.headHash, state.nextSequence);
  }

  return {
    sealedEntries: sealed.length,
    legacyUnsealedEntries,
    unsequencedSealedEntries,
    valid: true,
    brokenAtId: null,
    headHash: previousHash,
    chainSequence: state.nextSequence,
  };
}
