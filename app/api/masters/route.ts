import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import {
  appendRecord,
  findRecords,
  listTable,
} from "@/lib/backend/apps-script";

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
      record?: unknown;
    };

    requireAdminSecret(body.secret);

    if (body.type === "customer") {
      const parsed = customerSchema.parse(body.record || {});
      const customerId = parsed.customerId || generatedId("CUS");
      const duplicate = await findRecords("Customers", { customerId }, 1);
      if (duplicate.rows.length) throw new Error(`Customer ID already exists: ${customerId}`);

      const result = await appendRecord(
        "Customers",
        { ...parsed, customerId, active: true },
        "master-data-ui",
      );
      return NextResponse.json({ ok: true, type: body.type, row: result.row });
    }

    if (body.type === "supplier") {
      const parsed = supplierSchema.parse(body.record || {});
      const supplierId = parsed.supplierId || generatedId("SUP");
      const duplicate = await findRecords("Suppliers", { supplierId }, 1);
      if (duplicate.rows.length) throw new Error(`Supplier ID already exists: ${supplierId}`);

      const result = await appendRecord(
        "Suppliers",
        { ...parsed, supplierId, active: true },
        "master-data-ui",
      );
      return NextResponse.json({ ok: true, type: body.type, row: result.row });
    }

    if (body.type === "project") {
      const parsed = projectSchema.parse(body.record || {});
      const projectId = parsed.projectId || generatedId("PJ");
      const customer = await findRecords("Customers", { customerId: parsed.customerId }, 1);
      if (!customer.rows.length) throw new Error("Selected customer does not exist");
      const duplicate = await findRecords("Projects", { projectId }, 1);
      if (duplicate.rows.length) throw new Error(`Project ID already exists: ${projectId}`);

      const contractTotal = parsed.contractTotal || parsed.contractNet + parsed.gstAmount;
      const result = await appendRecord(
        "Projects",
        { ...parsed, projectId, contractTotal },
        "master-data-ui",
      );
      return NextResponse.json({ ok: true, type: body.type, row: result.row });
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
