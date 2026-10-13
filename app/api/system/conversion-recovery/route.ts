import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { recoveryEvidenceHash } from "@/lib/erp/recovery-evidence";

export const runtime = "nodejs";
const reviewSchema = z.object({
 claimId: z.string().min(1),
 evidence: z.string().trim().min(20).max(2000),
});
export async function GET() {
 try {
  await requirePermission("settings.manage");
  const claims = await prisma.approvalRequest.findMany({
   where: { type: "ERP_CONVERSION_IDEMPOTENCY", status: { in: ["PENDING", "IN_REVIEW"] } },
   select: { id:true, code:true, documentType:true, documentCode:true, status:true, createdAt:true, updatedAt:true, approverComment:true },
   orderBy: { createdAt: "asc" }, take: 250,
  });
  const total = await prisma.approvalRequest.count({ where: { type: "ERP_CONVERSION_IDEMPOTENCY", status: { in: ["PENDING", "IN_REVIEW"] } } });
  return NextResponse.json({ ok:true, total, more:total>claims.length, claims, policy:"Inspection and evidence-only. Never automatically retries or clears conversion claims; reconcile linked downstream documents and journal postings first." });
 } catch(error) {
  const msg=error instanceof Error?error.message:"Recovery queue unavailable";
  return NextResponse.json({ok:false,error:msg},{status:msg==="Unauthorized"?401:msg==="Forbidden"?403:500});
 }
}
export async function POST(request:Request) {
 try {
  const user=await requirePermission("settings.manage");
  const input=reviewSchema.parse(await request.json());
  const claim=await prisma.approvalRequest.findFirst({
   where:{ id:input.claimId, type:"ERP_CONVERSION_IDEMPOTENCY", status:{in:["PENDING","IN_REVIEW"]} },
   select:{id:true,code:true,documentType:true,documentCode:true},
  });
  if(!claim) return NextResponse.json({ok:false,error:"Unresolved conversion claim not found"},{status:404});
  const fingerprint=recoveryEvidenceHash(claim.code,input.evidence,user.email);
  // Only append a review note. Do not mark APPROVED, delete claims, or permit retries.
  const updated=await prisma.approvalRequest.updateMany({
   where:{id:claim.id,type:"ERP_CONVERSION_IDEMPOTENCY",status:{in:["PENDING","IN_REVIEW"]}},
   data:{status:"IN_REVIEW",approverComment:"Reviewed by "+user.email+"; evidence SHA-256 "+fingerprint+"; conversion remains blocked pending reconciliation."},
  });
  if(updated.count!==1) return NextResponse.json({ok:false,error:"Claim changed during review"},{status:409});
  console.info("conversion-recovery.review",{claimId:claim.id,kind:claim.documentType,source:claim.documentCode,reviewer:user.email,evidenceHash:fingerprint});
  return NextResponse.json({ok:true,claimId:claim.id,evidenceHash:fingerprint,status:"IN_REVIEW",retryAllowed:false,notice:"Evidence recorded, claim still blocked. No financial posting or conversion was retried."});
 }catch(error) {
  const message=error instanceof z.ZodError?error.issues.map(x=>x.message).join("; "):error instanceof Error?error.message:"Review failed";
  return NextResponse.json({ok:false,error:message},{status:message==="Unauthorized"?401:message==="Forbidden"?403:error instanceof z.ZodError?400:500});
 }
}
