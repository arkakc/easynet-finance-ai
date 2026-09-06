import { NextResponse } from "next/server";
import { findRecords, updateRecord } from "@/lib/backend/apps-script";

const CONFIRM = "uat-gst-verify-20260906";

export async function GET(request: Request) {
  try {
    if (process.env.VERCEL_ENV !== "preview") {
      return NextResponse.json({ ok: false, error: "UAT GST override is preview-only" }, { status: 403 });
    }

    const url = new URL(request.url);
    if (url.searchParams.get("confirm") !== CONFIRM) {
      return NextResponse.json({ ok: false, error: "Confirmation token required" }, { status: 403 });
    }

    const current = await findRecords<any>("Settings", { key: "gst_status" }, 1);
    if (!current.rows.length) {
      throw new Error("gst_status setting is missing");
    }

    const result = await updateRecord<any>(
      "Settings",
      "key",
      "gst_status",
      {
        value: "VERIFIED",
        notes: "UAT ONLY - temporary GST test status; not evidence of GST registration. Restore before production.",
      },
      "uat-gst-override",
    );

    return NextResponse.json({
      ok: true,
      environment: "preview",
      gstStatus: result.row?.value || "VERIFIED",
      uatOnly: true,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "UAT GST verification failed" },
      { status: 400 },
    );
  }
}
