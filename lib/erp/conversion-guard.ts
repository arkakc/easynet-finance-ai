import { createHash } from "node:crypto";
import { prisma } from "@/src/lib/prisma";

/**
 * SQLite-backed unique acquisition for source-to-target conversion.
 * All application instances MUST point at the same Prisma database.
 * The downstream legacy Apps Script write is not transactionally coupled
 * to SQLite; call sites must recheck existing records after acquisition.
 */
export async function withConversionGuard<T>(kind: string, sourceId: string, execute: () => Promise<T>): Promise<T> {
  const code = "CONVERSION:" + createHash("sha256").update(kind + ":" + sourceId).digest("hex");
  let lock: { id: string };
  try {
    lock = await prisma.approvalRequest.create({
      data: { code, type: "ERP_CONVERSION_IDEMPOTENCY", documentType: kind, documentCode: sourceId, requestedBy: "system", status: "PENDING" },
      select: { id: true },
    });
  } catch (error) {
    const isDuplicate = typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
    if (isDuplicate) throw new Error("Conversion already in progress or completed for this source. Refresh linked documents before retrying.");
    throw error;
  }
  try {
    const result = await execute();
    await prisma.approvalRequest.update({ where: { id: lock.id }, data: { status: "APPROVED", approvedAt: new Date() } });
    return result;
  } catch (error) {
    // Release only our own lock. A partial downstream write may have happened;
    // every caller MUST recheck the target before creating it on retry.
    await prisma.approvalRequest.delete({ where: { id: lock.id } }).catch(() => undefined);
    throw error;
  }
}
