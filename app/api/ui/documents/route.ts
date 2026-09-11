import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { backendConfigStatus, findRecords, listTable } from "@/lib/backend/apps-script";
import { prisma } from "@/src/lib/prisma";

function localDocument(document: {
  id: string;
  code: string;
  type: string;
  name: string;
  fileUrl: string | null;
  hash: string | null;
  status: string;
  documentId: string | null;
  documentType: string | null;
  createdAt: Date;
}) {
  return {
    documentId: document.id,
    sourceFileName: document.name,
    driveUrl: document.fileUrl || "",
    documentType: document.documentType || document.type,
    documentNumber: document.code,
    partyType: "",
    partyId: "",
    projectId: "",
    documentDate: document.createdAt.toISOString(),
    netAmount: 0,
    gstAmount: 0,
    totalAmount: 0,
    aiConfidence: 0,
    status: document.status,
    createdAt: document.createdAt.toISOString(),
    sha256: document.hash || "",
  };
}

export async function GET(request: NextRequest) {
  try {
    await requirePermission("accounts.read");
    const documentId = String(request.nextUrl.searchParams.get("documentId") || "").trim();
    const backendConfigured = Object.values(backendConfigStatus()).some((service) => service.source !== "unconfigured");
    if (!backendConfigured) {
      if (documentId) {
        const document = await prisma.document.findFirst({
          where: { OR: [{ id: documentId }, { code: documentId }, { documentId }] },
        });
        if (!document) return NextResponse.json({ ok: false, error: "Document not found" }, { status: 404 });
        return NextResponse.json({ ok: true, source: "prisma", documentId, document: localDocument(document), lines: [] });
      }
      const documents = await prisma.document.findMany({ orderBy: { createdAt: "desc" } });
      return NextResponse.json({ ok: true, source: "prisma", documents: documents.map(localDocument) });
    }
    if (documentId) {
      const [document, lines] = await Promise.all([
        findRecords("Documents", { documentId }, 1),
        findRecords("DocumentLines", { documentId }, 500),
      ]);
      const record = document.rows[0];
      if (!record) return NextResponse.json({ ok: false, error: "Document not found" }, { status: 404 });
      return NextResponse.json({ ok: true, documentId, document: record, lines: lines.rows });
    }
    const documents = await listTable("Documents", 500, 0);
    return NextResponse.json({ ok: true, documents: documents.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document register load failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 });
  }
}
