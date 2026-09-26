import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { appendRecord, findRecords, listTable } from "@/lib/backend/apps-script";
import { round2 } from "@/lib/accounting/inventory";
import { documentSeriesId } from "@/lib/accounting/document-numbering";

const schema = z.object({
  partyType: z.enum(["Customer", "Supplier"]),
  sourceDocumentType: z.enum(["Sales Quotation", "Purchase Order"]),
  sourceDocumentId: z.string().trim().min(1),
  paymentDate: z.string().trim().min(8),
  amount: z.coerce.number().finite().positive(),
  paymentMethod: z.string().trim().min(1),
  cashBankAccountId: z.string().trim().min(1),
  reference: z.string().trim().optional().default(""),
});

function year() {
  return new Intl.DateTimeFormat("en", { timeZone: "Pacific/Port_Moresby", year: "numeric" }).format(new Date());
}

async function nextPaymentNumber() {
  return documentSeriesId("Payment", Number(year()));
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    await requirePermission(input.partyType === "Supplier" ? "purchase.write" : "sales.write");
    if (input.partyType === "Customer" && input.sourceDocumentType !== "Sales Quotation") throw new Error("Customer advance must reference a Sales Quotation");
    if (input.partyType === "Supplier" && input.sourceDocumentType !== "Purchase Order") throw new Error("Supplier advance must reference a Purchase Order");

    const source = input.partyType === "Customer"
      ? (await findRecords<any>("Quotes", { quoteId: input.sourceDocumentId }, 1)).rows[0]
      : (await findRecords<any>("PurchaseOrders", { poId: input.sourceDocumentId }, 1)).rows[0];
    if (!source) throw new Error(`${input.sourceDocumentType} not found`);

    const status = String(source.status || "").toUpperCase();
    if (input.partyType === "Customer") {
      if (!["APPROVED", "PART_INVOICED"].includes(status)) throw new Error("Customer advance can be created only from an APPROVED or PART_INVOICED Sales Quotation");
    } else {
      // Once billing has started, settlement should be made against Accounts Payable,
      // not recorded as a new prepayment. PART_BILLED remains allowed only because
      // part of the order may still be awaiting supply/invoice.
      if (!["APPROVED", "PART_RECEIVED", "RECEIVED", "PART_BILLED"].includes(status)) {
        throw new Error("Supplier advance can be created only before the Purchase Order is fully billed/closed. Use Supplier Payment against the posted Supplier Invoice after billing.");
      }
    }

    const partyId = String(input.partyType === "Customer" ? source.customerId || "" : source.supplierId || "");
    if (!partyId) throw new Error(`${input.sourceDocumentType} has no linked ${input.partyType}`);
    const total = Number(source.totalAmount || 0);
    const marker = input.partyType === "Customer" ? `SQ:${input.sourceDocumentId}|` : `PO:${input.sourceDocumentId}|`;
    const paymentRows = await listTable<any>("Payments", 500, 0);
    const committed = round2((paymentRows.rows || [])
      .filter((row: any) => String(row.partyType || "") === input.partyType
        && String(row.partyId || "") === partyId
        && !["CANCELLED", "REVERSED"].includes(String(row.status || "").toUpperCase())
        && (String(row.sourceDocumentId || "") === input.sourceDocumentId || String(row.reference || "").startsWith(marker)))
      .reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0));
    const remainingCapacity = round2(Math.max(0, total - committed));
    if (input.amount > remainingCapacity + 0.001) {
      throw new Error(`Advance exceeds remaining source-document capacity. Available K${remainingCapacity.toFixed(2)}`);
    }

    const paymentId = documentSeriesId("Payment", Number(year()));
    const paymentNumber = await nextPaymentNumber();
    const userReference = input.reference || `${input.partyType} advance against ${String(input.partyType === "Customer" ? source.quoteNumber || input.sourceDocumentId : source.poNumber || input.sourceDocumentId)}`;
    const created = await appendRecord<any>("Payments", {
      paymentId,
      paymentNumber,
      paymentType: input.partyType === "Customer" ? "RECEIVE" : "PAY",
      partyType: input.partyType,
      partyId,
      projectId: String(source.projectId || ""),
      paymentDate: input.paymentDate,
      amount: round2(input.amount),
      paymentMethod: input.paymentMethod,
      cashBankAccountId: input.cashBankAccountId,
      reference: `${marker}${userReference}`,
      againstDocumentType: "",
      againstDocumentId: "",
      sourceDocumentId: input.sourceDocumentId,
      journalId: "",
      status: "DRAFT",
    }, "advance-payment:source-linked");

    const payment = created.row;
    const createdPaymentId = String(payment?.paymentId || paymentId || "").trim();
    const createdPaymentNumber = String(payment?.paymentNumber || paymentNumber || createdPaymentId).trim();
    if (!createdPaymentId) throw new Error("Advance Payment was saved but the created Payment ID could not be resolved");

    return NextResponse.json({
      ok: true,
      payment,
      paymentId: createdPaymentId,
      paymentNumber: createdPaymentNumber,
      remainingCapacity: round2(remainingCapacity - input.amount),
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((entry) => `${entry.path.join(".")}: ${entry.message}`).join("; ")
      : error instanceof Error ? error.message : "Advance Payment creation failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}
