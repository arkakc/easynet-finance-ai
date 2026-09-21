import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createCostCenter, listCostCenters, updateCostCenter } from "@/lib/accounting/cost-centers";

const createSchema = z.object({
  code: z.string().trim().optional().default(""),
  name: z.string().trim().min(1),
  parentRef: z.string().trim().optional().default(""),
  company: z.string().trim().optional().default("Easynet"),
  description: z.string().trim().optional().default(""),
  isActive: z.boolean().optional().default(true),
});

const updateSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().optional(),
  parentRef: z.string().trim().optional().default(""),
  description: z.string().trim().optional(),
  isActive: z.boolean().optional().default(true),
});

export async function GET() {
  try {
    await requirePermission("accounts.read");
    const costCenters = await listCostCenters();
    return NextResponse.json({ ok: true, costCenters });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cost Center read failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission("accounts.write");
    const parsed = createSchema.parse(await request.json());
    const row = await createCostCenter(parsed);
    return NextResponse.json({ ok: true, row });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Cost Center create failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    await requirePermission("accounts.write");
    const parsed = updateSchema.parse(await request.json());
    const row = await updateCostCenter(parsed);
    return NextResponse.json({ ok: true, row });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error ? error.message : "Cost Center update failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400 });
  }
}
