import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, type Permission } from "@/lib/auth";
import { batchAppend, findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";
import { resolveTransactionItems } from "@/lib/erp/item-linking";
import { round2 } from "@/lib/accounting/inventory";

const documentTypeSchema = z.enum(["quote", "purchaseOrder", "supplierBill", "payment", "expense"]);
const optionalText = z.string().trim().optional().default("");
const money = z.coerce.number().finite().nonnegative();

const lineSchema = z.object({
  lineId: optionalText,
  itemId: optionalText,
  itemName: z.string().trim().min(1),
  itemType: optionalText,
  description: optionalText,
  qty: z.coerce.number().finite().positive(),
  uom: z.string().trim().min(1).default("Each"),
  rate: money,
});

const commercialSchema = z.object({
  type: documentTypeSchema,
  id: z.string().trim().min(1),
  partyId: z.string().trim().min(1),
  projectId: optionalText,
  documentDate: z.string().trim().min(8),
  dueDate: optionalText,
  expiryDate: optionalText,
  gstRate: z.coerce.number().finite().min(0).max(1),
  lines: z.array(lineSchema).min(1),
});

const paymentSchema = z.object({
  type: z.literal("payment"),
  id: z.string().trim().min(1),
  partyId: z.string().trim().min(1),
  projectId: optionalText,
  paymentDate: z.string().trim().min(8),
  amount: money.refine((value) => value > 0, "Amount must be greater than zero"),
  paymentMethod: z.string().trim().min(1),
  cashBankAccountId: z.string().trim().min(1),
  reference: optionalText,
});

const expenseSchema = z.object({
  type: z.literal("expense"),
  id: z.string().trim().min(1),
  supplierId: optionalText,
  projectId: optionalText,
  expenseDate: z.string().trim().min(8),
  expenseAccountId: z.string().trim().min(1),
  description: z.string().trim().min(1),
  netAmount: money,
  gstAmount: money,
  paymentMethod: z.string().trim().min(1),
  cashBankAccountId: z.string().trim().min(1),
});

const CONFIG: Record<string, {
  table: string;
  idField: string;
  numberField: string;
  lineTable?: string;
  lineIdField?: string;
  parentField?: string;
  partyField?: "customerId" | "supplierId";
  dateField?: string;
  permission: Permission;
}> = {
  quote: { table: "Quotes", idField: "quoteId", numberField: "quoteNumber", lineTable: "QuoteLines", lineIdField: "quoteLineId", parentField: "quoteId", partyField: "customerId", dateField: "quoteDate", permission: "sales.write" },
  purchaseOrder: { table: "PurchaseOrders", idField: "poId", numberField: "poNumber", lineTable: "POLines", lineIdField: "poLineId", parentField: "poId", partyField: "supplierId", dateField: "poDate", permission: "purchase.write" },
  supplierBill: { table: "SupplierBills", idField: "billId", numberField: "billNumber", lineTable: "SupplierBillLines", lineIdField: "billLineId", parentField: "billId", partyField: "supplierId", dateField: "billDate", permission: "purchase.write" },
  payment: { table: "Payments", idField: "paymentId", numberField: "paymentNumber", permission: "dashboard.read" },
  expense: { table: "Expenses", idField: "expenseId", numberField: "expenseNumber", permission: "purchase.write" },
};

function activeLineId(documentId: string, requested: string) {
  const value = String(requested || "").trim();
  if (value) return value;
  return `${documentId}-EDIT-${randomUUID().slice(0, 12).toUpperCase()}`;
}

async function assertProject(projectId: string) {
  if (!projectId) return;
  const result = await findRecords("Projects", { projectId }, 1);
  if (!result.rows.length) throw new Error("Project does not exist");
}

async function assertParty(field: "customerId" | "supplierId", value: string) {
  const table = field === "customerId" ? "Customers" : "Suppliers";
  const result = await findRecords(table, { [field]: value }, 1);
  if (!result.rows.length) throw new Error(`${field === "customerId" ? "Customer" : "Supplier"} does not exist`);
}

async function editCommercial(raw: unknown) {
  const input = commercialSchema.parse(raw);
  const config = CONFIG[input.type];
  if (!config?.lineTable || !config.lineIdField || !config.parentField || !config.partyField || !config.dateField) {
    throw new Error("Unsupported draft document type");
  }
  await requirePermission(config.permission);

  const record = (await findRecords<any>(config.table, { [config.idField]: input.id }, 1)).rows[0];
  if (!record) throw new Error("Document not found");
  if (String(record.status || "DRAFT").toUpperCase() !== "DRAFT") throw new Error("Only DRAFT documents can be edited");
  if (String(record.journalId || "").trim()) throw new Error("Posted documents cannot be edited");
  if (Number(record.paidAmount || 0) > 0.0001) throw new Error("Document with payment activity cannot be edited as draft");

  await assertParty(config.partyField, input.partyId);
  await assertProject(input.projectId);

  const number = String(record[config.numberField] || "");
  const temporaryQuotation = input.type === "quote" || (input.type === "purchaseOrder" && number.startsWith("SUPQ-"));
  const resolved = await resolveTransactionItems(input.lines, {
    allowTemporary: temporaryQuotation,
    autoCreateMissing: false,
    actor: `draft-${input.type}-edit`,
    defaultNewItemType: "STOCK",
  });

  const existing = (await findRecords<any>(config.lineTable, { [config.parentField]: input.id }, 500)).rows;
  const existingById = new Map(existing.map((line: any) => [String(line[config.lineIdField!] || ""), line]));
  const itemRows = (await listTable<any>("Items", 500, 0)).rows;
  const itemById = new Map(itemRows.map((item: any) => [String(item.itemId || item.itemCode || ""), item]));
  const desiredIds = new Set<string>();

  const desired = resolved.lines.map((line: any, index: number) => {
    const requestedId = String(input.lines[index]?.lineId || "").trim();
    if (requestedId && !existingById.has(requestedId) && !requestedId.startsWith(`${input.id}-EDIT-`)) {
      throw new Error(`Invalid draft line reference: ${requestedId}`);
    }
    const lineId = activeLineId(input.id, requestedId);
    if (desiredIds.has(lineId)) throw new Error(`Duplicate draft line: ${lineId}`);
    desiredIds.add(lineId);

    const netAmount = round2(Number(line.qty || 0) * Number(line.rate || 0));
    const gstAmount = round2(netAmount * input.gstRate);
    const item = itemById.get(String(line.itemId || ""));
    const existingLine = requestedId ? existingById.get(requestedId) : null;
    const base: Record<string, unknown> = {
      [config.lineIdField!]: lineId,
      [config.parentField!]: input.id,
      lineNo: index + 1,
      itemId: String(line.itemId || ""),
      description: String(line.itemName || line.description || ""),
      qty: Number(line.qty || 0),
      uom: String(line.uom || "Each"),
      rate: Number(line.rate || 0),
      netAmount,
      gstAmount,
      totalAmount: round2(netAmount + gstAmount),
    };
    if (input.type === "supplierBill") base.costAccountId = String(existingLine?.costAccountId || item?.costAccount || "ACC-5100");
    return base;
  });

  const toAppend: Record<string, unknown>[] = [];
  let updated = 0;
  for (const line of desired) {
    const lineId = String(line[config.lineIdField] || "");
    if (existingById.has(lineId)) {
      const patch = { ...line };
      delete patch[config.lineIdField];
      await updateRecord(config.lineTable, config.lineIdField, lineId, patch, `draft-${input.type}-edit`);
      updated += 1;
    } else {
      toAppend.push(line);
    }
  }
  if (toAppend.length) await batchAppend(config.lineTable, toAppend, `draft-${input.type}-edit`);

  let removed = 0;
  const stamp = Date.now();
  for (const line of existing) {
    const lineId = String(line[config.lineIdField] || "");
    if (!lineId || desiredIds.has(lineId)) continue;
    await updateRecord(
      config.lineTable,
      config.lineIdField,
      lineId,
      { [config.parentField]: `REMOVED:${input.id}:${stamp}`, lineNo: 0 },
      `draft-${input.type}-remove-line`,
    );
    removed += 1;
  }

  const netAmount = round2(desired.reduce((sum, line) => sum + Number(line.netAmount || 0), 0));
  const gstAmount = round2(desired.reduce((sum, line) => sum + Number(line.gstAmount || 0), 0));
  const totalAmount = round2(netAmount + gstAmount);
  const patch: Record<string, unknown> = {
    [config.partyField]: input.partyId,
    projectId: input.projectId,
    [config.dateField]: input.documentDate,
    netAmount,
    gstAmount,
    totalAmount,
  };
  if (input.type === "quote") patch.expiryDate = input.expiryDate;
  if (input.type === "supplierBill") {
    patch.dueDate = input.dueDate;
    patch.paidAmount = 0;
    patch.outstandingAmount = totalAmount;
  }
  await updateRecord(config.table, config.idField, input.id, patch, `draft-${input.type}-edit`);

  return { recordId: input.id, status: "DRAFT", totals: { netAmount, gstAmount, totalAmount }, changes: { updated, added: toAppend.length, removed } };
}

async function editPayment(raw: unknown) {
  const input = paymentSchema.parse(raw);
  const row = (await findRecords<any>("Payments", { paymentId: input.id }, 1)).rows[0];
  if (!row) throw new Error("Payment Entry not found");
  const partyType = String(row.partyType || "");
  await requirePermission(partyType === "Supplier" ? "purchase.write" : "sales.write");
  if (String(row.status || "DRAFT").toUpperCase() !== "DRAFT") throw new Error("Only DRAFT Payment Entries can be edited");
  if (String(row.journalId || "").trim()) throw new Error("Finalized Payment Entry cannot be edited");
  await assertParty(partyType === "Supplier" ? "supplierId" : "customerId", input.partyId);
  await assertProject(input.projectId);
  await updateRecord("Payments", "paymentId", input.id, {
    partyId: input.partyId,
    projectId: input.projectId,
    paymentDate: input.paymentDate,
    amount: input.amount,
    paymentMethod: input.paymentMethod,
    cashBankAccountId: input.cashBankAccountId,
    reference: input.reference,
  }, "draft-payment-edit");
  return { recordId: input.id, status: "DRAFT" };
}

async function editExpense(raw: unknown) {
  const input = expenseSchema.parse(raw);
  const row = (await findRecords<any>("Expenses", { expenseId: input.id }, 1)).rows[0];
  if (!row) throw new Error("Expense not found");
  await requirePermission("purchase.write");
  if (String(row.status || "DRAFT").toUpperCase() !== "DRAFT") throw new Error("Only DRAFT Expenses can be edited");
  if (String(row.journalId || "").trim()) throw new Error("Posted Expense cannot be edited");
  if (input.supplierId) await assertParty("supplierId", input.supplierId);
  await assertProject(input.projectId);
  const totalAmount = round2(input.netAmount + input.gstAmount);
  await updateRecord("Expenses", "expenseId", input.id, {
    supplierId: input.supplierId,
    projectId: input.projectId,
    expenseDate: input.expenseDate,
    expenseAccountId: input.expenseAccountId,
    description: input.description,
    netAmount: input.netAmount,
    gstAmount: input.gstAmount,
    totalAmount,
    paymentMethod: input.paymentMethod,
    cashBankAccountId: input.cashBankAccountId,
  }, "draft-expense-edit");
  return { recordId: input.id, status: "DRAFT", totalAmount };
}

export async function POST(request: Request) {
  try {
    const raw = await request.json();
    const type = documentTypeSchema.parse(raw?.type);
    const result = type === "payment"
      ? await editPayment(raw)
      : type === "expense"
        ? await editExpense(raw)
        : await editCommercial(raw);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((entry) => `${entry.path.join(".")}: ${entry.message}`).join("; ")
      : error instanceof Error ? error.message : "Draft document save failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}
