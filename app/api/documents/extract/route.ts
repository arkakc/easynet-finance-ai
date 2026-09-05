import { createHash, randomUUID } from "node:crypto";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import {
  appendRecord,
  batchAppend,
  deleteSourceFile,
  findRecords,
  listTable,
  uploadSourceFile,
} from "@/lib/backend/apps-script";
import { documentSchema } from "@/lib/ai/document-schema";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function requireSecret(secret: string) {
  if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");
  if (!secret || secret !== env.APP_SECRET) throw new Error("Unauthorized");
}

async function resolveParty(counterparty: string | null, partyType: string) {
  if (!counterparty) return { partyType: partyType === "Unknown" ? "" : partyType, partyId: "" };
  const needle = counterparty.trim().toLowerCase();
  if (!needle) return { partyType: partyType === "Unknown" ? "" : partyType, partyId: "" };

  const [customers, suppliers] = await Promise.all([
    listTable<any>("Customers", 500, 0),
    listTable<any>("Suppliers", 500, 0),
  ]);

  if (partyType !== "Supplier") {
    const customer = customers.rows.find((row) => String(row.customerName || "").trim().toLowerCase() === needle);
    if (customer) return { partyType: "Customer", partyId: String(customer.customerId) };
  }
  if (partyType !== "Customer") {
    const supplier = suppliers.rows.find((row) => String(row.supplierName || "").trim().toLowerCase() === needle);
    if (supplier) return { partyType: "Supplier", partyId: String(supplier.supplierId) };
  }
  return { partyType: partyType === "Unknown" ? "" : partyType, partyId: "" };
}

async function findSecondaryDuplicate(input: {
  documentType: string;
  documentNumber: string;
  partyId: string;
  projectId: string;
  documentDate: string;
  totalAmount: number;
}) {
  if (!input.documentNumber) return null;
  const candidates = await findRecords<any>("Documents", { documentNumber: input.documentNumber }, 50);
  return candidates.rows.find((row) => {
    if (String(row.documentType || "") !== input.documentType) return false;
    if (input.partyId && String(row.partyId || "") !== input.partyId) return false;
    if (input.projectId && String(row.projectId || "") !== input.projectId) return false;
    if (input.documentDate && String(row.documentDate || "").slice(0, 10) !== input.documentDate.slice(0, 10)) return false;
    return Math.abs(Number(row.totalAmount || 0) - input.totalAmount) <= 0.02;
  }) || null;
}

export async function POST(request: Request) {
  let retainedFileId = "";
  let documentSaved = false;

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
        existing: duplicates.rows.map((row) => ({
          documentId: row.documentId,
          documentType: row.documentType,
          documentNumber: row.documentNumber,
          status: row.status,
        })),
      }, { status: 409 });
    }

    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const base64 = bytes.toString("base64");
    const model = env.OPENAI_MODEL || "gpt-5-mini";

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
    const issues: string[] = [];

    if (Math.abs(round2(extracted.netAmount + extracted.gstAmount) - round2(extracted.grossAmount)) > 0.02) {
      issues.push("Document totals do not reconcile: net + GST does not equal gross");
    }
    if (extracted.confidence < 0.8) issues.push(`AI confidence is low (${Math.round(extracted.confidence * 100)}%)`);
    if (extracted.counterparty && !resolved.partyId && ["Customer", "Supplier"].includes(extracted.partyType)) {
      issues.push(`Counterparty was not matched to a ${extracted.partyType} master`);
    }

    let projectId = extracted.projectId || "";
    if (projectId) {
      const project = await findRecords<any>("Projects", { projectId }, 1);
      if (!project.rows.length) {
        issues.push(`Project ${projectId} was not found in the project master`);
        projectId = "";
      }
    }

    const items = await listTable<any>("Items", 500, 0);
    const itemByCode = new Map(items.rows.map((row) => [String(row.itemCode || "").trim().toLowerCase(), String(row.itemId || "")]));
    const normalizedLines = extracted.lines.map((line, index) => {
      const code = String(line.itemCode || "").trim();
      const itemId = code ? (itemByCode.get(code.toLowerCase()) || "") : "";
      if (code && !itemId) issues.push(`Line ${index + 1}: item code ${code} was not matched to the item master`);
      return { ...line, itemId };
    });

    if (normalizedLines.length) {
      const lineGross = round2(normalizedLines.reduce((sum, line) => sum + Number(line.totalAmount || 0), 0));
      if (extracted.grossAmount > 0 && Math.abs(lineGross - round2(extracted.grossAmount)) > 0.02) {
        issues.push("Line totals do not reconcile to the extracted document gross amount");
      }
    }

    const secondaryDuplicate = await findSecondaryDuplicate({
      documentType: extracted.documentType,
      documentNumber: extracted.documentNo || "",
      partyId: resolved.partyId,
      projectId,
      documentDate: extracted.documentDate || "",
      totalAmount: extracted.grossAmount,
    });
    if (secondaryDuplicate) {
      return NextResponse.json({
        ok: false,
        duplicate: true,
        error: "Possible duplicate source document detected by document number, party/project/date and amount",
        existing: [{
          documentId: secondaryDuplicate.documentId,
          documentType: secondaryDuplicate.documentType,
          documentNumber: secondaryDuplicate.documentNumber,
          status: secondaryDuplicate.status,
        }],
      }, { status: 409 });
    }

    const documentId = `DOC-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const now = new Date().toISOString();

    const retained = await uploadSourceFile({
      fileName: file.name,
      mimeType: file.type,
      base64,
      sha256,
      documentId,
    });
    retainedFileId = retained.driveFileId;

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
      projectId,
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
    documentSaved = true;

    if (normalizedLines.length) {
      await batchAppend("DocumentLines", normalizedLines.map((line, index) => ({
        documentLineId: `${documentId}-${String(index + 1).padStart(3, "0")}`,
        documentId,
        lineNo: index + 1,
        itemId: line.itemId,
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

    if (issues.length) {
      await batchAppend("Exceptions", issues.map((message, index) => ({
        exceptionId: `${documentId}-EX-${String(index + 1).padStart(2, "0")}`,
        severity: "REVIEW",
        module: "AI_DOCUMENT_INTAKE",
        recordType: "Document",
        recordId: documentId,
        message,
        status: "OPEN",
        assignedTo: "Finance Controller",
        createdAt: now,
        resolvedAt: "",
        resolution: "",
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
      reviewIssues: issues,
      controlStatus: {
        postingAllowed: false,
        humanReviewRequired: true,
        sourceRetainedInDrive: true,
      },
    });
  } catch (error) {
    let cleanupWarning = "";
    if (retainedFileId && !documentSaved) {
      try {
        await deleteSourceFile(retainedFileId, "Document database save failed after Drive retention");
      } catch (cleanupError) {
        cleanupWarning = `; Drive rollback also failed: ${cleanupError instanceof Error ? cleanupError.message : "unknown error"}`;
      }
    }

    const message = `${error instanceof Error ? error.message : "Document extraction failed"}${cleanupWarning}`;
    const status = message === "Unauthorized" ? 401 : message.includes("not configured") ? 503 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
