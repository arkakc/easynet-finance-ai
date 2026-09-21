import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requirePermission } from "@/lib/auth";
import { applyOpeningSchedule, buildOpeningSchedulePreview, getOpeningSubledgerPosition, type OpeningEntity } from "@/lib/migration/opening-subledger";
import { getSetupGateState } from "@/lib/setup-gate";
import { prisma } from "@/src/lib/prisma";

export const runtime = "nodejs";

const entities = new Set<OpeningEntity>(["ar", "ap"]);
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;
const LOCKED_MESSAGE = "Opening AR/AP import is disabled because this accounting system was activated as a new business with zero opening balances. Run Full Reset / Delete All Master Data & Company Records to re-enable first-time opening migration.";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Opening subledger import failed";
  const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : /changed after backup|no longer eligible/i.test(message) ? 409 : 400;
  return NextResponse.json({ ok: false, error: message }, { status });
}

function template(entity: OpeningEntity) {
  const party = entity === "ar" ? "Customer Code" : "Supplier Code";
  const example = entity === "ar"
    ? "OB-AR-001,CUST-PNG-001,2025-12-01,2025-12-31,25000.00,Opening customer balance"
    : "OB-AP-001,SUP-HARDWARE-DIST,2025-12-01,2025-12-31,42500.00,Opening supplier balance";
  return `Document Code,${party},Original Document Date,Due Date,Outstanding,Description\r\n${example}\r\n`;
}

async function parseUpload(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json() as { entity?: string; mode?: string; confirmation?: string; fileName?: string; rows?: Array<Record<string, unknown>> };
    const entity = String(body.entity || "") as OpeningEntity;
    const mode = String(body.mode || "preview");
    const confirmation = String(body.confirmation || "");
    if (!entities.has(entity)) throw new Error("Select opening AR or AP");
    const sourceRows = Array.isArray(body.rows) ? body.rows : [];
    if (!sourceRows.length) throw new Error("Enter at least one opening schedule row");
    if (sourceRows.length > MAX_ROWS) throw new Error(`A single manual entry batch is limited to ${MAX_ROWS} rows`);
    const party = entity === "ar" ? "Customer Code" : "Supplier Code";
    const rows = sourceRows.map((row) => ({
      "Document Code": row.documentCode ?? row["Document Code"] ?? "",
      [party]: row.partyCode ?? row[party] ?? "",
      "Original Document Date": row.originalDocumentDate ?? row["Original Document Date"] ?? "",
      "Due Date": row.dueDate ?? row["Due Date"] ?? "",
      Outstanding: row.outstanding ?? row.Outstanding ?? "",
      Description: row.description ?? row.Description ?? "",
    }));
    return { file: { name: String(body.fileName || `manual-${entity}-opening-schedule`) }, entity, mode, confirmation, rows };
  }
  const form = await request.formData();
  const file = form.get("file");
  const entity = String(form.get("entity") || "") as OpeningEntity;
  const mode = String(form.get("mode") || "preview");
  const confirmation = String(form.get("confirmation") || "");
  if (!entities.has(entity)) throw new Error("Select opening AR or AP");
  if (!(file instanceof File)) throw new Error("Select a CSV or Excel aged schedule");
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error("Import file must be between 1 byte and 5 MB");
  if (!/\.(csv|xlsx|xls)$/i.test(file.name)) throw new Error("Only .csv, .xlsx, and .xls files are supported");
  const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer", cellDates: false, raw: /\.csv$/i.test(file.name) });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("The workbook does not contain a readable worksheet");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false, dateNF: "yyyy-mm-dd" });
  if (!rows.length) throw new Error("The aged schedule has no data rows");
  if (rows.length > MAX_ROWS) throw new Error(`A single import is limited to ${MAX_ROWS} rows`);
  return { file, entity, mode, confirmation, rows };
}

export async function GET(request: NextRequest) {
  try {
    await requirePermission("settings.manage");
    const gate = await getSetupGateState();
    const requestedTemplate = request.nextUrl.searchParams.get("template") as OpeningEntity | null;
    if (gate.openingSubledgerLocked && requestedTemplate) return NextResponse.json({ ok: false, locked: true, error: LOCKED_MESSAGE }, { status: 423 });
    if (requestedTemplate && entities.has(requestedTemplate)) {
      return new Response(template(requestedTemplate), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="easynet-opening-${requestedTemplate}-template.csv"`, "cache-control": "no-store" } });
    }
    const [ar, ap, history] = await Promise.all([
      getOpeningSubledgerPosition("ar"),
      getOpeningSubledgerPosition("ap"),
      prisma.auditLog.findMany({
        where: { entityType: { in: ["OPENING_AR_SCHEDULE", "OPENING_AP_SCHEDULE"] }, action: "IMPORT" },
        orderBy: { createdAt: "desc" }, take: 20,
        include: { user: { select: { name: true, email: true } } },
      }),
    ]);
    return NextResponse.json({ ok: true, locked: gate.openingSubledgerLocked, lockReason: gate.openingSubledgerLocked ? LOCKED_MESSAGE : "", positions: { ar, ap }, history: history.map((row) => ({ id: row.id, entity: row.entityType === "OPENING_AR_SCHEDULE" ? "ar" : "ap", fileName: row.entityCode, description: row.description, details: row.changes ? JSON.parse(row.changes) : null, importedBy: row.user?.name || row.user?.email || "Unknown", createdAt: row.createdAt.toISOString() })) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requirePermission("settings.manage");
    const gate = await getSetupGateState();
    if (gate.openingSubledgerLocked) return NextResponse.json({ ok: false, locked: true, error: LOCKED_MESSAGE }, { status: 423 });
    const upload = await parseUpload(request);
    const preview = await buildOpeningSchedulePreview(upload.entity, upload.rows);
    if (upload.mode === "preview") return NextResponse.json({ ok: true, mode: upload.mode, fileName: upload.file.name, ...preview });
    if (upload.mode !== "commit") throw new Error("Unsupported import mode");
    const result = await applyOpeningSchedule({ entity: upload.entity, sourceRows: upload.rows, confirmation: upload.confirmation, actorEmail: session.email, fileName: upload.file.name, ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null });
    return NextResponse.json({ ok: true, mode: upload.mode, message: `Imported ${result.created.length} opening ${upload.entity.toUpperCase()} row(s); posted GL was not changed`, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
