import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { getSetupOverview, OPENING_RECON_AREAS } from "@/lib/accounting/setup-workflow";
import { documentSeriesId } from "@/lib/accounting/document-numbering";

export const runtime = "nodejs";
const MAX_BYTES = 3 * 1024 * 1024;
const MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);
export async function POST(request: Request) {
  try {
    const actor = await requirePermission("settings.manage");
    const form = await request.formData();
    const area = String(form.get("area") || "");
    const reference = String(form.get("reference") || "").trim();
    const file = form.get("file");
    const overview = await getSetupOverview();
    const row = overview.openingReconciliation.areas.find(item => item.key === area);
    if (!overview.openingValidated || !overview.openingFinalized || overview.config.openingMode !== "EXISTING_BUSINESS") throw new Error("Posted existing-business opening balances required.");
    if (!OPENING_RECON_AREAS.includes(area as typeof OPENING_RECON_AREAS[number]) || !row?.required || ["ar", "ap"].includes(area)) throw new Error("This control requires automated reconciliation, not document confirmation.");
    if (reference.length < 8 || reference.length > 250) throw new Error("Enter a real evidence reference of 8–250 characters.");
    if (!(file instanceof File) || !file.size || file.size > MAX_BYTES || !MIME_TYPES.has(file.type)) throw new Error("Attach a PDF, PNG or JPG supporting document up to 3 MB.");
    const buffer = Buffer.from(await file.arrayBuffer());
    const valid = file.type === "application/pdf" ? buffer.subarray(0,5).toString() === "%PDF-" : file.type === "image/png" ? buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
    if (!valid) throw new Error("Document content does not match its file type.");
    const actorRow = await prisma.user.findUnique({ where: { email: actor.email.toLowerCase() }, select: { id: true } });
    if (!actorRow) throw new Error("Administrator account not found.");
    const evidenceId = randomUUID();
    await prisma.$transaction(async tx => {
      const [current, stored] = await Promise.all([tx.globalSettings.findUnique({ where: { key: "opening_balance_entries" } }), tx.globalSettings.findUnique({ where: { key: "opening_reconciliation_evidence" } })]);
      if (String(current?.value || "[]") !== JSON.stringify(overview.openingBalanceEntries)) throw new Error("Opening balances changed; refresh and retry.");
      const name = file.name.trim().slice(0,180).replace(/[\\/:*?"<>|]/g,"-") || "opening-evidence";
      await tx.globalSettings.create({ data: { key: `opening_recon_file_${evidenceId}`, value: buffer.toString("base64"), updatedBy: actor.email } });
      const document = await tx.document.create({ data: { code: documentSeriesId("Document"), name, type: "CERTIFICATE", documentType: "OPENING_RECONCILIATION", fileUrl: `/api/setup/opening-reconciliation-evidence?id=${evidenceId}`, fileSize: buffer.length, contentLength: buffer.length, mimeType: file.type, status: "UPLOADED", createdBy: actorRow.id } });
      let evidence: Record<string, unknown> = {};
      try { evidence = JSON.parse(stored?.value || "{}"); } catch { /* overwrite malformed evidence */ }
      evidence[area] = { reference, reviewer: actor.email, reviewedAt: new Date().toISOString(), fingerprint: overview.openingReconciliation.fingerprint, documentId: document.id };
      await tx.globalSettings.upsert({ where: { key: "opening_reconciliation_evidence" }, create: { key: "opening_reconciliation_evidence", value: JSON.stringify(evidence), updatedBy: actor.email }, update: { value: JSON.stringify(evidence), updatedBy: actor.email, updatedAt: new Date() } });
    });
    return NextResponse.json({ ok: true, ...(await getSetupOverview()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supporting evidence upload failed.";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400 });
  }
}
export async function GET(request: Request) {
  try {
    await requirePermission("settings.manage");
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!id) throw new Error("Missing evidence id");
    const doc = await prisma.document.findFirst({ where: { fileUrl: `/api/setup/opening-reconciliation-evidence?id=${id}`, documentType: "OPENING_RECONCILIATION", status: { not: "ARCHIVED" } } });
    if (!doc) return NextResponse.json({ ok: false, error: "Document not found" }, { status: 404 });
    const stored = await prisma.globalSettings.findUnique({ where: { key: `opening_recon_file_${id}` }, select: { value: true } });
    if (!stored?.value) return NextResponse.json({ ok: false, error: "Document content missing" }, { status: 404 });
    return new Response(Buffer.from(stored.value, "base64"), { headers: { "Content-Type": doc.mimeType || "application/octet-stream", "Content-Disposition": `attachment; filename="${doc.name.replace(/["\\]/g, "_")}"`, "Cache-Control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Document unavailable" }, { status: 400 }); }
}
