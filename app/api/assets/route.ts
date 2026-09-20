import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { appendRecord, findRecords, listTable, backendConfigStatus } from "@/lib/backend/apps-script";
import { normalizeAccountingDate } from "@/lib/accounting/loan";
import { prisma } from "@/src/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { loadConfiguredPostingAccounts } from "@/lib/accounting/finance-settings.server";
import { postJournal } from "@/lib/accounting/posting";
import { documentSeriesId } from "@/lib/accounting/document-numbering";

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

const depreciationSchema = z.object({
  assetId: z.string().trim().min(1),
  depreciationDate: z.string().trim().min(8),
  amount: z.coerce.number().finite().positive().optional(),
  reference: z.string().trim().optional().default(""),
});

function requireSecret(secret?: string) {
  if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");
  if (!secret || secret !== env.APP_SECRET) throw new Error("Unauthorized");
}

export async function GET() {
  try {
    await requirePermission("stock.read");
    const backendConfigured = Object.values(backendConfigStatus()).some((service) => service.source !== "unconfigured");
    if (!backendConfigured) {
      const assets = await prisma.fixedAsset.findMany({ orderBy: { assetId: "asc" } });
      return NextResponse.json({
        ok: true,
        source: "prisma",
        assets: assets.map((asset) => ({
          assetId: asset.assetId,
          assetName: asset.assetName,
          assetCategory: asset.assetCategory,
          purchaseDate: asset.purchaseDate.toISOString().slice(0, 10),
          supplierId: asset.supplierId || "",
          cost: Number(asset.cost),
          serialNumber: asset.serialNumber || "",
          location: asset.location || "",
          assignedTo: asset.assignedTo || "",
          usefulLifeMonths: asset.usefulLifeMonths,
          accumulatedDepreciation: Number(asset.accumulatedDepreciation),
          netBookValue: Number(asset.netBookValue),
          status: asset.status,
          sourceDocumentId: asset.sourceDocumentId || "",
          acquisitionJournalId: asset.acquisitionJournalId || "",
          depreciationJournalId: asset.depreciationJournalId || "",
          journalId: asset.depreciationJournalId || asset.acquisitionJournalId || "",
        })),
      });
    }
    const result = await listTable("FixedAssets", 500, 0);
    return NextResponse.json({ ok: true, assets: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Asset read failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 });
  }
}

async function postAssetDepreciation(raw: unknown) {
  const record = depreciationSchema.parse(raw || {});
  const backendConfigured = Object.values(backendConfigStatus()).some((service) => service.source !== "unconfigured");
  if (backendConfigured) throw new Error("Fixed asset depreciation posting is currently supported in local Prisma mode only");

  const asset = await prisma.fixedAsset.findFirst({ where: { OR: [{ id: record.assetId }, { assetId: record.assetId }] } });
  if (!asset) throw new Error("Fixed asset does not exist");
  if (asset.status !== "ACTIVE") throw new Error("Only active fixed assets can be depreciated");

  const cost = Number(asset.cost || 0);
  const currentAccumulated = Number(asset.accumulatedDepreciation || 0);
  const monthlyAmount = Math.round((cost / Math.max(1, asset.usefulLifeMonths)) * 100) / 100;
  const requestedAmount = record.amount ?? monthlyAmount;
  const amount = Math.min(requestedAmount, Math.max(0, cost - currentAccumulated));
  if (!(amount > 0)) throw new Error("Asset is already fully depreciated");

  const postingDate = normalizeAccountingDate(record.depreciationDate);
  const documentId = `DEP:${asset.id}:${postingDate}`;
  const defaults = await loadConfiguredPostingAccounts();
  const journal = await postJournal({
    postingDate,
    documentType: "FIXED_ASSET_DEPRECIATION",
    documentId,
    documentNumber: documentSeriesId("Depreciation"),
    reference: record.reference || `Depreciation for ${asset.assetName}`,
    lines: [
      { accountId: defaults.depreciationExpenseAccount, debit: amount, supplierId: asset.supplierId || undefined, description: "Fixed asset depreciation expense" },
      { accountId: defaults.accumulatedDepreciationAccount, credit: amount, supplierId: asset.supplierId || undefined, description: "Accumulated depreciation" },
    ],
    createdBy: "asset-depreciation",
    approvedBy: "Finance Controller",
  });

  const accumulatedDepreciation = Math.round((currentAccumulated + amount) * 100) / 100;
  const netBookValue = Math.round(Math.max(0, cost - accumulatedDepreciation) * 100) / 100;
  const updated = await prisma.fixedAsset.update({
    where: { id: asset.id },
    data: {
      accumulatedDepreciation,
      netBookValue,
      depreciationJournalId: journal.journalId,
      status: netBookValue <= 0 ? "FULLY_DEPRECIATED" : asset.status,
    },
  });

  return {
    asset: {
      assetId: updated.assetId,
      accumulatedDepreciation: Number(updated.accumulatedDepreciation),
      netBookValue: Number(updated.netBookValue),
      status: updated.status,
      depreciationJournalId: updated.depreciationJournalId || "",
      journalId: updated.depreciationJournalId || "",
    },
    journalId: journal.journalId,
    amount,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { secret?: string; action?: "create" | "depreciate"; record?: unknown };
    requireSecret(body.secret);
    if (body.action === "depreciate") return NextResponse.json({ ok: true, ...(await postAssetDepreciation(body.record)) });

    const record = schema.parse(body.record || {});
    const backendConfigured = Object.values(backendConfigStatus()).some((service) => service.source !== "unconfigured");
    if (!backendConfigured) {
      if (record.supplierId) {
        const supplier = await prisma.supplier.findUnique({ where: { id: record.supplierId } });
        if (!supplier) throw new Error("Supplier does not exist");
      }
      if (!record.sourceDocumentId) {
        throw new Error("Fixed asset creation requires a retained source document");
      }
      const source = await prisma.document.findFirst({
        where: { OR: [{ id: record.sourceDocumentId }, { code: record.sourceDocumentId }, { documentId: record.sourceDocumentId }] },
      });
      if (!source) throw new Error("Source document does not exist");
      if (!source.fileUrl) throw new Error("Source document binary is not retained in the local database");
      if (record.serialNumber) {
        const serial = await prisma.fixedAsset.findFirst({ where: { serialNumber: record.serialNumber } });
        if (serial) throw new Error(`Asset serial number already exists: ${record.serialNumber}`);
      }
      const assetId = record.assetId || documentSeriesId("Asset");
      const duplicate = await prisma.fixedAsset.findUnique({ where: { assetId } });
      if (duplicate) throw new Error(`Asset ID already exists: ${assetId}`);
      const asset = await prisma.fixedAsset.create({
        data: {
          assetId,
          assetName: record.assetName,
          assetCategory: record.assetCategory,
          purchaseDate: new Date(normalizeAccountingDate(record.purchaseDate)),
          supplierId: record.supplierId || null,
          cost: record.cost,
          serialNumber: record.serialNumber || null,
          location: record.location || null,
          assignedTo: record.assignedTo || null,
          usefulLifeMonths: record.usefulLifeMonths,
          netBookValue: record.cost,
          sourceDocumentId: source.id,
          acquisitionJournalId: null,
          depreciationJournalId: null,
        },
      });
      return NextResponse.json({ ok: true, source: "prisma", row: { ...record, assetId, status: asset.status, accumulatedDepreciation: 0, netBookValue: record.cost, acquisitionJournalId: "", depreciationJournalId: "", journalId: "" } });
    }
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

    const assetId = record.assetId || documentSeriesId("Asset");
    const duplicate = await findRecords("FixedAssets", { assetId }, 1);
    if (duplicate.rows.length) throw new Error(`Asset ID already exists: ${assetId}`);
    const result = await appendRecord("FixedAssets", {
      ...record,
      purchaseDate: normalizeAccountingDate(record.purchaseDate),
      assetId,
      accumulatedDepreciation: 0,
      netBookValue: record.cost,
      status: "ACTIVE",
      acquisitionJournalId: "",
      depreciationJournalId: "",
    }, "asset-ui");
    return NextResponse.json({ ok: true, row: result.row });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Asset write failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
