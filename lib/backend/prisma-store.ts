import { prisma } from "@/src/lib/prisma";
import { documentSeriesId } from "@/lib/accounting/document-numbering";
import { runAtomicAccounting } from "@/lib/accounting/atomic-posting";
import { insertPaymentSchedule, listPaymentSchedules, updatePaymentSchedule } from "@/lib/accounting/payment-schedule-store";
import { normalizeCurrency, roundCurrency } from "@/lib/accounting/currency";

export function generatedCode(prefix: string) {
  return documentSeriesId(prefix);
}

async function draftCurrencyValues(record: Record<string, unknown>, fallbackCurrency = "PGK") {
  const [baseSetting, legacyBaseSetting] = await Promise.all([
    prisma.globalSettings.findUnique({ where: { key: "currency" } }),
    prisma.globalSettings.findUnique({ where: { key: "base_currency" } }),
  ]);
  const baseCurrency = normalizeCurrency(baseSetting?.value || legacyBaseSetting?.value || "PGK");
  const currency = normalizeCurrency(record.currency || fallbackCurrency || baseCurrency);
  const explicitRate = Number(record.exchangeRate || 0);
  const exchangeRate = currency === baseCurrency ? 1 : explicitRate > 0 ? explicitRate : null;
  const base = (value: unknown) => {
    const amount = Number(value || 0);
    if (currency === baseCurrency) return roundCurrency(amount);
    return exchangeRate ? roundCurrency(amount * exchangeRate) : 0;
  };
  return { currency, baseCurrency, exchangeRate, base };
}

// ---------------------------------------------------------------------------
// Row Mappers: Prisma Model -> Standard Table Format
// ---------------------------------------------------------------------------

function mapCustomer(c: any) {
  if (!c) return null;
  return {
    customerId: c.code || c.id,
    internalCustomerId: c.id,
    customerCode: c.code,
    customerName: c.name,
    legalName: c.legalName || "",
    contactPerson: c.contacts?.[0]?.name || "",
    phone: c.phone || "",
    email: c.email || "",
    address: c.address || "",
    taxId: c.taxId || c.tin || "",
    creditTermsDays: c.paymentTerms || 30,
    creditLimit: Number(c.creditLimit || 0),
    currency: c.currency || "PGK",
    active: c.isActive !== false,
    createdAt: c.createdAt?.toISOString?.() || String(c.createdAt || ""),
    updatedAt: c.updatedAt?.toISOString?.() || String(c.updatedAt || ""),
  };
}

function mapSupplier(s: any) {
  if (!s) return null;
  return {
    supplierId: s.code || s.id,
    internalSupplierId: s.id,
    supplierCode: s.code,
    supplierName: s.name,
    legalName: s.legalName || "",
    contactPerson: s.contacts?.[0]?.name || "",
    phone: s.phone || "",
    email: s.email || "",
    address: s.address || "",
    taxId: s.taxId || s.tin || "",
    paymentTermsDays: s.paymentTerms || 30,
    currency: s.currency || "PGK",
    active: s.isActive !== false,
    createdAt: s.createdAt?.toISOString?.() || String(s.createdAt || ""),
    updatedAt: s.updatedAt?.toISOString?.() || String(s.updatedAt || ""),
  };
}

function mapProject(p: any) {
  if (!p) return null;
  return {
    projectId: p.code || p.id,
    internalProjectId: p.id,
    projectCode: p.code,
    projectName: p.name,
    description: p.description || "",
    customerId: p.customer?.code || p.customerId || "",
    supplierId: p.supplier?.code || p.supplierId || "",
    startDate: p.startDate?.toISOString?.().slice(0, 10) || (p.startDate ? String(p.startDate) : ""),
    endDate: p.endDate?.toISOString?.().slice(0, 10) || (p.endDate ? String(p.endDate) : ""),
    status: p.status || "OPEN",
    contractTotal: Number(p.budget || 0),
    budget: Number(p.budget || 0),
    contractNet: Number(p.budget || 0),
    gstAmount: 0,
    expectedCost: 0,
    projectManager: p.managerId || "",
    createdAt: p.createdAt?.toISOString?.() || String(p.createdAt || ""),
    updatedAt: p.updatedAt?.toISOString?.() || String(p.updatedAt || ""),
  };
}

function mapItem(i: any) {
  if (!i) return null;
  const rawType = String(i.type || "GOOD").toUpperCase();
  const itemType = rawType === "GOOD" ? "STOCK" : rawType === "NON_INVENTORY" ? "NON_STOCK" : rawType;
  return {
    itemId: i.id,
    itemCode: i.code,
    itemName: i.name,
    description: i.description || i.name || "",
    category: i.category || "",
    itemType,
    unit: i.unit || "Each",
    uom: i.unit || "Each",
    defaultRate: Number(i.sellPrice || 0),
    rate: Number(i.sellPrice || 0),
    sellPrice: Number(i.sellPrice || 0),
    purchasePrice: Number(i.purchasePrice || 0),
    costAccount: i.costAccount || "",
    revenueAccount: i.revenueAccount || "",
    taxCode: i.taxCode || "GST",
    active: i.isActive !== false,
    deferredRevenueMonths: 0,
    createdAt: i.createdAt?.toISOString?.() || String(i.createdAt || ""),
  };
}

function mapPurchaseOrder(po: any) {
  if (!po) return null;
  const rawStatus = String(po.status || "DRAFT").toUpperCase();
  const status = rawStatus === "SENT" ? "APPROVED" : rawStatus === "PARTIAL_RECEIVED" ? "PART_RECEIVED" : rawStatus === "CANCELLED" ? "CANCELLED" : rawStatus;
  return {
    poId: po.id,
    poNumber: po.code,
    supplierId: po.supplier?.code || po.supplierId || "",
    internalSupplierId: po.supplierId || "",
    supplierName: po.supplier?.name || "",
    projectId: po.project?.code || po.projectId || "",
    internalProjectId: po.projectId || "",
    projectName: po.project?.name || "",
    poDate: po.orderDate?.toISOString?.().slice(0, 10) || String(po.orderDate || "").slice(0, 10),
    expectedDate: po.expectedDate?.toISOString?.().slice(0, 10) || "",
    currency: po.currency || "PGK",
    exchangeRate: Number(po.exchangeRate || (po.currency === "PGK" ? 1 : 0)),
    baseNetAmount: Number(po.baseSubtotal || 0),
    baseGstAmount: Number(po.baseTaxTotal || 0),
    baseTotalAmount: Number(po.baseTotal || 0),
    netAmount: Number(po.subtotal || 0),
    gstAmount: Number(po.taxTotal || 0),
    totalAmount: Number(po.total || 0),
    status,
    sourceDocumentId: po.sourceDocId || "",
    notes: po.notes || "",
    createdAt: po.createdAt?.toISOString?.() || String(po.createdAt || ""),
    updatedAt: po.updatedAt?.toISOString?.() || String(po.updatedAt || ""),
  };
}

function mapPOLine(l: any) {
  if (!l) return null;
  const net = Number(l.amount || (Number(l.quantity || 0) * Number(l.unitPrice || 0)));
  const tax = Number(l.taxAmount || 0);
  return {
    poLineId: l.id,
    poId: l.orderId,
    lineNo: l.lineNo || 1,
    itemId: l.itemId || "",
    itemCode: l.itemId || "",
    itemName: l.description || "",
    description: l.description || "",
    qty: Number(l.quantity || 1),
    quantity: Number(l.quantity || 1),
    uom: l.unit || "Each",
    unit: l.unit || "Each",
    rate: Number(l.unitPrice || 0),
    unitPrice: Number(l.unitPrice || 0),
    netAmount: net,
    amount: net,
    gstAmount: tax,
    taxAmount: tax,
    totalAmount: net + tax,
  };
}

function mapQuote(q: any) {
  if (!q) return null;
  const rawStatus = String(q.status || "DRAFT").toUpperCase();
  const status = (rawStatus === "ACCEPTED" || rawStatus === "SENT") ? "APPROVED" : rawStatus;
  return {
    quoteId: q.id,
    quoteNumber: q.code,
    customerId: q.customer?.code || q.customerId || "",
    internalCustomerId: q.customerId || "",
    customerName: q.customer?.name || "",
    projectId: q.project?.code || q.projectId || "",
    internalProjectId: q.projectId || "",
    projectName: q.project?.name || "",
    quoteDate: q.issuedDate?.toISOString?.().slice(0, 10) || String(q.issuedDate || "").slice(0, 10),
    expiryDate: q.validUntil?.toISOString?.().slice(0, 10) || "",
    currency: q.currency || "PGK",
    exchangeRate: Number(q.exchangeRate || (q.currency === "PGK" ? 1 : 0)),
    baseNetAmount: Number(q.baseSubtotal || 0),
    baseGstAmount: Number(q.baseTaxTotal || 0),
    baseTotalAmount: Number(q.baseTotal || 0),
    netAmount: Number(q.subtotal || 0),
    gstAmount: Number(q.taxTotal || 0),
    totalAmount: Number(q.total || 0),
    status,
    sourceDocumentId: q.sourceDocId || "",
    notes: q.notes || "",
    createdAt: q.createdAt?.toISOString?.() || String(q.createdAt || ""),
  };
}

function mapQuoteLine(l: any) {
  if (!l) return null;
  const net = Number(l.amount || (Number(l.quantity || 0) * Number(l.unitPrice || 0)));
  const tax = Number(l.taxAmount || 0);
  return {
    quoteLineId: l.id,
    quoteId: l.quoteId,
    lineNo: l.lineNo || 1,
    itemId: l.itemId || "",
    itemCode: l.itemId || "",
    itemName: l.description || "",
    description: l.description || "",
    qty: Number(l.quantity || 1),
    quantity: Number(l.quantity || 1),
    uom: l.unit || "Each",
    unit: l.unit || "Each",
    rate: Number(l.unitPrice || 0),
    unitPrice: Number(l.unitPrice || 0),
    netAmount: net,
    amount: net,
    gstAmount: tax,
    taxAmount: tax,
    totalAmount: net + tax,
  };
}

function mapInvoice(inv: any) {
  if (!inv) return null;
  const rawStatus = String(inv.status || "DRAFT").toUpperCase();
  const status = rawStatus === "SENT" ? "POSTED" : rawStatus;
  return {
    invoiceId: inv.id,
    invoiceNumber: inv.code,
    customerId: inv.customer?.code || inv.customerId || "",
    internalCustomerId: inv.customerId || "",
    customerName: inv.customer?.name || "",
    projectId: inv.project?.code || inv.projectId || "",
    internalProjectId: inv.projectId || "",
    projectName: inv.project?.name || "",
    invoiceDate: inv.issuedDate?.toISOString?.().slice(0, 10) || String(inv.issuedDate || "").slice(0, 10),
    dueDate: inv.dueDate?.toISOString?.().slice(0, 10) || "",
    currency: inv.currency || "PGK",
    exchangeRate: Number(inv.exchangeRate || (inv.currency === "PGK" ? 1 : 0)),
    baseNetAmount: Number(inv.baseSubtotal || 0),
    baseGstAmount: Number(inv.baseTaxTotal || 0),
    baseTotalAmount: Number(inv.baseTotal || 0),
    basePaidAmount: Number(inv.baseAmountPaid || 0),
    baseOutstandingAmount: Number(inv.baseOutstanding || 0),
    netAmount: Number(inv.subtotal || 0),
    gstAmount: Number(inv.taxTotal || 0),
    totalAmount: Number(inv.total || 0),
    paidAmount: Number(inv.total || 0) - Number(inv.outstanding || 0),
    outstandingAmount: Number(inv.outstanding ?? inv.total ?? 0),
    status,
    sourceDocumentId: inv.sourceDocId || "",
    journalId: inv.journalId || "",
    createdAt: inv.createdAt?.toISOString?.() || String(inv.createdAt || ""),
  };
}

function mapInvoiceLine(l: any) {
  if (!l) return null;
  const net = Number(l.amount || (Number(l.quantity || 0) * Number(l.unitPrice || 0)));
  const tax = Number(l.taxAmount || 0);
  return {
    invoiceLineId: l.id,
    invoiceId: l.invoiceId,
    lineNo: l.lineNo || 1,
    itemId: l.itemId || "",
    description: l.description || "",
    qty: Number(l.quantity || 1),
    rate: Number(l.unitPrice || 0),
    netAmount: net,
    gstAmount: tax,
    totalAmount: net + tax,
    revenueAccountId: l.revenueAccount || "ACC-4100",
  };
}

function mapSupplierBill(b: any) {
  if (!b) return null;
  const rawStatus = String(b.status || "DRAFT").toUpperCase();
  const status = rawStatus === "SENT" ? "POSTED" : rawStatus;
  const sourcePoId = b.orderId || b.sourceDocId || b.poReference || "";
  return {
    billId: b.id,
    billNumber: b.code,
    supplierId: b.supplier?.code || b.supplierId || "",
    internalSupplierId: b.supplierId || "",
    supplierName: b.supplier?.name || "",
    projectId: b.project?.code || b.projectId || "",
    internalProjectId: b.projectId || "",
    projectName: b.project?.name || "",
    billDate: b.billDate?.toISOString?.().slice(0, 10) || String(b.billDate || "").slice(0, 10),
    dueDate: b.dueDate?.toISOString?.().slice(0, 10) || "",
    currency: b.currency || "PGK",
    exchangeRate: Number(b.exchangeRate || (b.currency === "PGK" ? 1 : 0)),
    baseNetAmount: Number(b.baseSubtotal || 0),
    baseGstAmount: Number(b.baseTaxTotal || 0),
    baseTotalAmount: Number(b.baseTotal || 0),
    basePaidAmount: Number(b.baseAmountPaid || 0),
    baseOutstandingAmount: Number(b.baseOutstanding || 0),
    netAmount: Number(b.subtotal || 0),
    gstAmount: Number(b.taxTotal || 0),
    totalAmount: Number(b.total || 0),
    paidAmount: Number(b.amountPaid || 0),
    outstandingAmount: Number(b.outstanding ?? b.total ?? 0),
    status,
    orderId: b.orderId || "",
    poId: sourcePoId,
    sourceDocumentId: b.sourceDocId || b.poReference || b.orderId || "",
    journalId: b.journalId || "",
    createdAt: b.createdAt?.toISOString?.() || String(b.createdAt || ""),
  };
}

function mapBillLine(l: any) {
  if (!l) return null;
  const net = Number(l.amount || (Number(l.quantity || 0) * Number(l.unitPrice || 0)));
  const tax = Number(l.taxAmount || 0);
  return {
    billLineId: l.id,
    billId: l.billId,
    lineNo: l.lineNo || 1,
    itemId: l.itemId || "",
    description: l.description || "",
    qty: Number(l.quantity || 1),
    rate: Number(l.unitPrice || 0),
    netAmount: net,
    gstAmount: tax,
    totalAmount: net + tax,
    costAccountId: l.costAccount || "ACC-5100",
  };
}

function mapPayment(pay: any) {
  if (!pay) return null;
  const rawStatus = String(pay.status || "PENDING").toUpperCase();
  const status = rawStatus === "PENDING"
    ? "DRAFT"
    : rawStatus === "AUTHORIZED"
      ? "APPROVED"
      : rawStatus === "CAPTURED" || rawStatus === "CLEARED"
        ? "POSTED"
        : rawStatus;
  const allocations = Array.isArray(pay.allocations)
    ? pay.allocations.filter((row: any) => String(row.status || "").toUpperCase() === "POSTED")
    : [];
  const directAllocations = allocations.filter((row: any) => String(row.allocationType || "") === "DIRECT");
  const direct = directAllocations.length === 1 ? directAllocations[0] : null;
  const allocatedAmount = allocations.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
  const draftInvoiceId = rawStatus === "PENDING" || rawStatus === "AUTHORIZED" ? pay.invoiceId : null;
  const draftBillId = rawStatus === "PENDING" || rawStatus === "AUTHORIZED" ? pay.billId : null;
  const againstInvoiceId = direct?.invoiceId || draftInvoiceId || "";
  const againstBillId = direct?.billId || draftBillId || "";

  return {
    paymentId: pay.id,
    paymentNumber: pay.code,
    partyType: pay.customerId ? "Customer" : "Supplier",
    partyId: pay.customer?.code || pay.supplier?.code || pay.customerId || pay.supplierId || "",
    internalPartyId: pay.customerId || pay.supplierId || "",
    partyName: pay.customer?.name || pay.supplier?.name || "",
    projectId: pay.project?.code || pay.projectId || "",
    internalProjectId: pay.projectId || "",
    projectName: pay.project?.name || "",
    paymentType: pay.type?.includes?.("RECEIPT") ? "RECEIVE" : "PAY",
    paymentDate: pay.date?.toISOString?.().slice(0, 10) || String(pay.date || "").slice(0, 10),
    currency: pay.currency || "PGK",
    exchangeRate: Number(pay.exchangeRate || (pay.currency === "PGK" ? 1 : 0)),
    baseAmount: Number(pay.baseAmount || 0),
    amount: Number(pay.amount || 0),
    paymentMethod: pay.paymentMethod || "Cash",
    cashBankAccountId: pay.depositAccount || "ACC-1110",
    reference: pay.referenceNumber || "",
    againstDocumentType: againstInvoiceId ? "Sales Invoice" : againstBillId ? "Supplier Invoice" : "",
    againstDocumentId: againstInvoiceId || againstBillId || "",
    sourceDocumentId: pay.sourceDocId || "",
    status,
    journalId: pay.journalId || "",
    allocationCount: allocations.length,
    allocatedAmount,
    baseAllocatedAmount: allocations.reduce((sum: number, row: any) => sum + Number(row.baseAmount || 0), 0),
    unallocatedAmount: Math.max(0, Number(pay.amount || 0) - allocatedAmount),
    createdAt: pay.createdAt?.toISOString?.() || String(pay.createdAt || ""),
  };
}

function mapExpense(exp: any) {
  if (!exp) return null;
  const categoryLooksLikeAccount = /^ACC-/i.test(String(exp.category || "").trim());
  const cancelled = String(exp.approvedBy || "") === "__CANCELLED__";
  const status = exp.glPosted
    ? "POSTED"
    : cancelled
      ? "CANCELLED"
      : exp.approvedAt
        ? "APPROVED"
        : "DRAFT";
  return {
    expenseId: exp.id,
    expenseNumber: exp.code,
    expenseDate: exp.date?.toISOString?.().slice(0, 10) || String(exp.date || "").slice(0, 10),
    supplierId: exp.supplier?.code || exp.supplierId || "",
    internalSupplierId: exp.supplierId || "",
    projectId: exp.project?.code || exp.projectId || "",
    internalProjectId: exp.projectId || "",
    expenseAccountId: categoryLooksLikeAccount ? exp.category : (exp.referenceAccount || "ACC-6600"),
    description: exp.description || "",
    netAmount: Number(exp.amount || 0),
    gstAmount: Number(exp.taxAmount || 0),
    totalAmount: Number(exp.total || 0),
    paymentMethod: exp.paymentMethod || "Cash",
    cashBankAccountId: categoryLooksLikeAccount ? (exp.referenceAccount || "ACC-1110") : "ACC-1110",
    status,
    journalId: exp.journalId || "",
    approvedBy: cancelled ? "" : (exp.approvedBy || ""),
    approvedAt: exp.approvedAt?.toISOString?.() || "",
    createdAt: exp.createdAt?.toISOString?.() || String(exp.createdAt || ""),
  };
}

function mapStockMovement(movement: any) {
  if (!movement) return null;
  const movementType = movement.type || movement.referenceType || "";
  const type = String(movement.type || movementType || "").toUpperCase();
  const incoming = ["PURCHASE_IN", "PURCHASE_RECEIPT", "SALES_ISSUE_ROLLBACK", "ADJUSTMENT_IN", "RETURN_IN", "TRANSFER_IN"].includes(type);
  const outgoing = ["SALES_DELIVERY", "SALES_ISSUE", "SALE_OUT", "PROJECT_ISSUE", "ADJUSTMENT_OUT", "RETURN_OUT", "TRANSFER_OUT"].includes(type);
  return {
    movementId: movement.id,
    movementDate: movement.createdAt?.toISOString?.().slice(0, 10) || String(movement.createdAt || "").slice(0, 10),
    itemId: movement.itemId || "",
    projectId: movement.projectId || "",
    warehouseId: movement.warehouseId || "",
    warehouseCode: movement.warehouse?.code || "",
    warehouseName: movement.warehouse?.name || "",
    transferId: movement.transferId || "",
    movementType,
    referenceType: movement.referenceType || "",
    qtyIn: incoming ? Number(movement.quantity || 0) : 0,
    qtyOut: outgoing ? Number(movement.quantity || 0) : 0,
    unitCost: Number(movement.unitCost || 0),
    value: ["LANDED_COST", "REVALUATION", "NRV_WRITEDOWN"].includes(type)
      ? Math.abs(Number(movement.totalCost || 0))
      : Number(movement.totalCost || 0),
    valueAdjustment: ["LANDED_COST", "REVALUATION", "NRV_WRITEDOWN"].includes(type)
      ? Number(movement.totalCost || 0)
      : 0,
    sourceDocumentId: movement.referenceId || "",
    journalId: movement.journalId || "",
    note: movement.note || "",
    createdAt: movement.createdAt?.toISOString?.() || String(movement.createdAt || ""),
  };
}

function mapFixedAsset(asset: any) {
  if (!asset) return null;
  return {
    assetId: asset.assetId,
    assetName: asset.assetName,
    assetCategory: asset.assetCategory,
    purchaseDate: asset.purchaseDate?.toISOString?.().slice(0, 10) || String(asset.purchaseDate || "").slice(0, 10),
    supplierId: asset.supplierId || "",
    cost: Number(asset.cost || 0),
    serialNumber: asset.serialNumber || "",
    location: asset.location || "",
    assignedTo: asset.assignedTo || "",
    usefulLifeMonths: Number(asset.usefulLifeMonths || 36),
    accumulatedDepreciation: Number(asset.accumulatedDepreciation || 0),
    netBookValue: Number(asset.netBookValue || 0),
    status: asset.status || "ACTIVE",
    sourceDocumentId: asset.sourceDocumentId || "",
    acquisitionJournalId: asset.acquisitionJournalId || "",
    depreciationJournalId: asset.depreciationJournalId || "",
    journalId: asset.depreciationJournalId || asset.acquisitionJournalId || "",
    createdAt: asset.createdAt?.toISOString?.() || String(asset.createdAt || ""),
    updatedAt: asset.updatedAt?.toISOString?.() || String(asset.updatedAt || ""),
  };
}

function mapSetting(s: any) {
  if (!s) return null;
  return {
    key: s.key,
    value: s.value || "",
    updatedAt: s.updatedAt?.toISOString?.() || String(s.updatedAt || ""),
  };
}

function accountReference(code: unknown) {
  return `ACC-${String(code || "").trim()}`;
}

function accountTypeLabel(type: unknown) {
  return String(type || "")
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function mapAccount(acc: any, accountsById = new Map<string, any>()) {
  if (!acc) return null;
  const parent = acc.parentId ? accountsById.get(acc.parentId) : null;
  return {
    accountId: accountReference(acc.code),
    accountCode: acc.code,
    accountName: acc.name,
    accountType: accountTypeLabel(acc.type),
    parentId: parent ? accountReference(parent.code) : null,
    parentAccount: parent ? accountReference(parent.code) : "",
    normalBalance: acc.normalBalance || "DEBIT",
    currency: acc.currency || "PGK",
    description: acc.description || "",
    active: acc.isActive !== false,
  };
}

// ---------------------------------------------------------------------------
// Main Query & Mutation Operations
// ---------------------------------------------------------------------------

export async function prismaListTable<T = any>(table: string, limit = 500, offset = 0): Promise<T[]> {
  switch (table) {
    case "Customers": {
      const rows = await prisma.customer.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
        include: { contacts: { take: 1, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } },
      });
      return rows.map(mapCustomer).filter(Boolean) as T[];
    }
    case "Suppliers": {
      const rows = await prisma.supplier.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
        include: { contacts: { take: 1, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } },
      });
      return rows.map(mapSupplier).filter(Boolean) as T[];
    }
    case "Projects": {
      const rows = await prisma.project.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
        include: { customer: true, supplier: true },
      });
      return rows.map(mapProject).filter(Boolean) as T[];
    }
    case "Items": {
      const rows = await prisma.item.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
      });
      return rows.map(mapItem).filter(Boolean) as T[];
    }
    case "PurchaseOrders": {
      const rows = await prisma.purchaseOrder.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
        include: { supplier: true, project: true },
      });
      return rows.map(mapPurchaseOrder).filter(Boolean) as T[];
    }
    case "POLines": {
      const rows = await prisma.pOLine.findMany({
        take: limit,
        skip: offset,
        orderBy: { lineNo: "asc" },
      });
      return rows.map(mapPOLine).filter(Boolean) as T[];
    }
    case "Quotes": {
      const rows = await prisma.quote.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
        include: { customer: true, project: true },
      });
      return rows.map(mapQuote).filter(Boolean) as T[];
    }
    case "QuoteLines": {
      const rows = await prisma.quoteLine.findMany({
        take: limit,
        skip: offset,
        orderBy: { lineNo: "asc" },
      });
      return rows.map(mapQuoteLine).filter(Boolean) as T[];
    }
    case "Invoices": {
      const rows = await prisma.invoice.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
        include: { customer: true, project: true },
      });
      return rows.map(mapInvoice).filter(Boolean) as T[];
    }
    case "InvoiceLines": {
      const rows = await prisma.invoiceLine.findMany({
        take: limit,
        skip: offset,
        orderBy: { lineNo: "asc" },
      });
      return rows.map(mapInvoiceLine).filter(Boolean) as T[];
    }
    case "SupplierBills": {
      const rows = await prisma.supplierBill.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
        include: { supplier: true, project: true },
      });
      return rows.map(mapSupplierBill).filter(Boolean) as T[];
    }
    case "SupplierBillLines": {
      const rows = await prisma.billLine.findMany({
        take: limit,
        skip: offset,
        orderBy: { lineNo: "asc" },
      });
      return rows.map(mapBillLine).filter(Boolean) as T[];
    }
    case "Payments": {
      const rows = await prisma.payment.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
        include: { customer: true, supplier: true, project: true, allocations: { where: { status: "POSTED" } } },
      });
      return rows.map(mapPayment).filter(Boolean) as T[];
    }
    case "Expenses": {
      const rows = await prisma.expense.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
        include: { supplier: true, project: true },
      });
      return rows.map(mapExpense).filter(Boolean) as T[];
    }
    case "PaymentSchedules": {
      return await listPaymentSchedules(limit, offset) as T[];
    }
    case "StockMovements": {
      const rows = await prisma.stockMovement.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
        include: { warehouse: true },
      });
      return rows.map(mapStockMovement).filter(Boolean) as T[];
    }
    case "FixedAssets": {
      const rows = await prisma.fixedAsset.findMany({
        take: limit,
        skip: offset,
        orderBy: { assetId: "asc" },
      });
      return rows.map(mapFixedAsset).filter(Boolean) as T[];
    }
    case "Settings": {
      const rows = await prisma.globalSettings.findMany({
        take: limit,
        skip: offset,
      });
      return rows.map(mapSetting).filter(Boolean) as T[];
    }
    case "Accounts": {
      const rows = await prisma.chartOfAccounts.findMany({
        take: limit,
        skip: offset,
        orderBy: { code: "asc" },
      });
      const accountsById = new Map(rows.map((account) => [account.id, account]));
      return rows.map((account) => mapAccount(account, accountsById)).filter(Boolean) as T[];
    }
    case "JournalHeaders": {
      const rows = await prisma.journalHeader.findMany({
        take: limit,
        skip: offset,
        orderBy: { date: "desc" },
        include: { lines: { take: 1, orderBy: { lineNo: "asc" } } },
      });
      return rows.map(mapJournalHeader).filter(Boolean) as T[];
    }
    case "JournalLines": {
      const rows = await prisma.journalLine.findMany({
        take: limit,
        skip: offset,
        orderBy: [{ journal: { date: "desc" } }, { lineNo: "asc" }],
        include: { journal: true, account: true },
      });
      return rows.map(mapJournalLine).filter(Boolean) as T[];
    }
    default:
      return [];
  }
}

type LocalJournalBundle = {
  header: Record<string, unknown>;
  lines: Array<Record<string, unknown>>;
  actor?: string;
};

/** Persist a validated journal atomically when the local Prisma backend is active. */
export async function prismaPostJournal(input: LocalJournalBundle) {
  const journalCode = String(input.header.journalId || "").trim();
  if (!journalCode) throw new Error("Journal ID is required");
  if (!input.lines.length) throw new Error("A journal requires at least one line");

  const existing = await prisma.journalHeader.findUnique({
    where: { code: journalCode },
    include: { lines: { include: { account: true }, orderBy: { lineNo: "asc" } } },
  });
  if (existing) {
    return {
      journalId: existing.code,
      header: mapJournalHeader(existing),
      lines: existing.lines.map(mapJournalLine),
    };
  }

  const posted = await runAtomicAccounting(async ({ postJournal }) => postJournal({
    journalId: journalCode,
    postingDate: String(input.header.postingDate || ""),
    documentType: String(input.header.documentType || "JOURNAL"),
    documentId: String(input.header.documentId || journalCode),
    documentNumber: String(input.header.documentNumber || journalCode),
    reference: String(input.header.reference || ""),
    projectId: String(input.header.projectId || ""),
    currency: String(input.header.currency || input.header.baseCurrency || "PGK"),
    baseCurrency: String(input.header.baseCurrency || "PGK"),
    exchangeRate: input.header.exchangeRate !== undefined ? Number(input.header.exchangeRate || 0) : undefined,
    createdBy: String(input.header.createdBy || input.actor || "finance-ui"),
    approvedBy: String(input.header.approvedBy || "") || undefined,
    lines: input.lines.map((line) => ({
      accountId: String(line.accountId || ""),
      debit: Number(line.debit || 0),
      credit: Number(line.credit || 0),
      customerId: String(line.customerId || "") || undefined,
      supplierId: String(line.supplierId || "") || undefined,
      projectId: String(line.projectId || input.header.projectId || "") || undefined,
      taxCode: String(line.taxCode || "") || undefined,
      costCenter: String(line.costCenter || "") || undefined,
      transactionCurrency: String(line.transactionCurrency || input.header.currency || input.header.baseCurrency || "PGK"),
      exchangeRate: line.exchangeRate !== undefined ? Number(line.exchangeRate || 0) : undefined,
      transactionDebit: line.transactionDebit !== undefined ? Number(line.transactionDebit || 0) : undefined,
      transactionCredit: line.transactionCredit !== undefined ? Number(line.transactionCredit || 0) : undefined,
      description: String(line.description || input.header.reference || input.header.documentNumber || "Journal entry"),
    })),
  }));

  const created = await prisma.journalHeader.findUnique({
    where: { id: posted.id },
    include: { lines: { include: { account: true }, orderBy: { lineNo: "asc" } } },
  });
  if (!created) throw new Error("Atomic journal commit could not be reloaded");

  return {
    journalId: created.code,
    header: mapJournalHeader(created),
    lines: created.lines.map(mapJournalLine),
  };
}

export async function prismaFindRecords<T = any>(
  table: string,
  filters: Record<string, unknown>,
  limit = 100
): Promise<T[]> {
  const filterEntries = Object.entries(filters).filter(([_, v]) => v !== undefined && v !== null);
  const matched: T[] = [];
  const pageSize = 500;
  let offset = 0;

  while (matched.length < limit) {
    const page = await prismaListTable<T>(table, pageSize, offset);
    if (!page.length) break;
    for (const row of page as any[]) {
      const isMatch = filterEntries.every(([key, val]) => {
        const rowVal = row[key];
        if (typeof val === "string" && typeof rowVal === "string") {
          return rowVal.toLowerCase() === val.toLowerCase();
        }
        return String(rowVal ?? "") === String(val ?? "");
      });
      if (isMatch) matched.push(row as T);
      if (matched.length >= limit) break;
    }
    if (page.length < pageSize) break;
    offset += page.length;
  }

  return matched;
}

function mapJournalHeader(journal: any) {
  if (!journal) return null;
  return {
    journalId: journal.code,
    postingDate: journal.date?.toISOString?.().slice(0, 10) || String(journal.date || "").slice(0, 10),
    documentType: journal.sourceDocType || "",
    documentId: journal.sourceDocId || "",
    documentNumber: journal.reference || "",
    reference: journal.description || "",
    projectId: journal.lines?.[0]?.projectId || "",
    status: journal.status,
    reversalOfJournalId: journal.reversalOfJournalId || "",
    currency: journal.currency || "PGK",
    baseCurrency: journal.baseCurrency || "PGK",
    exchangeRate: Number(journal.exchangeRate || 1),
    transactionTotalDebit: Number(journal.transactionTotalDebit || 0),
    transactionTotalCredit: Number(journal.transactionTotalCredit || 0),
    totalDebit: Number(journal.totalDebit || 0),
    totalCredit: Number(journal.totalCredit || 0),
    isBalanced: journal.isBalanced,
    createdBy: journal.createdBy,
    approvedBy: journal.approvedBy || "",
    createdAt: journal.createdAt?.toISOString?.() || String(journal.createdAt || ""),
    postedAt: journal.postedAt?.toISOString?.() || "",
  };
}

function mapJournalLine(line: any) {
  if (!line) return null;
  return {
    journalLineId: line.id,
    journalId: line.journal?.code || line.journalId,
    lineNo: line.lineNo,
    accountId: line.account ? accountReference(line.account.code) : line.accountId,
    customerId: line.customerId || "",
    supplierId: line.supplierId || "",
    projectId: line.projectId || "",
    debit: Number(line.debit || 0),
    credit: Number(line.credit || 0),
    currency: line.currency || "PGK",
    transactionCurrency: line.transactionCurrency || line.currency || "PGK",
    exchangeRate: Number(line.exchangeRate || 1),
    transactionDebit: Number(line.transactionDebit || 0),
    transactionCredit: Number(line.transactionCredit || 0),
    taxCode: line.taxCode || "",
    costCenter: line.costCenter || "",
    description: line.description || "",
    createdAt: line.createdAt?.toISOString?.() || String(line.createdAt || ""),
  };
}

export async function prismaAppendRecord<T = any>(
  table: string,
  record: Record<string, unknown>,
  actor = "web-app"
): Promise<T> {
  switch (table) {
    case "Customers": {
      const code = String(record.customerCode || record.customerId || generatedCode("CUS"));
      const created = await prisma.customer.create({
        data: {
          id: record.customerId ? String(record.customerId) : undefined,
          code,
          name: String(record.customerName || record.name || "Customer"),
          phone: record.phone ? String(record.phone) : null,
          email: record.email ? String(record.email) : null,
          address: record.address ? String(record.address) : null,
          taxId: record.taxId ? String(record.taxId) : null,
          paymentTerms: Number(record.creditTermsDays || 30),
          creditLimit: record.creditLimit ? Number(record.creditLimit) : null,
          currency: normalizeCurrency(record.currency || "PGK"),
          isActive: record.active !== false,
        },
      });
      return mapCustomer(created) as T;
    }

    case "Suppliers": {
      const code = String(record.supplierCode || record.supplierId || generatedCode("SUP"));
      const created = await prisma.supplier.create({
        data: {
          id: record.supplierId ? String(record.supplierId) : undefined,
          code,
          name: String(record.supplierName || record.name || "Supplier"),
          phone: record.phone ? String(record.phone) : null,
          email: record.email ? String(record.email) : null,
          address: record.address ? String(record.address) : null,
          taxId: record.taxId ? String(record.taxId) : null,
          paymentTerms: Number(record.paymentTermsDays || 30),
          currency: normalizeCurrency(record.currency || "PGK"),
          isActive: record.active !== false,
        },
      });
      return mapSupplier(created) as T;
    }

    case "Projects": {
      const code = String(record.projectCode || record.projectId || generatedCode("PJ"));
      const customerId = record.customerId ? String(record.customerId) : null;
      let matchedCustomerId: string | null = null;
      if (customerId) {
        const c = await prisma.customer.findFirst({
          where: { OR: [{ id: customerId }, { code: customerId }] },
        });
        matchedCustomerId = c ? c.id : null;
      }
      const created = await prisma.project.create({
        data: {
          id: record.projectId ? String(record.projectId) : undefined,
          code,
          name: String(record.projectName || record.name || "Project"),
          description: record.description ? String(record.description) : null,
          customerId: matchedCustomerId,
          startDate: record.startDate ? new Date(String(record.startDate)) : null,
          endDate: record.endDate ? new Date(String(record.endDate)) : null,
          budget: record.contractTotal ? Number(record.contractTotal) : record.budget ? Number(record.budget) : null,
          status: "ACTIVE",
        },
      });
      return mapProject(created) as T;
    }

    case "Items": {
      const code = String(record.itemCode || record.itemId || generatedCode("ITM"));
      const requestedType = String(record.itemType || "STOCK").toUpperCase();
      const itemType = requestedType === "STOCK" ? "GOOD" : requestedType === "NON_STOCK" ? "NON_INVENTORY" : requestedType;
      const created = await prisma.item.create({
        data: {
          id: record.itemId ? String(record.itemId) : undefined,
          code,
          name: String(record.itemName || record.name || "Item"),
          description: record.description ? String(record.description) : null,
          type: itemType as any,
          sellPrice: record.defaultRate ? Number(record.defaultRate) : record.rate ? Number(record.rate) : 0,
          revenueAccount: record.revenueAccount !== undefined ? String(record.revenueAccount).trim() : "",
          costAccount: record.costAccount !== undefined ? String(record.costAccount).trim() : "",
          unit: record.uom ? String(record.uom) : record.unit ? String(record.unit) : "Each",
          isActive: true,
        },
      });
      return mapItem(created) as T;
    }

    case "PurchaseOrders": {
      const code = String(record.poNumber || record.poId || generatedCode("PO"));
      // Resolve supplier
      const supInput = String(record.supplierId || "");
      let supplierId = supInput;
      if (supInput) {
        const sup = await prisma.supplier.findFirst({
          where: { OR: [{ id: supInput }, { code: supInput }] },
        });
        if (sup) supplierId = sup.id;
      }

      // Resolve project
      let projectId: string | null = null;
      if (record.projectId) {
        const p = await prisma.project.findFirst({
          where: { OR: [{ id: String(record.projectId) }, { code: String(record.projectId) }] },
        });
        if (p) projectId = p.id;
      }

      const fx = await draftCurrencyValues(record);
      const created = await prisma.purchaseOrder.create({
        data: {
          id: record.poId ? String(record.poId) : undefined,
          code,
          supplierId,
          projectId,
          orderDate: record.poDate ? new Date(String(record.poDate)) : new Date(),
          currency: fx.currency,
          exchangeRate: fx.exchangeRate,
          baseSubtotal: fx.base(record.netAmount),
          baseTaxTotal: fx.base(record.gstAmount),
          baseTotal: fx.base(record.totalAmount),
          subtotal: Number(record.netAmount || 0),
          taxTotal: Number(record.gstAmount || 0),
          total: Number(record.totalAmount || 0),
          status: (record.status ? String(record.status).toUpperCase() : "DRAFT") as any,
          sourceDocId: record.sourceDocumentId ? String(record.sourceDocumentId) : null,
          notes: record.notes ? String(record.notes) : null,
          createdBy: actor,
        },
      });
      return mapPurchaseOrder(created) as T;
    }

    case "POLines": {
      const orderId = String(record.poId || record.orderId || "");
      const created = await prisma.pOLine.create({
        data: {
          id: record.poLineId ? String(record.poLineId) : undefined,
          orderId,
          lineNo: Number(record.lineNo || 1),
          itemId: record.itemId ? String(record.itemId) : null,
          description: String(record.description || record.itemName || "Item"),
          quantity: Number(record.qty || record.quantity || 1),
          unit: String(record.uom || record.unit || "Each"),
          unitPrice: Number(record.rate || record.unitPrice || 0),
          amount: Number(record.netAmount || record.amount || 0),
          taxAmount: Number(record.gstAmount || record.taxAmount || 0),
        },
      });
      return mapPOLine(created) as T;
    }

    case "Quotes": {
      const code = String(record.quoteNumber || record.quoteId || generatedCode("QT"));
      const custInput = String(record.customerId || "");
      let customerId = custInput;
      if (custInput) {
        const c = await prisma.customer.findFirst({
          where: { OR: [{ id: custInput }, { code: custInput }] },
        });
        if (c) customerId = c.id;
      }

      let projectId: string | null = null;
      if (record.projectId) {
        const p = await prisma.project.findFirst({
          where: { OR: [{ id: String(record.projectId) }, { code: String(record.projectId) }] },
        });
        if (p) projectId = p.id;
      }

      const fx = await draftCurrencyValues(record);
      const requestedStatus = String(record.status || "DRAFT").trim().toUpperCase().replace(/[\s-]+/g, "_");
      const quoteStatus = requestedStatus === "APPROVED" ? "ACCEPTED" : requestedStatus;
      const created = await prisma.quote.create({
        data: {
          id: record.quoteId ? String(record.quoteId) : undefined,
          code,
          customerId,
          projectId,
          issuedDate: record.quoteDate ? new Date(String(record.quoteDate)) : new Date(),
          validUntil: record.expiryDate ? new Date(String(record.expiryDate)) : null,
          currency: fx.currency,
          exchangeRate: fx.exchangeRate,
          baseSubtotal: fx.base(record.netAmount),
          baseTaxTotal: fx.base(record.gstAmount),
          baseTotal: fx.base(record.totalAmount),
          subtotal: Number(record.netAmount || 0),
          taxTotal: Number(record.gstAmount || 0),
          total: Number(record.totalAmount || 0),
          status: quoteStatus as any,
          sourceDocId: record.sourceDocumentId ? String(record.sourceDocumentId) : null,
          createdBy: actor,
        },
        include: { customer: true, project: true },
      });
      return mapQuote(created) as T;
    }

    case "QuoteLines": {
      const quoteId = String(record.quoteId || "");
      const created = await prisma.quoteLine.create({
        data: {
          id: record.quoteLineId ? String(record.quoteLineId) : undefined,
          quoteId,
          lineNo: Number(record.lineNo || 1),
          itemId: record.itemId ? String(record.itemId) : null,
          description: String(record.description || record.itemName || "Item"),
          quantity: Number(record.qty || record.quantity || 1),
          unit: String(record.uom || record.unit || "Each"),
          unitPrice: Number(record.rate || record.unitPrice || 0),
          amount: Number(record.netAmount || record.amount || 0),
          taxAmount: Number(record.gstAmount || record.taxAmount || 0),
        },
      });
      return mapQuoteLine(created) as T;
    }

    case "Invoices": {
      const code = String(record.invoiceNumber || record.invoiceId || generatedCode("INV"));
      const custInput = String(record.customerId || "");
      let customerId = custInput;
      if (custInput) {
        const c = await prisma.customer.findFirst({
          where: { OR: [{ id: custInput }, { code: custInput }] },
        });
        if (c) customerId = c.id;
      }

      let projectId: string | null = null;
      if (record.projectId) {
        const p = await prisma.project.findFirst({
          where: { OR: [{ id: String(record.projectId) }, { code: String(record.projectId) }] },
        });
        if (p) projectId = p.id;
      }

      const total = Number(record.totalAmount || 0);
      const fx = await draftCurrencyValues(record);
      const created = await prisma.invoice.create({
        data: {
          id: record.invoiceId ? String(record.invoiceId) : undefined,
          code,
          customerId,
          projectId,
          issuedDate: record.invoiceDate ? new Date(String(record.invoiceDate)) : new Date(),
          dueDate: record.dueDate ? new Date(String(record.dueDate)) : null,
          currency: fx.currency,
          exchangeRate: fx.exchangeRate,
          baseSubtotal: fx.base(record.netAmount),
          baseTaxTotal: fx.base(record.gstAmount),
          baseTotal: fx.base(total),
          baseOutstanding: fx.base(total),
          subtotal: Number(record.netAmount || 0),
          taxTotal: Number(record.gstAmount || 0),
          total,
          outstanding: total,
          status: "DRAFT",
          sourceDocId: record.sourceDocumentId ? String(record.sourceDocumentId) : null,
          journalId: record.journalId ? String(record.journalId) : null,
          createdBy: actor,
        },
        include: { customer: true, project: true },
      });
      return mapInvoice(created) as T;
    }

    case "InvoiceLines": {
      const invoiceId = String(record.invoiceId || "");
      const created = await prisma.invoiceLine.create({
        data: {
          id: record.invoiceLineId ? String(record.invoiceLineId) : undefined,
          invoiceId,
          lineNo: Number(record.lineNo || 1),
          itemId: record.itemId ? String(record.itemId) : null,
          description: String(record.description || record.itemName || "Item"),
          quantity: Number(record.qty || record.quantity || 1),
          unitPrice: Number(record.rate || record.unitPrice || 0),
          amount: Number(record.netAmount || record.amount || 0),
          taxAmount: Number(record.gstAmount || record.taxAmount || 0),
          revenueAccount: record.revenueAccountId ? String(record.revenueAccountId) : "ACC-4100",
        },
      });
      return mapInvoiceLine(created) as T;
    }

    case "SupplierBills": {
      const code = String(record.billNumber || record.billId || generatedCode("BILL"));
      const supInput = String(record.supplierId || "");
      let supplierId = supInput;
      if (supInput) {
        const s = await prisma.supplier.findFirst({
          where: { OR: [{ id: supInput }, { code: supInput }] },
        });
        if (s) supplierId = s.id;
      }

      let projectId: string | null = null;
      if (record.projectId) {
        const p = await prisma.project.findFirst({
          where: { OR: [{ id: String(record.projectId) }, { code: String(record.projectId) }] },
        });
        if (p) projectId = p.id;
      }
      const poInput = String(record.orderId || record.poId || record.sourceDocumentId || "").trim();
      const linkedPo = poInput
        ? await prisma.purchaseOrder.findFirst({ where: { OR: [{ id: poInput }, { code: poInput }] } })
        : null;

      const total = Number(record.totalAmount || 0);
      const fx = await draftCurrencyValues(record, linkedPo?.currency || "PGK");
      const created = await prisma.supplierBill.create({
        data: {
          id: record.billId ? String(record.billId) : undefined,
          code,
          supplierId,
          projectId,
          billDate: record.billDate ? new Date(String(record.billDate)) : new Date(),
          dueDate: record.dueDate ? new Date(String(record.dueDate)) : null,
          currency: fx.currency,
          exchangeRate: fx.exchangeRate,
          baseSubtotal: fx.base(record.netAmount),
          baseTaxTotal: fx.base(record.gstAmount),
          baseTotal: fx.base(total),
          baseOutstanding: fx.base(total),
          subtotal: Number(record.netAmount || 0),
          taxTotal: Number(record.gstAmount || 0),
          total,
          outstanding: total,
          status: "DRAFT",
          orderId: linkedPo?.id || null,
          poReference: linkedPo?.code || (poInput || null),
          sourceDocId: linkedPo?.id || (poInput || null),
          createdBy: actor,
        },
      });
      return mapSupplierBill(created) as T;
    }

    case "SupplierBillLines": {
      const billId = String(record.billId || "");
      const created = await prisma.billLine.create({
        data: {
          id: record.billLineId ? String(record.billLineId) : undefined,
          billId,
          lineNo: Number(record.lineNo || 1),
          itemId: record.itemId ? String(record.itemId) : null,
          description: String(record.description || record.itemName || "Item"),
          quantity: Number(record.qty || record.quantity || 1),
          unitPrice: Number(record.rate || record.unitPrice || 0),
          amount: Number(record.netAmount || record.amount || 0),
          taxAmount: Number(record.gstAmount || record.taxAmount || 0),
          costAccount: record.costAccountId ? String(record.costAccountId) : "ACC-5100",
        },
      });
      return mapBillLine(created) as T;
    }

    case "Payments": {
      const partyType = String(record.partyType || "");
      const partyInput = String(record.partyId || "").trim();
      const customer = partyType === "Customer" && partyInput
        ? await prisma.customer.findFirst({ where: { OR: [{ id: partyInput }, { code: partyInput }] } })
        : null;
      const supplier = partyType === "Supplier" && partyInput
        ? await prisma.supplier.findFirst({ where: { OR: [{ id: partyInput }, { code: partyInput }] } })
        : null;
      if (partyType === "Customer" && !customer) throw new Error(`Customer ${partyInput || "(blank)"} not found`);
      if (partyType === "Supplier" && !supplier) throw new Error(`Supplier ${partyInput || "(blank)"} not found`);

      const projectInput = String(record.projectId || "").trim();
      const project = projectInput
        ? await prisma.project.findFirst({ where: { OR: [{ id: projectInput }, { code: projectInput }] } })
        : null;
      const againstInput = String(record.againstDocumentId || "").trim();
      const invoice = customer && againstInput
        ? await prisma.invoice.findFirst({ where: { OR: [{ id: againstInput }, { code: againstInput }] } })
        : null;
      const bill = supplier && againstInput
        ? await prisma.supplierBill.findFirst({ where: { OR: [{ id: againstInput }, { code: againstInput }] } })
        : null;
      if (againstInput && customer && !invoice) throw new Error(`Sales Invoice ${againstInput} not found`);
      if (againstInput && supplier && !bill) throw new Error(`Supplier Invoice ${againstInput} not found`);

      const fx = await draftCurrencyValues(record, invoice?.currency || bill?.currency || customer?.currency || supplier?.currency || "PGK");
      const paymentType = String(record.paymentType || "").toUpperCase();
      const prismaType = customer
        ? (paymentType === "PAY" ? "CUSTOMER_REFUND" : "CUSTOMER_RECEIPT")
        : "SUPPLIER_PAYMENT";
      const requestedStatus = String(record.status || "DRAFT").toUpperCase();
      const prismaStatus = requestedStatus === "APPROVED"
        ? "AUTHORIZED"
        : requestedStatus === "POSTED"
          ? "CLEARED"
          : "PENDING";
      const created = await prisma.payment.create({
        data: {
          id: record.paymentId ? String(record.paymentId) : undefined,
          code: String(record.paymentNumber || record.paymentId || generatedCode("PAY")),
          type: prismaType as any,
          date: record.paymentDate ? new Date(String(record.paymentDate)) : new Date(),
          amount: Number(record.amount || 0),
          baseAmount: fx.base(record.amount),
          currency: fx.currency,
          exchangeRate: fx.exchangeRate,
          paymentMethod: String(record.paymentMethod || "Cash"),
          referenceNumber: record.reference ? String(record.reference) : null,
          status: prismaStatus as any,
          customerId: customer?.id || null,
          supplierId: supplier?.id || null,
          invoiceId: invoice?.id || null,
          billId: bill?.id || null,
          projectId: project?.id || null,
          depositAccount: record.cashBankAccountId ? String(record.cashBankAccountId) : null,
          sourceDocId: record.sourceDocumentId ? String(record.sourceDocumentId) : null,
          journalId: record.journalId ? String(record.journalId) : null,
          createdBy: actor,
        },
      });
      return mapPayment(created) as T;
    }

    case "Expenses": {
      const supplierInput = String(record.supplierId || "").trim();
      const projectInput = String(record.projectId || "").trim();
      const supplier = supplierInput
        ? await prisma.supplier.findFirst({ where: { OR: [{ id: supplierInput }, { code: supplierInput }] } })
        : null;
      const project = projectInput
        ? await prisma.project.findFirst({ where: { OR: [{ id: projectInput }, { code: projectInput }] } })
        : null;
      if (supplierInput && !supplier) throw new Error(`Supplier ${supplierInput} not found`);
      if (projectInput && !project) throw new Error(`Project ${projectInput} not found`);

      const requestedStatus = String(record.status || "DRAFT").toUpperCase();
      const created = await prisma.expense.create({
        data: {
          id: record.expenseId ? String(record.expenseId) : undefined,
          code: String(record.expenseNumber || record.expenseId || generatedCode("EXP")),
          date: record.expenseDate ? new Date(String(record.expenseDate)) : new Date(),
          supplierId: supplier?.id || null,
          projectId: project?.id || null,
          category: String(record.expenseAccountId || "ACC-6600"),
          description: String(record.description || "Expense"),
          amount: Number(record.netAmount || 0),
          taxAmount: Number(record.gstAmount || 0),
          total: Number(record.totalAmount || (Number(record.netAmount || 0) + Number(record.gstAmount || 0))),
          paymentMethod: String(record.paymentMethod || "Cash"),
          referenceAccount: String(record.cashBankAccountId || "ACC-1110"),
          glPosted: requestedStatus === "POSTED",
          approvedBy: requestedStatus === "APPROVED" || requestedStatus === "POSTED" ? actor : null,
          approvedAt: requestedStatus === "APPROVED" || requestedStatus === "POSTED" ? new Date() : null,
          journalId: record.journalId ? String(record.journalId) : null,
          createdBy: actor,
        },
        include: { supplier: true, project: true },
      });
      return mapExpense(created) as T;
    }

    case "PaymentSchedules": {
      return await insertPaymentSchedule(record, actor) as T;
    }

    case "StockMovements": {
      const itemInput = String(record.itemId || "").trim();
      const item = itemInput
        ? await prisma.item.findFirst({ where: { OR: [{ id: itemInput }, { code: itemInput }] } })
        : null;
      if (!item) throw new Error(`Item ${itemInput || "(blank)"} not found`);
      const rawMovementType = String(record.movementType || record.type || "ADJUSTMENT_IN").trim().toUpperCase();
      const supportedTypes = new Set([
        "PURCHASE_IN", "PURCHASE_RECEIPT", "SALES_DELIVERY", "SALES_ISSUE", "SALES_ISSUE_ROLLBACK", "SALE_OUT", "PROJECT_ISSUE", "ADJUSTMENT_IN", "ADJUSTMENT_OUT",
        "TRANSFER_IN", "TRANSFER_OUT", "RETURN_IN", "RETURN_OUT", "LANDED_COST", "REVALUATION", "NRV_WRITEDOWN", "COUNTED",
      ]);
      const movementType = supportedTypes.has(rawMovementType) ? rawMovementType : "ADJUSTMENT_IN";
      const qtyIn = Number(record.qtyIn || 0);
      const qtyOut = Number(record.qtyOut || 0);
      const quantity = Math.abs(Number(record.qty || qtyIn || qtyOut || 0));
      const warehouseInput = String(record.warehouseId || record.warehouseCode || "").trim();
      const warehouse = warehouseInput
        ? await prisma.warehouse.findFirst({ where: { OR: [{ id: warehouseInput }, { code: warehouseInput }] } })
        : await prisma.warehouse.findFirst({ where: { isDefault: true, isActive: true } });
      if (warehouseInput && !warehouse) throw new Error(`Warehouse ${warehouseInput} not found`);
      const created = await prisma.stockMovement.create({
        data: {
          id: record.movementId ? String(record.movementId) : undefined,
          itemId: item.id,
          type: movementType as any,
          quantity,
          unitCost: record.unitCost !== undefined ? Number(record.unitCost || 0) : null,
          totalCost: ["LANDED_COST", "REVALUATION", "NRV_WRITEDOWN"].includes(movementType) && record.valueAdjustment !== undefined
            ? Number(record.valueAdjustment || 0)
            : record.value !== undefined
              ? Number(record.value || 0)
              : record.totalCost !== undefined
                ? Number(record.totalCost || 0)
                : null,
          referenceType: movementType,
          referenceId: record.sourceDocumentId ? String(record.sourceDocumentId) : record.referenceId ? String(record.referenceId) : null,
          journalId: record.journalId ? String(record.journalId) : null,
          projectId: record.projectId ? String(record.projectId) : null,
          warehouseId: warehouse?.id || null,
          transferId: record.transferId ? String(record.transferId) : null,
          note: record.note ? String(record.note) : null,
          createdAt: record.movementDate ? new Date(String(record.movementDate)) : undefined,
          createdBy: actor,
        },
      });
      const hydrated = await prisma.stockMovement.findUnique({ where: { id: created.id }, include: { warehouse: true } });
      return mapStockMovement(hydrated) as T;
    }

    case "FixedAssets": {
      const supplierInput = String(record.supplierId || "").trim();
      const supplier = supplierInput ? await prisma.supplier.findFirst({ where: { OR: [{ id: supplierInput }, { code: supplierInput }] } }) : null;
      const assetId = String(record.assetId || generatedCode("AST"));
      const cost = Number(record.cost || 0);
      const created = await prisma.fixedAsset.create({
        data: {
          assetId,
          assetName: String(record.assetName || "Fixed Asset"),
          assetCategory: String(record.assetCategory || "General"),
          purchaseDate: record.purchaseDate ? new Date(String(record.purchaseDate)) : new Date(),
          supplierId: supplier?.id || null,
          cost,
          serialNumber: record.serialNumber ? String(record.serialNumber) : null,
          location: record.location ? String(record.location) : null,
          assignedTo: record.assignedTo ? String(record.assignedTo) : null,
          usefulLifeMonths: Number(record.usefulLifeMonths || 36),
          accumulatedDepreciation: Number(record.accumulatedDepreciation || 0),
          netBookValue: record.netBookValue !== undefined ? Number(record.netBookValue || 0) : cost,
          status: record.status ? String(record.status) : "ACTIVE",
          sourceDocumentId: record.sourceDocumentId ? String(record.sourceDocumentId) : null,
          acquisitionJournalId: record.acquisitionJournalId ? String(record.acquisitionJournalId) : null,
          depreciationJournalId: record.depreciationJournalId ? String(record.depreciationJournalId) : null,
        },
      });
      return mapFixedAsset(created) as T;
    }

    case "Settings": {
      const key = String(record.key || "");
      const value = String(record.value || "");
      const upserted = await prisma.globalSettings.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
      return mapSetting(upserted) as T;
    }

    default:
      return record as T;
  }
}

export async function prismaBatchAppend<T = any>(
  table: string,
  records: Record<string, unknown>[],
  actor = "web-app"
): Promise<T[]> {
  const result: T[] = [];
  for (const record of records) {
    const appended = await prismaAppendRecord<T>(table, record, actor);
    result.push(appended);
  }
  return result;
}

export async function prismaUpdateRecord<T = any>(
  table: string,
  idField: string,
  idValue: string,
  patch: Record<string, unknown>,
  actor = "web-app"
): Promise<T> {
  switch (table) {
    case "Customers": {
      const existing = await prisma.customer.findFirst({
        where: { OR: [{ id: idValue }, { code: idValue }] },
      });
      if (!existing) throw new Error(`Customer ${idValue} not found`);
      const updated = await prisma.customer.update({
        where: { id: existing.id },
        data: {
          name: patch.customerName ? String(patch.customerName) : undefined,
          phone: patch.phone !== undefined ? (patch.phone ? String(patch.phone) : null) : undefined,
          email: patch.email !== undefined ? (patch.email ? String(patch.email) : null) : undefined,
          address: patch.address !== undefined ? (patch.address ? String(patch.address) : null) : undefined,
          taxId: patch.taxId !== undefined ? (patch.taxId ? String(patch.taxId) : null) : undefined,
          paymentTerms: patch.creditTermsDays !== undefined ? Number(patch.creditTermsDays) : undefined,
          creditLimit: patch.creditLimit !== undefined ? Number(patch.creditLimit) : undefined,
          currency: patch.currency !== undefined ? normalizeCurrency(patch.currency) : undefined,
        },
      });
      return mapCustomer(updated) as T;
    }

    case "Suppliers": {
      const existing = await prisma.supplier.findFirst({
        where: { OR: [{ id: idValue }, { code: idValue }] },
      });
      if (!existing) throw new Error(`Supplier ${idValue} not found`);
      const updated = await prisma.supplier.update({
        where: { id: existing.id },
        data: {
          name: patch.supplierName ? String(patch.supplierName) : undefined,
          phone: patch.phone !== undefined ? (patch.phone ? String(patch.phone) : null) : undefined,
          email: patch.email !== undefined ? (patch.email ? String(patch.email) : null) : undefined,
          address: patch.address !== undefined ? (patch.address ? String(patch.address) : null) : undefined,
          taxId: patch.taxId !== undefined ? (patch.taxId ? String(patch.taxId) : null) : undefined,
          paymentTerms: patch.paymentTermsDays !== undefined ? Number(patch.paymentTermsDays) : undefined,
          currency: patch.currency !== undefined ? normalizeCurrency(patch.currency) : undefined,
        },
      });
      return mapSupplier(updated) as T;
    }

    case "Projects": {
      const existing = await prisma.project.findFirst({
        where: { OR: [{ id: idValue }, { code: idValue }] },
      });
      if (!existing) throw new Error(`Project ${idValue} not found`);
      const statusStr = patch.status ? String(patch.status).trim().toUpperCase().replace(/\s+/g, "_") : "";
      let projectStatus: any = undefined;
      if (statusStr) {
        if (statusStr === "OPEN" || statusStr === "PLANNING") projectStatus = "PLANNING";
        else if (statusStr === "ACTIVE") projectStatus = "ACTIVE";
        else if (statusStr === "ON_HOLD" || statusStr === "ONHOLD") projectStatus = "ON_HOLD";
        else if (statusStr === "COMPLETED") projectStatus = "COMPLETED";
        else if (statusStr === "CANCELLED" || statusStr === "CANCEL") projectStatus = "CANCELLED";
        else projectStatus = "ACTIVE";
      }
      const updated = await prisma.project.update({
        where: { id: existing.id },
        data: {
          name: patch.projectName ? String(patch.projectName) : undefined,
          description: patch.description !== undefined ? (patch.description ? String(patch.description) : null) : undefined,
          budget: patch.contractTotal !== undefined ? Number(patch.contractTotal) : undefined,
          status: projectStatus,
        },
      });
      return mapProject(updated) as T;
    }

    case "PurchaseOrders": {
      const existing = await prisma.purchaseOrder.findFirst({
        where: { OR: [{ id: idValue }, { code: idValue }] },
      });
      if (!existing) throw new Error(`PurchaseOrder ${idValue} not found`);
      if (patch.currency !== undefined && existing.status !== "DRAFT" && normalizeCurrency(patch.currency) !== existing.currency) {
        throw new Error("Purchase Order currency cannot be changed after approval");
      }
      const statusStr = patch.status ? String(patch.status).toUpperCase() : "";
      let poStatus: any = undefined;
      if (statusStr) {
        if (statusStr === "APPROVED") poStatus = "SENT";
        else if (statusStr === "PART_RECEIVED" || statusStr === "PARTIAL_RECEIVED") poStatus = "PARTIAL_RECEIVED";
        else if (statusStr === "RECEIVED") poStatus = "RECEIVED";
        else if (statusStr === "BILLED") poStatus = "BILLED";
        else if (statusStr === "CANCELLED" || statusStr === "CANCEL") poStatus = "Cancelled";
        else if (statusStr === "DRAFT") poStatus = "DRAFT";
        else if (statusStr === "SENT") poStatus = "SENT";
        else if (statusStr === "CLOSED") poStatus = "CLOSED";
        else poStatus = "SENT";
      }
      const updated = await prisma.purchaseOrder.update({
        where: { id: existing.id },
        data: {
          status: poStatus,
          notes: patch.notes !== undefined ? (patch.notes ? String(patch.notes) : null) : undefined,
          sourceDocId: patch.sourceDocumentId !== undefined ? (patch.sourceDocumentId ? String(patch.sourceDocumentId) : null) : undefined,
        },
      });
      const hydrated = await prisma.purchaseOrder.findUnique({ where: { id: updated.id }, include: { supplier: true, project: true } });
      return mapPurchaseOrder(hydrated) as T;
    }

    case "Quotes": {
      const existing = await prisma.quote.findFirst({
        where: { OR: [{ id: idValue }, { code: idValue }] },
      });
      if (!existing) throw new Error(`Quote ${idValue} not found`);
      if (patch.currency !== undefined && existing.status !== "DRAFT" && normalizeCurrency(patch.currency) !== existing.currency) {
        throw new Error("Quotation / Sales Order currency cannot be changed after approval");
      }
      const statusStr = patch.status ? String(patch.status).toUpperCase() : "";
      let quoteStatus: any = undefined;
      if (statusStr) {
        if (statusStr === "APPROVED") quoteStatus = "ACCEPTED";
        else if (statusStr === "CANCELLED" || statusStr === "CANCEL") quoteStatus = "CANCELLED";
        else if (statusStr === "DRAFT") quoteStatus = "DRAFT";
        else if (statusStr === "SENT") quoteStatus = "SENT";
        else if (["CONVERTED", "PART_DELIVERED", "DELIVERED", "PART_INVOICED", "INVOICED"].includes(statusStr)) quoteStatus = statusStr;
        else quoteStatus = "ACCEPTED";
      }
      const updated = await prisma.quote.update({
        where: { id: existing.id },
        data: {
          status: quoteStatus,
          currency: patch.currency !== undefined ? normalizeCurrency(patch.currency) : undefined,
          exchangeRate: patch.exchangeRate !== undefined ? Number(patch.exchangeRate || 0) || null : undefined,
          sourceDocId: patch.sourceDocumentId !== undefined ? (patch.sourceDocumentId ? String(patch.sourceDocumentId) : null) : undefined,
        },
        include: { customer: true, project: true },
      });
      return mapQuote(updated) as T;
    }

    case "Invoices": {
      const existing = await prisma.invoice.findFirst({
        where: { OR: [{ id: idValue }, { code: idValue }] },
      });
      if (!existing) throw new Error(`Invoice ${idValue} not found`);
      if (patch.currency !== undefined && (existing.glPosted || existing.status !== "DRAFT") && normalizeCurrency(patch.currency) !== existing.currency) {
        throw new Error("Sales Invoice currency cannot be changed after posting/approval");
      }
      const statusStr = patch.status ? String(patch.status).toUpperCase() : "";
      let invoiceStatus: any = undefined;
      if (statusStr) {
        if (statusStr === "APPROVED" || statusStr === "POSTED") invoiceStatus = "SENT";
        else if (statusStr === "CANCELLED" || statusStr === "CANCEL") invoiceStatus = "CANCELLED";
        else if (statusStr === "PAID") invoiceStatus = "PAID";
        else if (statusStr === "DRAFT") invoiceStatus = "DRAFT";
        else invoiceStatus = "SENT";
      }
      const updated = await prisma.invoice.update({
        where: { id: existing.id },
        data: {
          status: invoiceStatus,
          currency: patch.currency !== undefined ? normalizeCurrency(patch.currency) : undefined,
          exchangeRate: patch.exchangeRate !== undefined ? Number(patch.exchangeRate || 0) || null : undefined,
          outstanding: patch.outstandingAmount !== undefined ? Number(patch.outstandingAmount) : undefined,
          journalId: patch.journalId !== undefined ? (patch.journalId ? String(patch.journalId) : null) : undefined,
          sourceDocId: patch.sourceDocumentId !== undefined ? (patch.sourceDocumentId ? String(patch.sourceDocumentId) : null) : undefined,
        },
        include: { customer: true, project: true },
      });
      return mapInvoice(updated) as T;
    }

    case "SupplierBills": {
      const existing = await prisma.supplierBill.findFirst({
        where: { OR: [{ id: idValue }, { code: idValue }] },
      });
      if (!existing) throw new Error(`SupplierBill ${idValue} not found`);
      if (patch.currency !== undefined && (existing.glPosted || existing.status !== "DRAFT") && normalizeCurrency(patch.currency) !== existing.currency) {
        throw new Error("Supplier Invoice currency cannot be changed after posting/approval");
      }
      const statusStr = patch.status ? String(patch.status).toUpperCase() : "";
      let billStatus: any = undefined;
      if (statusStr) {
        if (statusStr === "APPROVED" || statusStr === "POSTED") billStatus = "SENT";
        else if (statusStr === "CANCELLED" || statusStr === "CANCEL") billStatus = "CANCELLED";
        else if (statusStr === "PAID") billStatus = "PAID";
        else if (statusStr === "DRAFT") billStatus = "DRAFT";
        else billStatus = "SENT";
      }
      const updated = await prisma.supplierBill.update({
        where: { id: existing.id },
        data: {
          status: billStatus,
          currency: patch.currency !== undefined ? normalizeCurrency(patch.currency) : undefined,
          exchangeRate: patch.exchangeRate !== undefined ? Number(patch.exchangeRate || 0) || null : undefined,
          outstanding: patch.outstandingAmount !== undefined ? Number(patch.outstandingAmount) : undefined,
          amountPaid: patch.paidAmount !== undefined ? Number(patch.paidAmount) : undefined,
          journalId: patch.journalId ? String(patch.journalId) : undefined,
        },
      });
      const hydrated = await prisma.supplierBill.findUnique({ where: { id: updated.id }, include: { supplier: true, project: true } });
      return mapSupplierBill(hydrated) as T;
    }

    case "Payments": {
      const existing = await prisma.payment.findFirst({
        where: { OR: [{ id: idValue }, { code: idValue }] },
      });
      if (!existing) throw new Error(`Payment ${idValue} not found`);
      if (patch.currency !== undefined && existing.status !== "PENDING" && normalizeCurrency(patch.currency) !== existing.currency) {
        throw new Error("Payment currency cannot be changed after approval");
      }
      const statusStr = patch.status ? String(patch.status).trim().toUpperCase() : "";
      const paymentStatus = statusStr === "DRAFT"
        ? "PENDING"
        : statusStr === "APPROVED"
          ? "AUTHORIZED"
          : statusStr === "POSTED"
            ? "CLEARED"
            : statusStr || undefined;

      const againstInput = patch.againstDocumentId !== undefined ? String(patch.againstDocumentId || "").trim() : "";
      const againstType = String(patch.againstDocumentType || "").toLowerCase();
      let invoiceId: string | null | undefined;
      let billId: string | null | undefined;
      if (patch.againstDocumentId !== undefined) {
        invoiceId = null;
        billId = null;
        if (againstInput && (againstType.includes("sales") || existing.customerId)) {
          const invoice = await prisma.invoice.findFirst({ where: { OR: [{ id: againstInput }, { code: againstInput }] } });
          if (!invoice) throw new Error(`Sales Invoice ${againstInput} not found`);
          invoiceId = invoice.id;
        } else if (againstInput) {
          const bill = await prisma.supplierBill.findFirst({ where: { OR: [{ id: againstInput }, { code: againstInput }] } });
          if (!bill) throw new Error(`Supplier Invoice ${againstInput} not found`);
          billId = bill.id;
        }
      }

      const updated = await prisma.payment.update({
        where: { id: existing.id },
        data: {
          status: paymentStatus as any,
          date: patch.paymentDate !== undefined ? new Date(String(patch.paymentDate)) : undefined,
          amount: patch.amount !== undefined ? Number(patch.amount) : undefined,
          currency: patch.currency !== undefined ? normalizeCurrency(patch.currency) : undefined,
          exchangeRate: patch.exchangeRate !== undefined ? Number(patch.exchangeRate || 0) || null : undefined,
          paymentMethod: patch.paymentMethod !== undefined ? String(patch.paymentMethod) : undefined,
          depositAccount: patch.cashBankAccountId !== undefined ? (patch.cashBankAccountId ? String(patch.cashBankAccountId) : null) : undefined,
          referenceNumber: patch.reference !== undefined ? (patch.reference ? String(patch.reference) : null) : undefined,
          sourceDocId: patch.sourceDocumentId !== undefined ? (patch.sourceDocumentId ? String(patch.sourceDocumentId) : null) : undefined,
          journalId: patch.journalId !== undefined ? (patch.journalId ? String(patch.journalId) : null) : undefined,
          invoiceId,
          billId,
        },
      });
      const hydrated = await prisma.payment.findUnique({ where: { id: updated.id }, include: { customer: true, supplier: true, project: true, allocations: { where: { status: "POSTED" } } } });
      return mapPayment(hydrated) as T;
    }

    case "Items": {
      const existing = await prisma.item.findFirst({
        where: { OR: [{ id: idValue }, { code: idValue }] },
      });
      if (!existing) throw new Error(`Item ${idValue} not found`);
      const updated = await prisma.item.update({
        where: { id: existing.id },
        data: {
          name: patch.itemName ? String(patch.itemName) : undefined,
          sellPrice: patch.sellPrice !== undefined
            ? Number(patch.sellPrice)
            : patch.rate !== undefined
              ? Number(patch.rate)
              : undefined,
          purchasePrice: patch.purchasePrice !== undefined
            ? Number(patch.purchasePrice)
            : patch.valuationRate !== undefined
              ? Number(patch.valuationRate)
              : undefined,
          revenueAccount: patch.revenueAccount !== undefined ? String(patch.revenueAccount) : undefined,
          costAccount: patch.costAccount !== undefined ? String(patch.costAccount) : undefined,
          taxCode: patch.taxCode !== undefined ? String(patch.taxCode) : undefined,
          isActive: patch.active !== undefined ? patch.active !== false : undefined,
        },
      });
      return mapItem(updated) as T;
    }

    case "Expenses": {
      const existing = await prisma.expense.findFirst({
        where: { OR: [{ id: idValue }, { code: idValue }] },
      });
      if (!existing) throw new Error(`Expense ${idValue} not found`);
      const requestedStatus = patch.status ? String(patch.status).toUpperCase() : "";
      if (existing.glPosted && requestedStatus && requestedStatus !== "POSTED") {
        throw new Error("Posted Expense cannot be moved back to an editable workflow state; use reversal");
      }

      const updated = await prisma.expense.update({
        where: { id: existing.id },
        data: {
          approvedBy: requestedStatus === "APPROVED"
            ? actor
            : requestedStatus === "DRAFT"
              ? null
              : requestedStatus === "CANCELLED"
                ? "__CANCELLED__"
                : undefined,
          approvedAt: requestedStatus === "APPROVED"
            ? new Date()
            : requestedStatus === "DRAFT" || requestedStatus === "CANCELLED"
              ? null
              : undefined,
          glPosted: requestedStatus === "POSTED" ? true : undefined,
          journalId: patch.journalId !== undefined ? (patch.journalId ? String(patch.journalId) : null) : undefined,
          category: patch.expenseAccountId !== undefined ? String(patch.expenseAccountId || "ACC-6600") : undefined,
          referenceAccount: patch.cashBankAccountId !== undefined ? String(patch.cashBankAccountId || "ACC-1110") : undefined,
          paymentMethod: patch.paymentMethod !== undefined ? String(patch.paymentMethod || "Cash") : undefined,
          description: patch.description !== undefined ? String(patch.description || "") : undefined,
        },
        include: { supplier: true, project: true },
      });
      return mapExpense(updated) as T;
    }

    case "PaymentSchedules": {
      return await updatePaymentSchedule(idValue, patch) as T;
    }

    case "StockMovements": {
      const existing = await prisma.stockMovement.findFirst({ where: { id: idValue } });
      if (!existing) throw new Error(`StockMovement ${idValue} not found`);
      const updated = await prisma.stockMovement.update({
        where: { id: existing.id },
        data: {
          journalId: patch.journalId !== undefined ? (patch.journalId ? String(patch.journalId) : null) : undefined,
          referenceId: patch.sourceDocumentId !== undefined ? (patch.sourceDocumentId ? String(patch.sourceDocumentId) : null) : undefined,
          note: patch.note !== undefined ? (patch.note ? String(patch.note) : null) : undefined,
        },
      });
      return mapStockMovement(updated) as T;
    }

    case "FixedAssets": {
      const existing = await prisma.fixedAsset.findFirst({
        where: { OR: [{ id: idValue }, { assetId: idValue }] },
      });
      if (!existing) throw new Error(`FixedAsset ${idValue} not found`);
      const updated = await prisma.fixedAsset.update({
        where: { id: existing.id },
        data: {
          assetName: patch.assetName !== undefined ? String(patch.assetName) : undefined,
          status: patch.status !== undefined ? String(patch.status) : undefined,
          accumulatedDepreciation: patch.accumulatedDepreciation !== undefined ? Number(patch.accumulatedDepreciation) : undefined,
          netBookValue: patch.netBookValue !== undefined ? Number(patch.netBookValue) : undefined,
          acquisitionJournalId: patch.acquisitionJournalId !== undefined ? (patch.acquisitionJournalId ? String(patch.acquisitionJournalId) : null) : undefined,
          depreciationJournalId: patch.depreciationJournalId !== undefined ? (patch.depreciationJournalId ? String(patch.depreciationJournalId) : null) : undefined,
        },
      });
      return mapFixedAsset(updated) as T;
    }

    case "Settings": {
      const key = String(idValue);
      const value = String(patch.value || "");
      const updated = await prisma.globalSettings.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
      return mapSetting(updated) as T;
    }

    default:
      return patch as T;
  }
}

export async function prismaDeleteSupplier(supplierId: string) {
  const existing = await prisma.supplier.findFirst({
    where: { OR: [{ id: supplierId }, { code: supplierId }] },
  });
  if (!existing) throw new Error("Supplier not found");

  const [billCount, poCount, paymentCount, expenseCount, assetCount, projectCount] = await Promise.all([
    prisma.supplierBill.count({ where: { supplierId: existing.id } }),
    prisma.purchaseOrder.count({ where: { supplierId: existing.id } }),
    prisma.payment.count({ where: { supplierId: existing.id } }),
    prisma.expense.count({ where: { supplierId: existing.id } }),
    prisma.fixedAsset.count({ where: { supplierId: existing.id } }),
    prisma.project.count({ where: { supplierId: existing.id } }),
  ]);

  const totalEntries = billCount + poCount + paymentCount + expenseCount + assetCount + projectCount;
  if (totalEntries > 0) {
    const reasons: string[] = [];
    if (billCount > 0) reasons.push(`${billCount} bill(s)`);
    if (poCount > 0) reasons.push(`${poCount} purchase order(s)/quote(s)`);
    if (paymentCount > 0) reasons.push(`${paymentCount} payment(s)`);
    if (expenseCount > 0) reasons.push(`${expenseCount} expense(s)`);
    if (assetCount > 0) reasons.push(`${assetCount} fixed asset(s)`);
    if (projectCount > 0) reasons.push(`${projectCount} project(s)`);
    throw new Error(`Cannot delete supplier: supplier already has accounts ledger entries or transactions (${reasons.join(", ")}).`);
  }

  await prisma.contact.deleteMany({ where: { supplierId: existing.id } });
  await prisma.supplier.delete({ where: { id: existing.id } });
  return { deleted: true, supplierId: existing.id, supplierName: existing.name };
}

export async function prismaDeleteCustomer(customerId: string) {
  const existing = await prisma.customer.findFirst({
    where: { OR: [{ id: customerId }, { code: customerId }] },
  });
  if (!existing) throw new Error("Customer not found");

  const [invoiceCount, quoteCount, paymentCount, creditNoteCount, projectCount] = await Promise.all([
    prisma.invoice.count({ where: { customerId: existing.id } }),
    prisma.quote.count({ where: { customerId: existing.id } }),
    prisma.payment.count({ where: { customerId: existing.id } }),
    prisma.creditNote.count({ where: { customerId: existing.id } }),
    prisma.project.count({ where: { customerId: existing.id } }),
  ]);

  const totalEntries = invoiceCount + quoteCount + paymentCount + creditNoteCount + projectCount;
  if (totalEntries > 0) {
    const reasons: string[] = [];
    if (invoiceCount > 0) reasons.push(`${invoiceCount} invoice(s)`);
    if (quoteCount > 0) reasons.push(`${quoteCount} quotation(s)`);
    if (paymentCount > 0) reasons.push(`${paymentCount} payment(s)`);
    if (creditNoteCount > 0) reasons.push(`${creditNoteCount} credit note(s)`);
    if (projectCount > 0) reasons.push(`${projectCount} project(s)`);
    throw new Error(`Cannot delete customer: customer already has accounts ledger entries or transactions (${reasons.join(", ")}).`);
  }

  await prisma.contact.deleteMany({ where: { customerId: existing.id } });
  await prisma.customer.delete({ where: { id: existing.id } });
  return { deleted: true, customerId: existing.id, customerName: existing.name };
}

export async function prismaDeleteProject(projectId: string) {
  const existing = await prisma.project.findFirst({
    where: { OR: [{ id: projectId }, { code: projectId }] },
  });
  if (!existing) throw new Error("Project not found");

  const [poCount, billCount, quoteCount, invoiceCount, paymentCount, expenseCount, movementCount] = await Promise.all([
    prisma.purchaseOrder.count({ where: { projectId: existing.id } }),
    prisma.supplierBill.count({ where: { projectId: existing.id } }),
    prisma.quote.count({ where: { projectId: existing.id } }),
    prisma.invoice.count({ where: { projectId: existing.id } }),
    prisma.payment.count({ where: { projectId: existing.id } }),
    prisma.expense.count({ where: { projectId: existing.id } }),
    prisma.stockMovement.count({ where: { projectId: existing.id } }),
  ]);

  const totalEntries = poCount + billCount + quoteCount + invoiceCount + paymentCount + expenseCount + movementCount;
  if (totalEntries > 0) {
    const reasons: string[] = [];
    if (invoiceCount > 0) reasons.push(`${invoiceCount} invoice(s)`);
    if (quoteCount > 0) reasons.push(`${quoteCount} quotation(s)`);
    if (poCount > 0) reasons.push(`${poCount} purchase order(s)/quote(s)`);
    if (billCount > 0) reasons.push(`${billCount} bill(s)`);
    if (paymentCount > 0) reasons.push(`${paymentCount} payment(s)`);
    if (expenseCount > 0) reasons.push(`${expenseCount} expense(s)`);
    if (movementCount > 0) reasons.push(`${movementCount} stock movement(s)`);
    throw new Error(`Cannot delete project: project already has accounts ledger entries or transactions (${reasons.join(", ")}).`);
  }

  await prisma.project.delete({ where: { id: existing.id } });
  return { deleted: true, projectId: existing.id, projectName: existing.name };
}

export async function prismaDeleteItem(itemId: string) {
  const existing = await prisma.item.findFirst({
    where: { OR: [{ id: itemId }, { code: itemId }] },
  });
  if (!existing) throw new Error("Item not found");

  const [poLineCount, quoteLineCount, invoiceLineCount, billLineCount, movementCount] = await Promise.all([
    prisma.pOLine.count({ where: { itemId: existing.id } }),
    prisma.quoteLine.count({ where: { itemId: existing.id } }),
    prisma.invoiceLine.count({ where: { itemId: existing.id } }),
    prisma.billLine.count({ where: { itemId: existing.id } }),
    prisma.stockMovement.count({ where: { itemId: existing.id } }),
  ]);

  const totalEntries = poLineCount + quoteLineCount + invoiceLineCount + billLineCount + movementCount;
  if (totalEntries > 0) {
    const reasons: string[] = [];
    if (poLineCount > 0) reasons.push(`${poLineCount} purchase order line(s)`);
    if (quoteLineCount > 0) reasons.push(`${quoteLineCount} quote line(s)`);
    if (invoiceLineCount > 0) reasons.push(`${invoiceLineCount} invoice line(s)`);
    if (billLineCount > 0) reasons.push(`${billLineCount} bill line(s)`);
    if (movementCount > 0) reasons.push(`${movementCount} stock movement(s)`);
    throw new Error(`Cannot delete item: item already has transactions or stock movements (${reasons.join(", ")}).`);
  }

  await prisma.stockLevel.deleteMany({ where: { itemId: existing.id } });
  await prisma.item.delete({ where: { id: existing.id } });
  return { deleted: true, itemId: existing.id, itemName: existing.name };
}

export async function prismaDeleteQuote(quoteId: string) {
  const existing = await prisma.quote.findFirst({
    where: { OR: [{ id: quoteId }, { code: quoteId }] },
  });
  if (!existing) throw new Error("Quotation not found");

  const [convertedCount, sourceDocCount] = await Promise.all([
    existing.convertedToInvoiceId ? 1 : 0,
    prisma.invoice.count({ where: { sourceDocId: existing.id } }),
  ]);

  const quoteReasons: string[] = [];
  if (String(existing.status).toUpperCase() !== "DRAFT") quoteReasons.push(`status is ${existing.status}`);
  if (convertedCount > 0 || sourceDocCount > 0 || String(existing.status).toUpperCase() === "CONVERTED") {
    quoteReasons.push("quotation has been converted or linked to a downstream sales document");
  }
  if (quoteReasons.length > 0) {
    throw new Error(`Cannot delete quotation: ${quoteReasons.join("; ")}. Cancel/retain the document instead of deleting audit history.`);
  }

  await prisma.quoteLine.deleteMany({ where: { quoteId: existing.id } });
  await prisma.quote.delete({ where: { id: existing.id } });
  return { deleted: true, quoteId: existing.id, quoteNumber: existing.code };
}

export async function prismaDeleteInvoice(invoiceId: string) {
  const existing = await prisma.invoice.findFirst({
    where: { OR: [{ id: invoiceId }, { code: invoiceId }] },
  });
  if (!existing) throw new Error("Sales invoice not found");

  const [paymentCount, creditNoteCount, sourceQuoteCount] = await Promise.all([
    prisma.paymentAllocation.count({ where: { invoiceId: existing.id, status: "POSTED" } }),
    prisma.creditNote.count({ where: { originalInvoiceId: existing.id } }),
    prisma.quote.count({ where: { convertedToInvoiceId: existing.id } }),
  ]);

  const reasons: string[] = [];
  if (String(existing.status).toUpperCase() !== "DRAFT") reasons.push(`status is ${existing.status}`);
  if (existing.glPosted || existing.journalId) reasons.push(`General Ledger journal entry posted (${existing.journalId || "GL"})`);
  if (paymentCount > 0) reasons.push(`${paymentCount} payment allocation(s)`);
  if (creditNoteCount > 0) reasons.push(`${creditNoteCount} credit note(s)`);
  if (sourceQuoteCount > 0 || existing.sourceDocId) reasons.push("linked source quotation / sales document exists");
  if (Number(existing.amountPaid || 0) > 0) reasons.push(`amount paid K${Number(existing.amountPaid).toFixed(2)}`);

  if (reasons.length > 0) {
    throw new Error(`Cannot delete sales invoice: ${reasons.join(", ")}. Posted/linked documents must be corrected by credit note, reversal, void, or cancellation—not deletion.`);
  }

  await prisma.invoiceLine.deleteMany({ where: { invoiceId: existing.id } });
  await prisma.invoice.delete({ where: { id: existing.id } });
  return { deleted: true, invoiceId: existing.id, invoiceNumber: existing.code };
}

export async function prismaDeletePurchaseOrder(poId: string) {
  const existing = await prisma.purchaseOrder.findFirst({
    where: { OR: [{ id: poId }, { code: poId }] },
  });
  if (!existing) throw new Error("Purchase order / supplier quotation not found");

  const [billCount, receiptCount] = await Promise.all([
    prisma.supplierBill.count({ where: { orderId: existing.id } }),
    prisma.goodsReceipt.count({ where: { orderId: existing.id } }),
  ]);

  const reasons: string[] = [];
  if (String(existing.status).toUpperCase() !== "DRAFT") reasons.push(`status is ${existing.status}`);
  if (billCount > 0) reasons.push(`${billCount} supplier bill(s)`);
  if (receiptCount > 0) reasons.push(`${receiptCount} goods receipt(s)`);
  if (existing.billId) reasons.push(`converted bill reference (${existing.billId})`);
  if (existing.sourceDocId) reasons.push("linked supplier quotation/source document exists");

  if (reasons.length > 0) {
    throw new Error(`Cannot delete purchase order / quotation: ${reasons.join(", ")}. Retain the document and use cancellation/closure for audit traceability.`);
  }

  await prisma.pOLine.deleteMany({ where: { orderId: existing.id } });
  await prisma.purchaseOrder.delete({ where: { id: existing.id } });
  return { deleted: true, poId: existing.id, poNumber: existing.code };
}

export async function prismaDeleteSupplierBill(billId: string) {
  const existing = await prisma.supplierBill.findFirst({
    where: { OR: [{ id: billId }, { code: billId }] },
  });
  if (!existing) throw new Error("Supplier invoice / bill not found");

  const [paymentCount, landedCostCount] = await Promise.all([
    prisma.paymentAllocation.count({ where: { billId: existing.id, status: "POSTED" } }),
    prisma.landedCostVoucher.count({ where: { billId: existing.id } }),
  ]);

  const reasons: string[] = [];
  if (String(existing.status).toUpperCase() !== "DRAFT") reasons.push(`status is ${existing.status}`);
  if (existing.glPosted || existing.journalId) reasons.push(`General Ledger journal entry posted (${existing.journalId || "GL"})`);
  if (paymentCount > 0) reasons.push(`${paymentCount} payment allocation(s)`);
  if (landedCostCount > 0) reasons.push(`${landedCostCount} landed cost voucher(s)`);
  if (existing.orderId || existing.sourceDocId) reasons.push("linked purchase order/source document exists");
  if (Number(existing.amountPaid || 0) > 0) reasons.push(`amount paid K${Number(existing.amountPaid).toFixed(2)}`);

  if (reasons.length > 0) {
    throw new Error(`Cannot delete supplier invoice: ${reasons.join(", ")}. Posted/linked bills must be corrected by reversal, supplier refund/credit, void, or cancellation—not deletion.`);
  }

  await prisma.billLine.deleteMany({ where: { billId: existing.id } });
  await prisma.supplierBill.delete({ where: { id: existing.id } });
  return { deleted: true, billId: existing.id, billNumber: existing.code };
}

export async function prismaDeletePayment(paymentId: string) {
  const existing = await prisma.payment.findFirst({
    where: { OR: [{ id: paymentId }, { code: paymentId }] },
  });
  if (!existing) throw new Error("Payment entry not found");

  const allocationCount = await prisma.paymentAllocation.count({
    where: { paymentId: existing.id },
  });

  const reasons: string[] = [];
  if (String(existing.status).toUpperCase() !== "PENDING") reasons.push(`payment status is ${existing.status}`);
  if (existing.journalId) reasons.push(`General Ledger journal entry posted (${existing.journalId})`);
  if (existing.clearanceDate) reasons.push("bank clearance recorded");
  if (allocationCount > 0) reasons.push(`${allocationCount} allocation row(s)`);

  if (reasons.length > 0) {
    throw new Error(`Cannot delete payment: ${reasons.join(", ")}. Finalized payments must be reversed/refunded rather than deleted.`);
  }

  await prisma.payment.delete({ where: { id: existing.id } });
  return { deleted: true, paymentId: existing.id, paymentNumber: existing.code };
}

export async function prismaDeleteExpense(expenseId: string) {
  const existing = await prisma.expense.findFirst({
    where: { OR: [{ id: expenseId }, { code: expenseId }] },
  });
  if (!existing) throw new Error("Expense not found");

  const reasons: string[] = [];
  if (existing.glPosted || existing.journalId) reasons.push(`General Ledger journal entry posted (${existing.journalId || "GL"})`);
  if (existing.approvedAt || existing.approvedBy) reasons.push("expense has already been approved");

  if (reasons.length > 0) {
    throw new Error(`Cannot delete expense: ${reasons.join(", ")}. Approved/posted expenses must be reversed or cancelled, not deleted.`);
  }

  await prisma.expense.delete({ where: { id: existing.id } });
  return { deleted: true, expenseId: existing.id, expenseNumber: existing.code };
}


