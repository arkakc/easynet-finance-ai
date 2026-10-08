import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { documentSeriesId } from "@/lib/accounting/document-numbering";

const MAX_BYTES = 3 * 1024 * 1024;
const MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);

export async function POST(request: Request) {
  try {
    const actor = await requirePermission("settings.manage");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > MAX_BYTES || !MIME_TYPES.has(file.type)) {
      return NextResponse.json({ ok: false, error: "Upload a PDF, PNG, or JPG certificate (maximum 3 MB)." }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const valid = file.type === "application/pdf"
      ? buffer.subarray(0, 5).toString() === "%PDF-"
      : file.type === "image/png"
        ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (!valid) return NextResponse.json({ ok: false, error: "The uploaded certificate does not match its file type." }, { status: 400 });
    const id = randomUUID();
    const name = file.name.trim().slice(0, 180).replace(/[\\/:*?"<>|]/g, "-") || "GST-certificate";
    const storageKey = `gst_certificate_data_${id}`;
    const actorRow = await prisma.user.findUnique({ where: { email: actor.email.toLowerCase() }, select: { id: true } });
    if (!actorRow) throw new Error("Authenticated user record not found");
    const document = await prisma.$transaction(async (tx) => {
      await tx.globalSettings.create({ data: { key: storageKey, value: buffer.toString("base64"), updatedBy: actor.email } });
      return tx.document.create({ data: {
        code: documentSeriesId("Document"), name, type: "CERTIFICATE",
        documentType: "GST_REGISTRATION", fileUrl: `/api/setup/gst-certificate?id=${id}`,
        fileSize: buffer.length, contentLength: buffer.length, mimeType: file.type,
        status: "UPLOADED", createdBy: actorRow.id,
      } });
    });
    return NextResponse.json({ ok: true, id: document.id, name });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Certificate upload failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400 });
  }
}

export async function GET(request: Request) {
  try {
    await requirePermission("settings.manage");
    const id = new URL(request.url).searchParams.get("id") || "";
    const doc = await prisma.document.findFirst({ where: { fileUrl: `/api/setup/gst-certificate?id=${id}`, documentType: "GST_REGISTRATION" } });
    if (!id || !doc) return NextResponse.json({ ok: false, error: "Certificate not found" }, { status: 404 });
    const stored = await prisma.globalSettings.findUnique({ where: { key: `gst_certificate_data_${id}` }, select: { value: true } });
    if (!stored?.value) return NextResponse.json({ ok: false, error: "Certificate content not found" }, { status: 404 });
    return new Response(Buffer.from(stored.value, "base64"), {
      headers: { "Content-Type": doc.mimeType || "application/octet-stream", "Content-Disposition": `attachment; filename="${doc.name.replace(/["\\]/g, "_")}"`, "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Certificate unavailable";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400 });
  }
}
