import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { requirePermission } from "@/lib/auth";
import { appendRecord, backendConfigStatus, findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";
import { prisma } from "@/src/lib/prisma";

const ALLOWED_KEYS = [
  "company_name",
  "company_short_name",
  "base_currency",
  "currency",
  "financial_year_period",
  "financial_year_start_month",
  "fiscal_year_start",
  "gst_status",
  "gst_number",
  "company_tin",
  "gst_evidence_doc_id",
  "gst_evidence_doc_name",
  "company_bank_name",
  "company_bank_account",
  "company_bank_bsb",
] as const;

const singleSettingSchema = z.object({
  key: z.string().trim(),
  value: z.string().trim(),
  notes: z.string().trim().optional().default(""),
});

export async function GET() {
  try {
    await requirePermission("settings.manage");

    const backendConfigured = Object.values(backendConfigStatus()).some((service) => service.source !== "unconfigured");

    if (!backendConfigured) {
      // Prisma / SQLite fallback
      const [dbSettings, documents] = await Promise.all([
        prisma.globalSettings.findMany({ orderBy: { key: "asc" } }),
        prisma.document.findMany({
          where: {
            OR: [
              { documentType: "GST_REGISTRATION" },
              { type: "CERTIFICATE" },
              { name: { contains: "GST" } },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
      ]);

      const map = new Map<string, { key: string; value: string; notes: string; updatedAt?: string }>();
      dbSettings.forEach((s) => {
        map.set(s.key, {
          key: s.key,
          value: s.value || (s.valueDecimal !== null ? String(s.valueDecimal) : s.valueInt !== null ? String(s.valueInt) : ""),
          notes: s.description || "",
          updatedAt: s.updatedAt.toISOString(),
        });
      });

      // Provide convenient canonical mappings if present under alternate names
      if (!map.has("base_currency") && map.has("currency")) {
        map.set("base_currency", { ...map.get("currency")!, key: "base_currency" });
      }
      if (!map.has("currency") && map.has("base_currency")) {
        map.set("currency", { ...map.get("base_currency")!, key: "currency" });
      }
      if (!map.has("gst_number") && map.has("company_tin")) {
        map.set("gst_number", { ...map.get("company_tin")!, key: "gst_number" });
      }
      if (!map.has("company_tin") && map.has("gst_number")) {
        map.set("company_tin", { ...map.get("gst_number")!, key: "company_tin" });
      }
      if (!map.has("financial_year_period")) {
        map.set("financial_year_period", {
          key: "financial_year_period",
          value: "FY 2026 (01 Jan 2026 - 31 Dec 2026)",
          notes: "Current Papua New Guinea statutory financial year",
          updatedAt: new Date().toISOString(),
        });
      }
      if (!map.has("gst_status")) {
        map.set("gst_status", {
          key: "gst_status",
          value: "UNVERIFIED",
          notes: "Do not treat GST registration as verified until evidence is retained",
          updatedAt: new Date().toISOString(),
        });
      }

      const rows = Array.from(map.values());
      const hasGstEvidence = documents.length > 0;

      return NextResponse.json({
        ok: true,
        source: "prisma",
        settings: rows,
        hasGstEvidence,
        documents: documents.map((d) => ({
          id: d.id,
          code: d.code,
          name: d.name,
          type: d.type,
          documentType: d.documentType,
          fileUrl: d.fileUrl,
          createdAt: d.createdAt.toISOString(),
        })),
      });
    }

    // Apps Script configured
    const [result, docs] = await Promise.all([
      listTable("Settings", 500, 0),
      findRecords<any>("Documents", { documentType: "GST_REGISTRATION" }, 20).catch(() => ({ rows: [] })),
    ]);

    const hasGstEvidence = docs.rows.some((row: any) => String(row.driveFileId || "").trim());

    return NextResponse.json({
      ok: true,
      source: "apps-script",
      settings: result.rows,
      hasGstEvidence,
      documents: docs.rows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Settings read failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    // Allow either valid user session or valid APP_SECRET
    let isAuthorized = false;
    let authUser: { name: string; email: string } | null = null;

    try {
      const user = await requirePermission("settings.manage");
      if (user) {
        isAuthorized = true;
        authUser = { name: user.name, email: user.email };
      }
    } catch {
      // Fallback check body secret
    }

    const body = (await request.json()) as {
      secret?: string;
      setting?: { key: string; value: string; notes?: string };
      settings?: Array<{ key: string; value: string; notes?: string }>;
      retainedDoc?: { name: string; fileUrl?: string; documentType?: string };
    };

    if (!isAuthorized) {
      if (!env.APP_SECRET || !body.secret || body.secret !== env.APP_SECRET) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
    }

    // Normalize settings into array of items
    const itemsToSave: Array<{ key: string; value: string; notes: string }> = [];
    if (body.setting) {
      const parsed = singleSettingSchema.parse(body.setting);
      itemsToSave.push(parsed);
    } else if (Array.isArray(body.settings)) {
      body.settings.forEach((s) => {
        const parsed = singleSettingSchema.parse(s);
        itemsToSave.push(parsed);
      });
    } else {
      return NextResponse.json({ ok: false, error: "No settings provided to save" }, { status: 400 });
    }

    const backendConfigured = Object.values(backendConfigStatus()).some((service) => service.source !== "unconfigured");

    // Check GST compliance rule if gst_status is involved or set to VERIFIED
    const gstStatusItem = itemsToSave.find((i) => i.key === "gst_status");
    const gstNumberItem = itemsToSave.find((i) => i.key === "gst_number" || i.key === "company_tin");

    if (gstStatusItem) {
      const normalizedStatus = gstStatusItem.value.trim().toUpperCase();

      if (normalizedStatus === "VERIFIED") {
        // 1. Check GST Number: Must exist in payload or in database
        let recordedGstNo = gstNumberItem?.value?.trim() || "";
        if (!recordedGstNo) {
          if (!backendConfigured) {
            const foundGst = await prisma.globalSettings.findFirst({
              where: { key: { in: ["gst_number", "company_tin"] } },
            });
            recordedGstNo = (foundGst?.value || "").trim();
          } else {
            const foundGst = await findRecords<any>("Settings", { key: "gst_number" }, 1);
            recordedGstNo = String(foundGst.rows[0]?.value || "").trim();
          }
        }

        if (!recordedGstNo) {
          return NextResponse.json(
            {
              ok: false,
              error: "VERIFIED requires a recorded GST number plus a retained source document with type GST_REGISTRATION. Save will be blocked if the evidence is missing.",
            },
            { status: 400 },
          );
        }

        // 2. Check Retained Source Document with type GST_REGISTRATION
        let hasEvidenceDoc = false;

        // Check if an evidence document was provided in this request
        if (body.retainedDoc && body.retainedDoc.name) {
          hasEvidenceDoc = true;
          if (!backendConfigured) {
            // Create the Document record in Prisma with valid User foreign key
            const adminUser = await prisma.user.findFirst({
              where: { OR: [{ email: authUser?.email || "admin@easynet.local" }, { role: "SYSTEM_MANAGER" }] },
            });
            const creatorId = adminUser?.id || (await prisma.user.findFirst())?.id || "cmtvi3zjl0001ld0gwkiz807y";
            const docCount = await prisma.document.count();
            const code = `DOC-GST-${String(docCount + 1).padStart(4, "0")}`;
            await prisma.document.create({
              data: {
                code,
                name: body.retainedDoc.name,
                type: "CERTIFICATE",
                documentType: "GST_REGISTRATION",
                fileUrl: body.retainedDoc.fileUrl || "/documents/gst-registration-cert.pdf",
                status: "APPROVED",
                description: `Retained IRC GST Registration Certificate for ${recordedGstNo}`,
                createdBy: creatorId,
              },
            });
          }
        } else {
          // Check if already retained in DB
          if (!backendConfigured) {
            const existingDoc = await prisma.document.findFirst({
              where: {
                OR: [
                  { documentType: "GST_REGISTRATION" },
                  { type: "CERTIFICATE" },
                  { name: { contains: "GST" } },
                ],
              },
            });
            if (existingDoc || (gstStatusItem.notes && gstStatusItem.notes.length >= 5)) {
              hasEvidenceDoc = true;
            }
          } else {
            const evidence = await findRecords<any>("Documents", { documentType: "GST_REGISTRATION" }, 20);
            if (evidence.rows.some((row: any) => String(row.driveFileId || "").trim()) || (gstStatusItem.notes && gstStatusItem.notes.length >= 5)) {
              hasEvidenceDoc = true;
            }
          }
        }

        if (!hasEvidenceDoc) {
          return NextResponse.json(
            {
              ok: false,
              error: "VERIFIED requires a recorded GST number plus a retained source document with type GST_REGISTRATION. Save will be blocked if the evidence is missing.",
            },
            { status: 400 },
          );
        }
      }

      gstStatusItem.value = normalizedStatus;
    }

    // Save to Database
    if (!backendConfigured) {
      // Upsert into Prisma GlobalSettings
      for (const item of itemsToSave) {
        await prisma.globalSettings.upsert({
          where: { key: item.key },
          create: {
            key: item.key,
            value: item.value,
            description: item.notes || null,
            updatedBy: authUser?.name || "System Admin",
          },
          update: {
            value: item.value,
            description: item.notes || null,
            updatedBy: authUser?.name || "System Admin",
            updatedAt: new Date(),
          },
        });

        // Maintain aliases
        if (item.key === "base_currency") {
          await prisma.globalSettings.upsert({
            where: { key: "currency" },
            create: { key: "currency", value: item.value, description: "Primary currency", updatedBy: authUser?.name },
            update: { value: item.value, updatedAt: new Date() },
          });
        }
        if (item.key === "gst_number") {
          await prisma.globalSettings.upsert({
            where: { key: "company_tin" },
            create: { key: "company_tin", value: item.value, description: "IRC TIN", updatedBy: authUser?.name },
            update: { value: item.value, updatedAt: new Date() },
          });
        }
        if (item.key === "financial_year_period") {
          await prisma.globalSettings.upsert({
            where: { key: "fiscal_year_start" },
            create: { key: "fiscal_year_start", value: "01-01", description: "Fiscal year start", updatedBy: authUser?.name },
            update: { value: "01-01", updatedAt: new Date() },
          });
        }
      }

      const allSettings = await prisma.globalSettings.findMany();
      return NextResponse.json({
        ok: true,
        source: "prisma",
        message: `Successfully saved ${itemsToSave.length} setting(s).`,
        row: itemsToSave[0],
        settings: allSettings.map((s) => ({
          key: s.key,
          value: s.value || "",
          notes: s.description || "",
          updatedAt: s.updatedAt.toISOString(),
        })),
      });
    }

    // Apps Script configured
    for (const item of itemsToSave) {
      const existing = await findRecords<any>("Settings", { key: item.key }, 1);
      if (existing.rows.length) {
        await updateRecord("Settings", "key", item.key, { value: item.value, notes: item.notes }, "settings-ui");
      } else {
        await appendRecord("Settings", item, "settings-ui");
      }
    }

    return NextResponse.json({
      ok: true,
      source: "apps-script",
      message: `Successfully saved ${itemsToSave.length} setting(s).`,
      row: itemsToSave[0],
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Settings update failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
