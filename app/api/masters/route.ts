import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { prisma } from "@/src/lib/prisma";
import { requirePermission } from "@/lib/auth";
import {
  appendRecord,
  findRecords,
  listTable,
  updateRecord,
} from "@/lib/backend/apps-script";
import {
  prismaDeleteSupplier,
  prismaDeleteCustomer,
  prismaDeleteProject,
  prismaDeleteItem,
} from "@/lib/backend/prisma-store";
import { normalizeAccountingDate } from "@/lib/accounting/loan";
import { documentSeriesId } from "@/lib/accounting/document-numbering";
import { normalizeCurrency } from "@/lib/accounting/currency";

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
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional().default(""),
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
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional().default(""),
});

const projectSchema = z.object({
  projectId: optionalText,
  projectName: z.string().trim().min(2),
  customerId: optionalText,
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
  return documentSeriesId(prefix);
}

async function localBaseCurrency() {
  const row = await prisma.globalSettings.findFirst({
    where: { key: { in: ["currency", "base_currency"] } },
    orderBy: { updatedAt: "desc" },
  });
  return normalizeCurrency(row?.value || "PGK");
}

async function syncPrimaryContact(input: {
  customerId?: string;
  supplierId?: string;
  name?: string;
  email?: string;
  phone?: string;
}) {
  const name = String(input.name || "").trim();
  const where = input.customerId ? { customerId: input.customerId } : { supplierId: input.supplierId };
  const existing = await prisma.contact.findFirst({
    where,
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  if (!name) {
    if (existing?.isPrimary) await prisma.contact.delete({ where: { id: existing.id } });
    return;
  }
  const data = { name, email: String(input.email || "").trim() || null, phone: String(input.phone || "").trim() || null, isPrimary: true };
  if (existing) {
    await prisma.contact.update({ where: { id: existing.id }, data });
  } else {
    await prisma.contact.create({ data: { ...data, ...(input.customerId ? { customerId: input.customerId } : { supplierId: input.supplierId }) } });
  }
}

function requireAdminSecret(secret?: string) {
  if (!env.APP_SECRET) throw new Error("APP_SECRET is not configured");
  if (!secret || secret !== env.APP_SECRET) throw new Error("Unauthorized");
}

async function normalizedProject(parsed: z.infer<typeof projectSchema>, backendConfigured: boolean) {
  if (parsed.customerId) {
    if (backendConfigured) {
      const customer = await findRecords("Customers", { customerId: parsed.customerId }, 1);
      if (!customer.rows.length) throw new Error("Selected customer does not exist");
    } else {
      const customer = await prisma.customer.findFirst({
        where: { OR: [{ id: parsed.customerId }, { code: parsed.customerId }] },
      });
      if (!customer) throw new Error("Selected customer does not exist");
    }
  }

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

function prismaProjectStatus(value: string) {
  const normalized = String(value || "ACTIVE").trim().toUpperCase().replace(/\s+/g, "_");
  if (normalized === "OPEN") return "ACTIVE" as const;
  if (normalized === "PLANNING" || normalized === "ACTIVE" || normalized === "ON_HOLD" || normalized === "COMPLETED" || normalized === "CANCELLED") {
    return normalized;
  }
  return "ACTIVE" as const;
}

export async function GET() {
  try {
    await requirePermission("dashboard.read");
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
    const message = error instanceof Error ? error.message : "Master-data read failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      secret?: string;
      type?: "customer" | "supplier" | "project" | "item";
      mode?: "create" | "update" | "delete";
      record?: unknown;
    };

    requireAdminSecret(body.secret);
    const mode = body.mode === "delete" ? "delete" : body.mode === "update" ? "update" : "create";
    // Core operational data is Prisma-only. Optional Apps Script integrations
    // must never switch this route away from the authoritative database.
    const backendConfigured = false;

    if (body.type === "customer") {
      if (mode === "delete") {
        const raw = (body.record || {}) as Record<string, unknown>;
        const customerId = String(raw.customerId || raw.id || raw.code || "").trim();
        if (!customerId) throw new Error("Customer ID is required for deletion");

        if (!backendConfigured) {
          const res = await prismaDeleteCustomer(customerId);
          return NextResponse.json({ ok: true, type: body.type, mode, ...res });
        }

        const [existing, invoices, quotes, payments, projects] = await Promise.all([
          findRecords("Customers", { customerId }, 1),
          findRecords("Invoices", { customerId }, 1),
          findRecords("Quotes", { customerId }, 1),
          findRecords("Payments", { partyId: customerId }, 1),
          findRecords("Projects", { customerId }, 1),
        ]);

        if (!existing.rows.length) throw new Error("Customer not found");

        const hasLedger = invoices.rows.length > 0 || quotes.rows.length > 0 || payments.rows.length > 0 || projects.rows.length > 0;
        if (hasLedger) {
          throw new Error("Cannot delete customer: customer already has accounts ledger entries or transactions.");
        }

        await updateRecord("Customers", "customerId", customerId, { active: false }, "master-data-ui:delete");
        return NextResponse.json({ ok: true, type: body.type, mode, deleted: true, customerId });
      }

      const parsed = customerSchema.parse(body.record || {});
      if (!backendConfigured) {
        if (mode === "update") {
          if (!parsed.customerId) throw new Error("Customer ID is required for update");
          const existing = await prisma.customer.findFirst({
            where: { OR: [{ id: parsed.customerId }, { code: parsed.customerId }] },
          });
          if (!existing) throw new Error("Customer not found");
          const updated = await prisma.customer.update({
            where: { id: existing.id },
            data: {
              name: parsed.customerName,
              phone: parsed.phone || null,
              email: parsed.email || null,
              address: parsed.address || null,
              taxId: parsed.taxId || null,
              paymentTerms: parsed.creditTermsDays || 30,
              creditLimit: parsed.creditLimit || null,
              currency: parsed.currency ? normalizeCurrency(parsed.currency) : existing.currency,
            },
          });
          await syncPrimaryContact({ customerId: updated.id, name: parsed.contactPerson, email: parsed.email, phone: parsed.phone });
          return NextResponse.json({
            ok: true,
            type: body.type,
            mode,
            row: {
              customerId: updated.code,
              internalCustomerId: updated.id,
              customerCode: updated.code,
              customerName: updated.name,
              contactPerson: parsed.contactPerson,
              phone: updated.phone || "",
              email: updated.email || "",
              address: updated.address || "",
              taxId: updated.taxId || "",
              creditTermsDays: updated.paymentTerms || 30,
              creditLimit: Number(updated.creditLimit || 0),
              currency: updated.currency,
              active: updated.isActive !== false,
            },
          });
        }
        const created = await prisma.customer.create({
          data: {
            code: generatedId("CUS"),
            name: parsed.customerName,
            phone: parsed.phone || null,
            email: parsed.email || null,
            address: parsed.address || null,
            taxId: parsed.taxId || null,
            paymentTerms: parsed.creditTermsDays || 30,
            creditLimit: parsed.creditLimit || null,
            currency: normalizeCurrency(parsed.currency || await localBaseCurrency()),
          },
        });
        await syncPrimaryContact({ customerId: created.id, name: parsed.contactPerson, email: parsed.email, phone: parsed.phone });
        return NextResponse.json({
          ok: true,
          type: body.type,
          mode,
          row: {
            customerId: created.code,
            internalCustomerId: created.id,
            customerCode: created.code,
            customerName: created.name,
            contactPerson: parsed.contactPerson,
            phone: created.phone || "",
            email: created.email || "",
            address: created.address || "",
            taxId: created.taxId || "",
            creditTermsDays: created.paymentTerms || 30,
            creditLimit: Number(created.creditLimit || 0),
            currency: created.currency,
            active: true,
          },
        });
      }

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
      if (mode === "delete") {
        const raw = (body.record || {}) as Record<string, unknown>;
        const supplierId = String(raw.supplierId || raw.id || raw.code || "").trim();
        if (!supplierId) throw new Error("Supplier ID is required for deletion");

        if (!backendConfigured) {
          const res = await prismaDeleteSupplier(supplierId);
          return NextResponse.json({ ok: true, type: body.type, mode, ...res });
        }

        const [existing, bills, pos, payments, expenses] = await Promise.all([
          findRecords("Suppliers", { supplierId }, 1),
          findRecords("SupplierBills", { supplierId }, 1),
          findRecords("PurchaseOrders", { supplierId }, 1),
          findRecords("Payments", { partyId: supplierId }, 1),
          findRecords("Expenses", { supplierId }, 1),
        ]);

        if (!existing.rows.length) throw new Error("Supplier not found");

        const hasLedger = bills.rows.length > 0 || pos.rows.length > 0 || payments.rows.length > 0 || expenses.rows.length > 0;
        if (hasLedger) {
          throw new Error("Cannot delete supplier: supplier already has accounts ledger entries or transactions.");
        }

        await updateRecord("Suppliers", "supplierId", supplierId, { active: false }, "master-data-ui:delete");
        return NextResponse.json({ ok: true, type: body.type, mode, deleted: true, supplierId });
      }

      const parsed = supplierSchema.parse(body.record || {});
      if (!backendConfigured) {
        if (mode === "update") {
          if (!parsed.supplierId) throw new Error("Supplier ID is required for update");
          const existing = await prisma.supplier.findFirst({
            where: { OR: [{ id: parsed.supplierId }, { code: parsed.supplierId }] },
          });
          if (!existing) throw new Error("Supplier not found");
          const updated = await prisma.supplier.update({
            where: { id: existing.id },
            data: {
              name: parsed.supplierName,
              phone: parsed.phone || null,
              email: parsed.email || null,
              address: parsed.address || null,
              taxId: parsed.taxId || null,
              paymentTerms: parsed.paymentTermsDays || 30,
              currency: parsed.currency ? normalizeCurrency(parsed.currency) : existing.currency,
            },
          });
          await syncPrimaryContact({ supplierId: updated.id, name: parsed.contactPerson, email: parsed.email, phone: parsed.phone });
          return NextResponse.json({
            ok: true,
            type: body.type,
            mode,
            row: {
              supplierId: updated.code,
              internalSupplierId: updated.id,
              supplierCode: updated.code,
              supplierName: updated.name,
              contactPerson: parsed.contactPerson,
              phone: updated.phone || "",
              email: updated.email || "",
              address: updated.address || "",
              taxId: updated.taxId || "",
              paymentTermsDays: updated.paymentTerms || 30,
              currency: updated.currency,
              active: updated.isActive !== false,
            },
          });
        }
        const created = await prisma.supplier.create({
          data: {
            code: generatedId("SUP"),
            name: parsed.supplierName,
            phone: parsed.phone || null,
            email: parsed.email || null,
            address: parsed.address || null,
            taxId: parsed.taxId || null,
            paymentTerms: parsed.paymentTermsDays || 30,
            currency: normalizeCurrency(parsed.currency || await localBaseCurrency()),
          },
        });
        await syncPrimaryContact({ supplierId: created.id, name: parsed.contactPerson, email: parsed.email, phone: parsed.phone });
        return NextResponse.json({
          ok: true,
          type: body.type,
          mode,
          row: {
            supplierId: created.code,
            internalSupplierId: created.id,
            supplierCode: created.code,
            supplierName: created.name,
            contactPerson: parsed.contactPerson,
            phone: created.phone || "",
            email: created.email || "",
            address: created.address || "",
            taxId: created.taxId || "",
            paymentTermsDays: created.paymentTerms || 30,
            currency: created.currency,
            active: true,
          },
        });
      }

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
      if (mode === "delete") {
        const raw = (body.record || {}) as Record<string, unknown>;
        const projectId = String(raw.projectId || raw.id || raw.code || "").trim();
        if (!projectId) throw new Error("Project ID is required for deletion");

        if (!backendConfigured) {
          const res = await prismaDeleteProject(projectId);
          return NextResponse.json({ ok: true, type: body.type, mode, ...res });
        }

        const [existing, pos, bills, quotes, invoices, payments, expenses] = await Promise.all([
          findRecords("Projects", { projectId }, 1),
          findRecords("PurchaseOrders", { projectId }, 1),
          findRecords("SupplierBills", { projectId }, 1),
          findRecords("Quotes", { projectId }, 1),
          findRecords("Invoices", { projectId }, 1),
          findRecords("Payments", { projectId }, 1),
          findRecords("Expenses", { projectId }, 1),
        ]);

        if (!existing.rows.length) throw new Error("Project not found");

        const hasLedger = pos.rows.length > 0 || bills.rows.length > 0 || quotes.rows.length > 0 || invoices.rows.length > 0 || payments.rows.length > 0 || expenses.rows.length > 0;
        if (hasLedger) {
          throw new Error("Cannot delete project: project already has accounts ledger entries or transactions.");
        }

        await updateRecord("Projects", "projectId", projectId, { status: "CANCELLED" }, "master-data-ui:delete");
        return NextResponse.json({ ok: true, type: body.type, mode, deleted: true, projectId });
      }

      const parsed = projectSchema.parse(body.record || {});
      const normalizedProjectRecord = await normalizedProject(parsed, backendConfigured);
      if (!backendConfigured) {
        if (mode === "update") {
          if (!parsed.projectId) throw new Error("Project ID is required for update");
          const existing = await prisma.project.findFirst({
            where: { OR: [{ id: parsed.projectId }, { code: parsed.projectId }] },
          });
          if (!existing) throw new Error("Project not found");
          const customerMatch = parsed.customerId
            ? await prisma.customer.findFirst({ where: { OR: [{ id: parsed.customerId }, { code: parsed.customerId }] } })
            : null;
          const updated = await prisma.project.update({
            where: { id: existing.id },
            data: {
              name: parsed.projectName,
              customerId: customerMatch ? customerMatch.id : null,
              startDate: parsed.startDate ? new Date(parsed.startDate) : null,
              endDate: parsed.endDate ? new Date(parsed.endDate) : null,
              budget: parsed.contractTotal || null,
              status: prismaProjectStatus(parsed.status),
            },
          });
          return NextResponse.json({
            ok: true,
            type: body.type,
            mode,
            row: {
              projectId: updated.code,
              internalProjectId: updated.id,
              projectCode: updated.code,
              projectName: updated.name,
              customerId: parsed.customerId || "",
              startDate: updated.startDate?.toISOString().slice(0, 10) || "",
              endDate: updated.endDate?.toISOString().slice(0, 10) || "",
              status: updated.status || "OPEN",
              contractNet: Number(updated.budget || 0),
              gstAmount: 0,
              contractTotal: Number(updated.budget || 0),
              expectedCost: 0,
            },
          });
        }
        const customerMatch = parsed.customerId
          ? await prisma.customer.findFirst({ where: { OR: [{ id: parsed.customerId }, { code: parsed.customerId }] } })
          : null;
        const created = await prisma.project.create({
          data: {
            code: generatedId("PJ"),
            name: parsed.projectName,
            customerId: customerMatch ? customerMatch.id : null,
            startDate: parsed.startDate ? new Date(parsed.startDate) : null,
            endDate: parsed.endDate ? new Date(parsed.endDate) : null,
            budget: parsed.contractTotal || null,
            status: prismaProjectStatus(parsed.status),
          },
        });
        return NextResponse.json({
          ok: true,
          type: body.type,
          mode,
          row: {
            projectId: created.code,
            internalProjectId: created.id,
            projectCode: created.code,
            projectName: created.name,
            customerId: parsed.customerId || "",
            startDate: created.startDate?.toISOString().slice(0, 10) || "",
            endDate: created.endDate?.toISOString().slice(0, 10) || "",
            status: created.status || "OPEN",
            contractNet: Number(created.budget || 0),
            gstAmount: 0,
            contractTotal: Number(created.budget || 0),
            expectedCost: 0,
          },
        });
      }

      if (mode === "update") {
        if (!parsed.projectId) throw new Error("Project ID is required for update");
        const existing = await findRecords("Projects", { projectId: parsed.projectId }, 1);
        if (!existing.rows.length) throw new Error("Project not found");
        const { projectId, ...patch } = normalizedProjectRecord;
        const result = await updateRecord("Projects", "projectId", projectId, patch, "master-data-ui:update");
        return NextResponse.json({ ok: true, type: body.type, mode, row: result.row });
      }

      const projectId = generatedId("PJ");
      const result = await appendRecord(
        "Projects",
        { ...normalizedProjectRecord, projectId },
        "master-data-ui",
      );
      return NextResponse.json({ ok: true, type: body.type, mode, row: result.row });
    }

    if (body.type === "item") {
      if (mode === "delete") {
        const raw = (body.record || {}) as Record<string, unknown>;
        const itemId = String(raw.itemId || raw.id || raw.code || "").trim();
        if (!itemId) throw new Error("Item ID is required for deletion");

        if (!backendConfigured) {
          const res = await prismaDeleteItem(itemId);
          return NextResponse.json({ ok: true, type: body.type, mode, ...res });
        }

        const existing = await findRecords("Items", { itemId }, 1);
        if (!existing.rows.length) throw new Error("Item not found");
        await updateRecord("Items", "itemId", itemId, { active: false }, "master-data-ui:delete");
        return NextResponse.json({ ok: true, type: body.type, mode, deleted: true, itemId });
      }
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
