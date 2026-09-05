import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { appendRecord, findRecords, listTable } from "@/lib/backend/apps-script";
import { normalizeAccountingDate } from "@/lib/accounting/loan";

const schema = z.object({
  assetId: z.string().trim().optional().default(""),
  assetName: z.string().trim().min(2),
  assetCategory: z.string().trim().min(1),
  purchaseDate: z.string().trim().min(8),
  supplierId: z.string().trim().optional().default(""),
  cost: z.coerce.number().finite().nonnegative(),
  serialNumber: z.string().trim().optional().default(""),
  location: z.string().trim().optional().default(""),
  assignedTo: z.string().trim().optional().default(""),
  usefulLifeMonths: z.coerce.number().int().positive().default(36),
  sourceDocumentId: z.string().trim().optional().default(""),
});

function requireSecret(secret?: string) {
  if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");
  if (!secret || secret !== env.APP_SECRET) throw new Error("Unauthorized");
}

export async function GET() {
  try {
    const result = await listTable("FixedAssets", 500, 0);
    return NextResponse.json({ ok: true, assets: result.rows });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Asset read failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { secret?: string; record?: unknown };
    requireSecret(body.secret);
    const record = schema.parse(body.record || {});
    if (record.supplierId) {
      const supplier = await findRecords("Suppliers", { supplierId: record.supplierId }, 1);
      if (!supplier.rows.length) throw new Error("Supplier does not exist");
    }
    if (!record.sourceDocumentId) {
      throw new Error("Fixed asset creation requires a retained source document");
    }
    const source = await findRecords<any>("Documents", { documentId: record.sourceDocumentId }, 1);
    if (!source.rows.length) throw new Error("Source document does not exist");
    if (!String(source.rows[0].driveFileId || "").trim()) throw new Error("Source document binary is not retained in Google Drive");

    if (record.serialNumber) {
      const serial = await findRecords<any>("FixedAssets", { serialNumber: record.serialNumber }, 10);
      if (serial.rows.length) throw new Error(`Asset serial number already exists: ${record.serialNumber}`);
    }

    const assetId = record.assetId || `AST-${randomUUID().slice(0, 8).toUpperCase()}`;
    const duplicate = await findRecords("FixedAssets", { assetId }, 1);
    if (duplicate.rows.length) throw new Error(`Asset ID already exists: ${assetId}`);
    const result = await appendRecord("FixedAssets", {
      ...record,
      purchaseDate: normalizeAccountingDate(record.purchaseDate),
      assetId,
      accumulatedDepreciation: 0,
      netBookValue: record.cost,
      status: "ACTIVE",
    }, "asset-ui");
    return NextResponse.json({ ok: true, row: result.row });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Asset write failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
