import { createHash, randomUUID } from "node:crypto";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { appendRecord, batchAppend, findRecords, listTable, uploadSourceFile } from "@/lib/backend/apps-script";
import { documentSchema } from "@/lib/ai/document-schema";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

function requireSecret(secret: string) {
  if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");
  if (!secret || secret !== env.APP_SECRET) throw new Error("Unauthorized");
}

async function resolveParty(counterparty: string | null, partyType: string) {
  if (!counterparty) return { partyType: "", partyId: "" };
  const needle = counterparty.trim().toLowerCase();
  if (!needle) return { partyType: "", partyId: "" };

  const [customers, suppliers] = await Promise.all([
    listTable<any>("Customers", 500, 0),
    listTable<any>("Suppliers", 500, 0),
  ]);

  if (partyType !== "Supplier") {
    const customer = customers.rows.find((row) => String(row.customerName || "").trim().toLowerCase() === needle);
    if (customer) return { partyType: "Customer", partyId: customer.customerId };
  }
  if (partyType !== "Customer") {
    const supplier = suppliers.rows.find((row) => String(row.supplierName || "").trim().toLowerCase() === needle);
    if (supplier) return { partyType: "Supplier", partyId: supplier.supplierId };
  }
  return { partyType, partyId: "" };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const secret = String(formData.get("secret") || "");
    requireSecret(secret);

    if (!(file instanceof File)) throw new Error("Source document is required");
    if (!ALLOWED.has(file.type)) throw new Error("Only PDF, PNG, JPG and WEBP documents are supported");
    if (file.size <= 0) throw new Error("Uploaded file is empty");
    if (file.size > MAX_BYTES) throw new Error("Maximum source-document size is 8 MB for the MVP");
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

    const bytes = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const duplicates = await findRecords<any>("Documents", { sha256 }, 10);
    if (duplicates.rows.length) {
      return NextResponse.json({
        ok: false,
        duplicate: true,
        error: "Duplicate source document detected by SHA-256",
        existing: duplicates.rows.map((row) => ({ documentId: row.documentId, documentType: row.documentType, documentNumber: row.documentNumber, status: row.status })),
      }, { status: 409 });
    }

    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const base64 = bytes.toString("base64");
    const model = env.OPENAI_MODEL || "gpt-5-mini";

    // The Responses structured-output surface changed slightly across OpenAI SDK
    // minor versions. Keep the request payload runtime-compatible while validating
    // the returned object with our own Zod schema before any finance data is saved.
    const response = await (client.responses as any).parse({
      model,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "You are extracting finance source documents for Easynet IT Solutions Limited in Papua New Guinea.",
                "Extract only information visible in the document. Do not invent missing fields.",
                "Amounts must reconcile: net + GST = gross where the document supports it.",
                "Document dates should be YYYY-MM-DD where possible.",
                "Project IDs such as PJ-01-2026 must be preserved exactly.",
                "Confidence must reflect extraction certainty, not business validity.",
              ].join("\n"),
            },
            file.type.startsWith("image/")
              ? { type: "input_image", image_url: `data:${file.type};base64,${base64}`, detail: "high" }
              : { type: "input_file", filename: file.name, file_data: `data:${file.type};base64,${base64}` },
          ],
        },
      ],
      text: { format: zodTextFormat(documentSchema, "finance_document") },
    } as any);

    const extracted = documentSchema.parse(response.output_parsed);

    const resolved = await resolveParty(extracted.counterparty, extracted.partyType);
    const documentId = `DOC-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const now = new Date().toISOString();

    const retained = await uploadSourceFile({
      fileName: file.name,
      mimeType: file.type,
      base64,
      sha256,
      documentId,
    });

    await appendRecord("Documents", {
      documentId,
      sourceFileName: file.name,
      driveFileId: retained.driveFileId,
      driveUrl: retained.driveUrl,
      sha256,
      documentType: extracted.documentType,
      documentNumber: extracted.documentNo || "",
      partyType: resolved.partyType,
      partyId: resolved.partyId,
      projectId: extracted.projectId || "",
      documentDate: extracted.documentDate || "",
      netAmount: extracted.netAmount,
      gstAmount: extracted.gstAmount,
      totalAmount: extracted.grossAmount,
      currency: extracted.currency || "PGK",
      aiConfidence: extracted.confidence,
      status: "AI_REVIEW_REQUIRED",
      uploadedBy: "finance-ui",
      createdAt: now,
      updatedAt: now,
    }, "ai-document-intake");

    if (extracted.lines.length) {
      await batchAppend("DocumentLines", extracted.lines.map((line, index) => ({
        documentLineId: `${documentId}-${String(index + 1).padStart(3, "0")}`,
        documentId,
        lineNo: index + 1,
        itemId: line.itemCode || "",
        description: line.description,
        qty: line.qty,
        uom: line.uom || "",
        rate: line.rate,
        netAmount: line.netAmount,
        gstAmount: line.gstAmount,
        totalAmount: line.totalAmount,
        createdAt: now,
      })), "ai-document-intake");
    }

    return NextResponse.json({
      ok: true,
      documentId,
      sha256,
      driveFileId: retained.driveFileId,
      driveUrl: retained.driveUrl,
      extracted,
      resolvedParty: resolved,
      controlStatus: {
        postingAllowed: false,
        humanReviewRequired: true,
        sourceRetainedInDrive: true,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document extraction failed";
    const status = message === "Unauthorized" ? 401 : message.includes("not configured") ? 503 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
