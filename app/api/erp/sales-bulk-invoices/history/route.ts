import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";
export async function GET() {
 try {
  await requirePermission("audit.read");
  const entries = await prisma.auditLog.findMany({
   where: { entityType: "SalesInvoiceBulk", action: "BULK_CONVERT" },
   orderBy: [{ createdAt: "desc" }, { id: "desc" }],
   take: 300,
   select: { id: true, createdAt: true, entityId: true, entityCode: true, outcome: true, description: true, metadata: true },
  });
  const history = entries.map(entry => {
   let detail: Record<string,unknown> = {};
   try { detail = JSON.parse(entry.metadata || "{}"); } catch { /* Keep the audit entry readable if legacy metadata is malformed. */ }
   return { id:entry.id,createdAt:entry.createdAt,batchId:String(detail.batchId||""),
    sourceId:entry.entityId||"",destinationId:String(detail.destinationId||""),
    documentNumber:entry.entityCode||"",status:String(detail.result||entry.outcome),
    message:entry.description||"" };
  });
  return NextResponse.json({ok:true,history,limit:300});
 } catch (error) {
  const message=error instanceof Error?error.message:"Unable to load batch audit";
  return NextResponse.json({ok:false,error:message},{status:message==="Unauthorized"?401:message==="Forbidden"?403:500});
 }
}
