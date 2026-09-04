import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true, service: "easynet-finance-ai", version: "0.1.0" });
}
