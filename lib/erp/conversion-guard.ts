import { createHash } from "node:crypto";
import { prisma } from "@/src/lib/prisma";

/**
 * SQLite-backed unique acquisition for source-to-target conversion.
 * All application instances MUST point at the same Prisma database.
 * The downstream legacy Apps Script write is not transactionally coupled
 * to SQLite; call sites must recheck existing records after acquisition.
 */
export function conversionClaimCode(kind: string, sourceId: string): string {
  return "CONVERSION:" + createHash("sha256").update(kind + ":" + sourceId).digest("hex");
}

type ClaimStore = {
  create(args: { data: { code: string; type: string; documentType: string; documentCode: string; requestedBy: string; status: "PENDING" }; select: { id: true } }): Promise<{ id: string }>;
  update(args: { where: { id: string }; data: { status: "APPROVED" | "IN_REVIEW"; approvedAt?: Date; approverComment?: string } }): Promise<unknown>;
};

export async function executeWithConversionClaim<T>(
  store: ClaimStore, kind: string, sourceId: string, execute: () => Promise<T>,
): Promise<T> {
  if (!kind.trim() || !sourceId.trim()) throw new Error("A source and conversion type are required");
  let claim: { id: string };
  try {
    claim = await store.create({
      data: { code: conversionClaimCode(kind, sourceId), type: "ERP_CONVERSION_IDEMPOTENCY", documentType: kind,
        documentCode: sourceId, requestedBy: "system", status: "PENDING" },
      select: { id: true },
    });
  } catch (error) {
    const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
    if (duplicate) throw new Error("Conversion already in progress or completed for this source. Refresh linked documents before retrying.");
    throw error;
  }
  try {
    const result = await execute();
    await store.update({ where: { id: claim.id }, data: { status: "APPROVED", approvedAt: new Date() } });
    return result;
  } catch (error) {
    // Downstream writes may have succeeded; never release this claim automatically.
    await store.update({ where: { id: claim.id }, data: {
      status: "IN_REVIEW", approverComment: "Conversion failed or downstream outcome uncertain; reconcile before retrying.",
    } }).catch(() => undefined);
    throw error;
  }
}

export async function withConversionGuard<T>(kind: string, sourceId: string, execute: () => Promise<T>): Promise<T> {
  return executeWithConversionClaim({
    create: args => prisma.approvalRequest.create(args),
    update: args => prisma.approvalRequest.update(args),
  }, kind, sourceId, execute);
}
