import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { findRecords } from "@/lib/backend/apps-script";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sourceDocumentId = url.searchParams.get("sourceDocumentId")?.trim() || "";
    const partyType = url.searchParams.get("partyType")?.trim() || "";
    const partyId = url.searchParams.get("partyId")?.trim() || "";

    if (!sourceDocumentId) throw new Error("sourceDocumentId is required");
    if (partyType === "Supplier") await requirePermission("purchase.read");
    else await requirePermission("sales.read");

    const result = await findRecords<any>("Payments", { sourceDocumentId }, 500);
    const rows = (result.rows || []).filter((row: any) => {
      const status = String(row.status || "").toUpperCase();
      if (["CANCELLED", "REVERSED"].includes(status)) return false;
      if (partyType && String(row.partyType || "") !== partyType) return false;
      if (partyId && String(row.partyId || "") !== partyId) return false;
      return true;
    });

    return NextResponse.json({ ok: true, payments: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Source payment lookup failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 },
    );
  }
}
