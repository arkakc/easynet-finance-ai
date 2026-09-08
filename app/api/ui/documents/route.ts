import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { findRecords, listTable } from "@/lib/backend/apps-script";

export async function GET(request: NextRequest) {
  try {
    await requirePermission("accounts.read");
    const documentId = String(request.nextUrl.searchParams.get("documentId") || "").trim();
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
