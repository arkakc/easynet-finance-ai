import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { appendRecord, findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";

const settingSchema = z.object({
  key: z.enum([
    "company_name",
    "base_currency",
    "financial_year_start_month",
    "gst_status",
    "gst_number",
    "company_bank_name",
    "company_bank_account",
    "company_bank_bsb",
  ]),
  value: z.string().trim(),
  notes: z.string().trim().optional().default(""),
});

function requireSecret(secret?: string) {
  if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");
  if (!secret || secret !== env.APP_SECRET) throw new Error("Unauthorized");
}

export async function GET() {
  try {
    const result = await listTable("Settings", 500, 0);
    return NextResponse.json({ ok: true, settings: result.rows });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Settings read failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { secret?: string; setting?: unknown };
    requireSecret(body.secret);
    const setting = settingSchema.parse(body.setting || {});

    if (setting.key === "gst_status") {
      const normalized = setting.value.toUpperCase();
      if (!["UNVERIFIED", "VERIFIED", "NOT_REGISTERED"].includes(normalized)) {
        throw new Error("GST status must be UNVERIFIED, VERIFIED or NOT_REGISTERED");
      }
      if (normalized === "VERIFIED" && setting.notes.length < 5) {
        throw new Error("GST verification requires an evidence/reference note");
      }
      setting.value = normalized;
    }

    const existing = await findRecords<any>("Settings", { key: setting.key }, 1);
    if (existing.rows.length) {
      const result = await updateRecord("Settings", "key", setting.key, { value: setting.value, notes: setting.notes }, "settings-ui");
      return NextResponse.json({ ok: true, row: result.row, action: "updated" });
    }

    const result = await appendRecord("Settings", setting, "settings-ui");
    return NextResponse.json({ ok: true, row: result.row, action: "created" });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Settings update failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
