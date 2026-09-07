import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import {
  appendRecord,
  findRecords,
  listTable,
  updateRecord,
} from "@/lib/backend/apps-script";
import { normalizeAccountingDate } from "@/lib/accounting/loan";

const optionalText = z.string().trim().optional().default("");
const optionalNumber = z.coerce.number().finite().nonnegative().optional().default(0);

const customerSchema = z.object({
  customerId: optionalText,
  customerName: z.string().trim().min(2),
  contactPerson: optionalText,
  phone: optionalText,
  email: z.union([z.string().trim().email(), z.literal("")]).optional().default(""),
  address: optionalText,
  taxId: optionalText,
  creditTermsDays: optionalNumber,
  creditLimit: optionalNumber,
});

const supplierSchema = z.object({
  supplierId: optionalText,
  supplierName: z.string().trim().min(2),
  contactPerson: optionalText,
  phone: optionalText,
  email: z.union([z.string().trim().email(), z.literal("")]).optional().default(""),
  address: optionalText,
  taxId: optionalText,
  paymentTermsDays: optionalNumber,
});

const projectSchema = z.object({
  projectId: optionalText,
  projectName: z.string().trim().min(2),
  customerId: z.string().trim().min(1),
  startDate: optionalText,
  endDate: optionalText,
  status: z.string().trim().min(1).default("OPEN"),
  contractNet: optionalNumber,
  gstAmount: optionalNumber,
  contractTotal: optionalNumber,
  expectedCost: optionalNumber,
  projectManager: optionalText,
});

function generatedId(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function requireAdminSecret(secret?: string) {
  if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");
  if (!secret || secret !== env.APP_SECRET) throw new Error("Unauthorized");
}

async function normalizedProject(parsed: z.infer<typeof projectSchema>) {
  const customer = await findRecords("Customers", { customerId: parsed.customerId }, 1);
  if (!customer.rows.length) throw new Error("Selected customer does not exist");

  const calculatedTotal = Math.round((parsed.contractNet + parsed.gstAmount + Number.EPSILON) * 100) / 100;
  if (parsed.contractTotal > 0 && Math.abs(parsed.contractTotal - calculatedTotal) > 0.01) {
    throw new Error("Project contract total must equal contract net plus GST");
  }
  const startDate = parsed.startDate ? normalizeAccountingDate(parsed.startDate) : "";
  const endDate = parsed.endDate ? normalizeAccountingDate(parsed.endDate) : "";
  if (startDate && endDate && endDate < startDate) throw new Error("Project end date cannot be before start date");
  return {
    ...parsed,
    startDate,
    endDate,
    contractTotal: parsed.contractTotal || calculatedTotal,
  };
}

export async function GET() {
  try {
    const [customers, suppliers, projects] = await Promise.all([
      listTable("Customers", 500, 0),
      listTable("Suppliers", 500, 0),
      listTable("Projects", 500, 0),
    ]);

    return NextResponse.json({
      ok: true,
      customers: customers.rows,
      suppliers: suppliers.rows,
      projects: projects.rows,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Master-data read failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      secret?: string;
      type?: "customer" | "supplier" | "project";
      mode?: "create" | "update";
      record?: unknown;
    };

    requireAdminSecret(body.secret);
    const mode = body.mode === "update" ? "update" : "create";

    if (body.type === "customer") {
      const parsed = customerSchema.parse(body.record || {});
      if (mode === "update") {
        if (!parsed.customerId) throw new Error("Customer ID is required for update");
        const existing = await findRecords("Customers", { customerId: parsed.customerId }, 1);
        if (!existing.rows.length) throw new Error("Customer not found");
        const { customerId, ...patch } = parsed;
        const result = await updateRecord("Customers", "customerId", customerId, patch, "master-data-ui:update");
        return NextResponse.json({ ok: true, type: body.type, mode, row: result.row });
      }

      const customerId = generatedId("CUS");
      const result = await appendRecord(
        "Customers",
        { ...parsed, customerId, active: true },
        "master-data-ui",
      );
      return NextResponse.json({ ok: true, type: body.type, mode, row: result.row });
    }

    if (body.type === "supplier") {
      const parsed = supplierSchema.parse(body.record || {});
      if (mode === "update") {
        if (!parsed.supplierId) throw new Error("Supplier ID is required for update");
        const existing = await findRecords("Suppliers", { supplierId: parsed.supplierId }, 1);
        if (!existing.rows.length) throw new Error("Supplier not found");
        const { supplierId, ...patch } = parsed;
        const result = await updateRecord("Suppliers", "supplierId", supplierId, patch, "master-data-ui:update");
        return NextResponse.json({ ok: true, type: body.type, mode, row: result.row });
      }

      const supplierId = generatedId("SUP");
      const result = await appendRecord(
        "Suppliers",
        { ...parsed, supplierId, active: true },
        "master-data-ui",
      );
      return NextResponse.json({ ok: true, type: body.type, mode, row: result.row });
    }

    if (body.type === "project") {
      const parsed = projectSchema.parse(body.record || {});
      const normalized = await normalizedProject(parsed);
      if (mode === "update") {
        if (!parsed.projectId) throw new Error("Project ID is required for update");
        const existing = await findRecords("Projects", { projectId: parsed.projectId }, 1);
        if (!existing.rows.length) throw new Error("Project not found");
        const { projectId, ...patch } = normalized;
        const result = await updateRecord("Projects", "projectId", projectId, patch, "master-data-ui:update");
        return NextResponse.json({ ok: true, type: body.type, mode, row: result.row });
      }

      const projectId = generatedId("PJ");
      const result = await appendRecord(
        "Projects",
        { ...normalized, projectId },
        "master-data-ui",
      );
      return NextResponse.json({ ok: true, type: body.type, mode, row: result.row });
    }

    return NextResponse.json({ ok: false, error: "Unsupported master-data type" }, { status: 400 });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ")
      : error instanceof Error
        ? error.message
        : "Master-data write failed";
    const status = message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
