import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { PrismaClient, Role as PrismaRole, UserStatus } from "@prisma/client";
import {
  ROLE_PERMISSIONS,
  authenticateDetailed,
  createSessionToken,
  hashPassword,
  validateSessionUser,
  verifySessionToken,
} from "../lib/auth";
import {
  loginThrottleStatus,
  recordLoginFailure,
} from "../lib/security/auth-throttle";
import {
  appendAuditEvent,
  verifyAuditIntegrity,
} from "../lib/security/audit";
import { proxy } from "../proxy";

async function main() {
  const sourceDatabase = path.join(process.cwd(), "prisma", "dev.db");
  await fs.access(sourceDatabase);

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "easynet-phase9-security-"));
  const temporaryDatabase = path.join(temporaryRoot, "uat.sqlite");
  await fs.copyFile(sourceDatabase, temporaryDatabase);

  const client = new PrismaClient({
    datasourceUrl: `file:${temporaryDatabase.replace(/\\/g, "/")}`,
  });

  try {
    const suffix = String(process.pid);
    const password = "Phase9-Secure-Password-2026!";
    const passwordHash = await hashPassword(password);

    const manager = await client.user.create({
      data: {
        name: "Phase 9 System Manager",
        email: `phase9-manager-${suffix}@example.test`,
        password: passwordHash,
        role: PrismaRole.SYSTEM_MANAGER,
        status: UserStatus.ACTIVE,
      },
    });
    const lockedUser = await client.user.create({
      data: {
        name: "Phase 9 Lockout User",
        email: `phase9-lock-${suffix}@example.test`,
        password: passwordHash,
        role: PrismaRole.ACCOUNTS_USER,
        status: UserStatus.ACTIVE,
      },
    });

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const result = await authenticateDetailed(lockedUser.email, "wrong-password", client);
      if (result.ok || result.reason !== "INVALID") {
        throw new Error(`Expected invalid credential result on attempt ${attempt}`);
      }
    }
    const fifthFailure = await authenticateDetailed(lockedUser.email, "wrong-password", client);
    if (fifthFailure.ok || fifthFailure.reason !== "LOCKED" || fifthFailure.retryAfterSeconds <= 0) {
      throw new Error("Fifth invalid password did not lock the account");
    }
    const lockedRecord = await client.user.findUnique({ where: { id: lockedUser.id } });
    if (!lockedRecord?.lockedUntil || lockedRecord.failedLoginCount !== 5) {
      throw new Error("Persistent account lockout state was not stored");
    }

    const throttleIp = "203.0.113.90";
    const throttleEmail = `phase9-throttle-${suffix}@example.test`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await recordLoginFailure(throttleIp, throttleEmail, client);
    }
    const throttle = await loginThrottleStatus(throttleIp, throttleEmail, client);
    if (!throttle.blocked || throttle.retryAfterSeconds <= 0) {
      throw new Error("Persistent identity throttle did not block repeated login failures");
    }

    const authenticated = await authenticateDetailed(manager.email, password, client);
    if (!authenticated.ok) throw new Error("Valid manager credentials were rejected");
    if (!authenticated.user.permissions.includes("security.manage")) {
      throw new Error("System Manager is missing security.manage");
    }
    if (!authenticated.user.permissions.includes("audit.read")) {
      throw new Error("System Manager is missing audit.read");
    }
    if (!ROLE_PERMISSIONS.Auditor.includes("audit.read") || ROLE_PERMISSIONS.Auditor.includes("security.manage")) {
      throw new Error("Auditor permissions violate least-privilege expectation");
    }

    const token = createSessionToken(authenticated.user);
    const tokenUser = verifySessionToken(token);
    if (!tokenUser) throw new Error("Fresh session token could not be verified");
    const validatedBeforeRevoke = await validateSessionUser(tokenUser, client);
    if (!validatedBeforeRevoke) throw new Error("Fresh session did not validate against current database state");

    await client.user.update({
      where: { id: manager.id },
      data: { sessionVersion: { increment: 1 } },
    });
    const validatedAfterRevoke = await validateSessionUser(tokenUser, client);
    if (validatedAfterRevoke) {
      throw new Error("Revoked session remained valid after sessionVersion increment");
    }

    await appendAuditEvent({
      action: "PHASE9_TEST",
      entityType: "Security",
      entityId: manager.id,
      entityCode: manager.email,
      actorEmail: manager.email,
      userId: manager.id,
      description: "First sealed security UAT event",
      outcome: "SUCCESS",
      requestId: `phase9-request-1-${suffix}`,
      metadata: { sequence: 1 },
    }, client);
    await appendAuditEvent({
      action: "PHASE9_TEST",
      entityType: "Security",
      entityId: manager.id,
      entityCode: manager.email,
      actorEmail: manager.email,
      userId: manager.id,
      description: "Second sealed security UAT event",
      outcome: "SUCCESS",
      requestId: `phase9-request-2-${suffix}`,
      metadata: { sequence: 2 },
    }, client);

    const cleanIntegrity = await verifyAuditIntegrity(client);
    if (!cleanIntegrity.valid || cleanIntegrity.sealedEntries < 2 || !cleanIntegrity.headHash) {
      throw new Error("Fresh sealed audit chain did not verify");
    }

    const firstSealed = await client.auditLog.findFirst({
      where: { integrityHash: { not: null } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!firstSealed) throw new Error("Sealed audit event not found for tamper test");
    await client.auditLog.update({
      where: { id: firstSealed.id },
      data: { description: "TAMPERED AFTER SEAL" },
    });
    const tamperedIntegrity = await verifyAuditIntegrity(client);
    if (tamperedIntegrity.valid || tamperedIntegrity.brokenAtId !== firstSealed.id) {
      throw new Error("Audit tampering was not detected");
    }

    const publicRequest = new NextRequest("https://erp.example.test/login");
    const publicResponse = proxy(publicRequest);
    if (
      publicResponse.headers.get("x-frame-options") !== "DENY"
      || publicResponse.headers.get("x-content-type-options") !== "nosniff"
      || !publicResponse.headers.get("content-security-policy")?.includes("frame-ancestors 'none'")
      || !publicResponse.headers.get("x-request-id")
    ) {
      throw new Error("Required security response headers were not applied");
    }

    const crossSiteRequest = new NextRequest("https://erp.example.test/api/auth/login", {
      method: "POST",
      headers: {
        origin: "https://evil.example.test",
        "sec-fetch-site": "cross-site",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: manager.email, password }),
    });
    const crossSiteResponse = proxy(crossSiteRequest);
    if (crossSiteResponse.status !== 403) {
      throw new Error(`Cross-site mutation was not rejected: HTTP ${crossSiteResponse.status}`);
    }

    const sameOriginRequest = new NextRequest("https://erp.example.test/api/auth/login", {
      method: "POST",
      headers: {
        origin: "https://erp.example.test",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: manager.email, password }),
    });
    const sameOriginResponse = proxy(sameOriginRequest);
    if (sameOriginResponse.status === 403) {
      throw new Error("Same-origin login request was incorrectly rejected by the gateway");
    }

    console.log(JSON.stringify({
      database: "temporary clone",
      liveDatabaseChanged: false,
      accountLockout: {
        failedLoginCount: lockedRecord.failedLoginCount,
        locked: Boolean(lockedRecord.lockedUntil),
        retryAfterSeconds: fifthFailure.ok ? 0 : fifthFailure.retryAfterSeconds,
      },
      persistentThrottle: {
        blocked: throttle.blocked,
        retryAfterSeconds: throttle.retryAfterSeconds,
      },
      rbac: {
        systemManagerSecurityManage: authenticated.user.permissions.includes("security.manage"),
        systemManagerAuditRead: authenticated.user.permissions.includes("audit.read"),
        auditorAuditRead: ROLE_PERMISSIONS.Auditor.includes("audit.read"),
        auditorSecurityManage: ROLE_PERMISSIONS.Auditor.includes("security.manage"),
      },
      sessionRevocation: {
        validBeforeRevoke: Boolean(validatedBeforeRevoke),
        validAfterRevoke: Boolean(validatedAfterRevoke),
      },
      auditIntegrity: {
        cleanValid: cleanIntegrity.valid,
        sealedEntries: cleanIntegrity.sealedEntries,
        tamperDetected: !tamperedIntegrity.valid,
        brokenAtId: tamperedIntegrity.brokenAtId,
      },
      gateway: {
        antiFraming: publicResponse.headers.get("x-frame-options"),
        noSniff: publicResponse.headers.get("x-content-type-options"),
        requestIdPresent: Boolean(publicResponse.headers.get("x-request-id")),
        crossSiteWriteStatus: crossSiteResponse.status,
        sameOriginWriteRejected: sameOriginResponse.status === 403,
      },
    }, null, 2));
  } finally {
    await client.$disconnect();
    const resolved = path.resolve(temporaryRoot);
    const tmp = path.resolve(os.tmpdir());
    if (!resolved.startsWith(`${tmp}${path.sep}`)) throw new Error("Unsafe UAT cleanup path");
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
