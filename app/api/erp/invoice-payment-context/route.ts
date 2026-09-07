import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { findRecords } from "@/lib/backend/apps-script";

export async function GET(request: Request) {
  try {
    await requirePermission("sales.read");
    const id = new URL(request.url).searchParams.get("id")?.trim() || "";
    if (!id) return NextResponse.json({ ok: false, error: "Sales Invoice ID is required" }, { status: 400 });

    const result = await findRecords<any>("Invoices", { invoiceId: id }, 1);
    const invoice = result.rows[0];
    if (!invoice) return NextResponse.json({ ok: false, error: "Sales Invoice not found" }, { status: 404 });

    const status = String(invoice.status || "").toUpperCase();
    if (!["POSTED", "PARTLY_PAID", "APPROVED"].includes(status)) {
      return NextResponse.json({ ok: false, error: `Sales Invoice must be approved and accounting-posted before creating a Payment Entry. Current status: ${status || "UNKNOWN"}` }, { status: 400 });
    }

    const outstandingAmount = Number(invoice.outstandingAmount ?? invoice.totalAmount ?? 0);
    if (!(outstandingAmount > 0)) return NextResponse.json({ ok: false, error: "Sales Invoice has no outstanding amount" }, { status: 400 });

    return NextResponse.json({
      ok: true,
      invoice: {
        invoiceId: String(invoice.invoiceId || id),
        invoiceNumber: String(invoice.invoiceNumber || invoice.invoiceId || id),
        customerId: String(invoice.customerId || ""),
        projectId: String(invoice.projectId || ""),
        totalAmount: Number(invoice.totalAmount || 0),
        outstandingAmount,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Sales Invoice payment context";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}
