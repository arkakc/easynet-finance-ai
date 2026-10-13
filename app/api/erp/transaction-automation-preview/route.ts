import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { findRecords } from "@/lib/backend/apps-script";
import { automationPreview } from "@/lib/erp/transaction-automation-preview";

export async function GET(request: NextRequest) {
  try {
    const type = request.nextUrl.searchParams.get("type");
    const id = request.nextUrl.searchParams.get("id")?.trim() || "";
    if ((type !== "quote" && type !== "purchaseOrder") || !id || id.length > 180) {
      return NextResponse.json({ ok: false, error: "Valid source type and ID required" }, { status: 400 });
    }
    await requirePermission(type === "quote" ? "sales.read" : "purchase.read");
    const isSales = type === "quote";
    const sourceTable = isSales ? "Quotes" : "PurchaseOrders";
    const idField = isSales ? "quoteId" : "poId";
    const lineTable = isSales ? "QuoteLines" : "POLines";
    const targetTable = isSales ? "Quotes" : "SupplierBills";
    const [sourceResult, lineResult, duplicatesResult] = await Promise.all([
      findRecords<Record<string, unknown>>(sourceTable, { [idField]: id }, 1),
      findRecords<Record<string, unknown>>(lineTable, { [idField]: id }, 500),
      findRecords<Record<string, unknown>>(targetTable, { sourceDocumentId: id }, 100),
    ]);
    const source = sourceResult.rows[0];
    if (!source) return NextResponse.json({ ok: false, error: "Source document not found" }, { status: 404 });
    const preview = automationPreview(type, source, duplicatesResult.rows, lineResult.rows);
    return NextResponse.json({ ok: true, ...preview });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Automation preview failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400 });
  }
}
