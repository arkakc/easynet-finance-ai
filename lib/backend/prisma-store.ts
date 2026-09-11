import { randomUUID } from "node:crypto";
import { prisma } from "@/src/lib/prisma";

export function generatedCode(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Row Mappers: Prisma Model -> Standard Table Format
// ---------------------------------------------------------------------------

function mapCustomer(c: any) {
  if (!c) return null;
  return {
    customerId: c.id,
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
    supplierId: s.id,
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
    projectId: p.id,
    projectCode: p.code,
    projectName: p.name,
    description: p.description || "",
    customerId: p.customerId || "",
    supplierId: p.supplierId || "",
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
  return {
    itemId: i.id,
    itemCode: i.code,
    itemName: i.name,
    description: i.description || i.name || "",
    category: i.category || "",
    itemType: i.type || "STOCK",
    unit: i.unit || "Each",
    uom: i.unit || "Each",
    defaultRate: Number(i.sellPrice || 0),
    rate: Number(i.sellPrice || 0),
    sellPrice: Number(i.sellPrice || 0),
    purchasePrice: Number(i.purchasePrice || 0),
    costAccount: i.costAccount || "ACC-5100",
    revenueAccount: i.revenueAccount || "ACC-4100",
    taxCode: i.taxCode || "GST",
    active: i.isActive !== false,
    deferredRevenueMonths: 0,
    createdAt: i.createdAt?.toISOString?.() || String(i.createdAt || ""),
  };
}

function mapPurchaseOrder(po: any) {
  if (!po) return null;
  const rawStatus = String(po.status || "DRAFT").toUpperCase();
  const status = rawStatus === "SENT" ? "APPROVED" : rawStatus === "CANCELLED" ? "CANCELLED" : rawStatus;
  return {
    poId: po.id,
    poNumber: po.code,
    supplierId: po.supplierId || "",
    projectId: po.projectId || "",
    poDate: po.orderDate?.toISOString?.().slice(0, 10) || String(po.orderDate || "").slice(0, 10),
    expectedDate: po.expectedDate?.toISOString?.().slice(0, 10) || "",
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
    customerId: q.customerId || "",
    projectId: q.projectId || "",
    quoteDate: q.issuedDate?.toISOString?.().slice(0, 10) || String(q.issuedDate || "").slice(0, 10),
    expiryDate: q.validUntil?.toISOString?.().slice(0, 10) || "",
    netAmount: Number(q.subtotal || 0),
    gstAmount: Number(q.taxTotal || 0),
    totalAmount: Number(q.total || 0),
    status,
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
    customerId: inv.customerId || "",
    projectId: inv.projectId || "",
    invoiceDate: inv.issuedDate?.toISOString?.().slice(0, 10) || String(inv.issuedDate || "").slice(0, 10),
    dueDate: inv.dueDate?.toISOString?.().slice(0, 10) || "",
    netAmount: Number(inv.subtotal || 0),
    gstAmount: Number(inv.taxTotal || 0),
    totalAmount: Number(inv.total || 0),
    paidAmount: Number(inv.total || 0) - Number(inv.outstanding || 0),
    outstandingAmount: Number(inv.outstanding ?? inv.total ?? 0),
    status,
    sourceDocumentId: "",
    journalId: "",
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
  return {
    billId: b.id,
    billNumber: b.code,
    supplierId: b.supplierId || "",
    projectId: b.projectId || "",
    billDate: b.billDate?.toISOString?.().slice(0, 10) || String(b.billDate || "").slice(0, 10),
    dueDate: b.dueDate?.toISOString?.().slice(0, 10) || "",
    netAmount: Number(b.subtotal || 0),
    gstAmount: Number(b.taxTotal || 0),
    totalAmount: Number(b.total || 0),
    paidAmount: Number(b.amountPaid || 0),
    outstandingAmount: Number(b.outstanding ?? b.total ?? 0),
    status,
    orderId: b.orderId || "",
    sourceDocumentId: b.sourceDocId || b.poReference || "",
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
  return {
    paymentId: pay.id,
    paymentNumber: pay.code,
    partyType: pay.customerId ? "Customer" : "Supplier",
    partyId: pay.customerId || pay.supplierId || "",
    projectId: pay.projectId || "",
    paymentType: pay.type?.includes?.("RECEIPT") ? "RECEIVE" : "PAY",
    paymentDate: pay.date?.toISOString?.().slice(0, 10) || String(pay.date || "").slice(0, 10),
    amount: Number(pay.amount || 0),
    paymentMethod: pay.paymentMethod || "Cash",
    cashBankAccountId: pay.depositAccount || "ACC-1110",
    reference: pay.referenceNumber || "",
    againstDocumentType: pay.invoiceId ? "Sales Invoice" : pay.billId ? "Supplier Invoice" : "",
    againstDocumentId: pay.invoiceId || pay.billId || "",
    sourceDocumentId: "",
    status: pay.status === "CLEARED" || pay.status === "AUTHORIZED" ? "POSTED" : (pay.status || "DRAFT"),
    journalId: "",
    createdAt: pay.createdAt?.toISOString?.() || String(pay.createdAt || ""),
  };
}

function mapExpense(exp: any) {
  if (!exp) return null;
  return {
    expenseId: exp.id,
    expenseNumber: exp.code,
    expenseDate: exp.date?.toISOString?.().slice(0, 10) || String(exp.date || "").slice(0, 10),
    supplierId: exp.supplierId || "",
    projectId: exp.projectId || "",
    expenseAccountId: exp.referenceAccount || "ACC-6600",
    description: exp.description || "",
    netAmount: Number(exp.amount || 0),
    gstAmount: Number(exp.taxAmount || 0),
    totalAmount: Number(exp.total || 0),
    paymentMethod: exp.paymentMethod || "Cash",
    cashBankAccountId: "ACC-1110",
    status: exp.glPosted ? "POSTED" : "DRAFT",
    journalId: exp.journalId || "",
    createdAt: exp.createdAt?.toISOString?.() || String(exp.createdAt || ""),
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

function mapAccount(acc: any) {
  if (!acc) return null;
  return {
    accountId: acc.id,
    accountCode: acc.code,
    accountName: acc.name,
    accountType: acc.type,
    parentId: acc.parentId || null,
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
        include: { contacts: { take: 1 } },
      });
      return rows.map(mapCustomer).filter(Boolean) as T[];
    }
    case "Suppliers": {
      const rows = await prisma.supplier.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
        include: { contacts: { take: 1 } },
      });
      return rows.map(mapSupplier).filter(Boolean) as T[];
    }
    case "Projects": {
      const rows = await prisma.project.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
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
      });
      return rows.map(mapPayment).filter(Boolean) as T[];
    }
    case "Expenses": {
      const rows = await prisma.expense.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
      });
      return rows.map(mapExpense).filter(Boolean) as T[];
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
      return rows.map(mapAccount).filter(Boolean) as T[];
    }
    default:
      return [];
  }
}

export async function prismaFindRecords<T = any>(
  table: string,
  filters: Record<string, unknown>,
  limit = 100
): Promise<T[]> {
  const all = await prismaListTable<T>(table, 500, 0);
  const filterEntries = Object.entries(filters).filter(([_, v]) => v !== undefined && v !== null);

  const matched = all.filter((row: any) => {
    return filterEntries.every(([key, val]) => {
      const rowVal = row[key];
      if (typeof val === "string" && typeof rowVal === "string") {
        return rowVal.toLowerCase() === val.toLowerCase();
      }
      return String(rowVal ?? "") === String(val ?? "");
    });
  });

  return matched.slice(0, limit);
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
      const created = await prisma.item.create({
        data: {
          id: record.itemId ? String(record.itemId) : undefined,
          code,
          name: String(record.itemName || record.name || "Item"),
          description: record.description ? String(record.description) : null,
          type: String(record.itemType || "GOOD").toUpperCase() as any,
          sellPrice: record.defaultRate ? Number(record.defaultRate) : record.rate ? Number(record.rate) : 0,
          revenueAccount: record.revenueAccount ? String(record.revenueAccount) : "ACC-4100",
          costAccount: record.costAccount ? String(record.costAccount) : "ACC-5100",
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

      const created = await prisma.purchaseOrder.create({
        data: {
          id: record.poId ? String(record.poId) : undefined,
          code,
          supplierId,
          projectId,
          orderDate: record.poDate ? new Date(String(record.poDate)) : new Date(),
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

      const created = await prisma.quote.create({
        data: {
          id: record.quoteId ? String(record.quoteId) : undefined,
          code,
          customerId,
          projectId,
          issuedDate: record.quoteDate ? new Date(String(record.quoteDate)) : new Date(),
          validUntil: record.expiryDate ? new Date(String(record.expiryDate)) : null,
          subtotal: Number(record.netAmount || 0),
          taxTotal: Number(record.gstAmount || 0),
          total: Number(record.totalAmount || 0),
          status: "DRAFT",
          createdBy: actor,
        },
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
      const created = await prisma.invoice.create({
        data: {
          id: record.invoiceId ? String(record.invoiceId) : undefined,
          code,
          customerId,
          projectId,
          issuedDate: record.invoiceDate ? new Date(String(record.invoiceDate)) : new Date(),
          dueDate: record.dueDate ? new Date(String(record.dueDate)) : null,
          subtotal: Number(record.netAmount || 0),
          taxTotal: Number(record.gstAmount || 0),
          total,
          outstanding: total,
          status: "DRAFT",
          createdBy: actor,
        },
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

      const total = Number(record.totalAmount || 0);
      const created = await prisma.supplierBill.create({
        data: {
          id: record.billId ? String(record.billId) : undefined,
          code,
          supplierId,
          projectId,
          billDate: record.billDate ? new Date(String(record.billDate)) : new Date(),
          dueDate: record.dueDate ? new Date(String(record.dueDate)) : null,
          subtotal: Number(record.netAmount || 0),
          taxTotal: Number(record.gstAmount || 0),
          total,
          outstanding: total,
          status: "DRAFT",
          orderId: record.orderId ? String(record.orderId) : null,
          poReference: record.sourceDocumentId ? String(record.sourceDocumentId) : null,
          sourceDocId: record.sourceDocumentId ? String(record.sourceDocumentId) : null,
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
      const statusStr = patch.status ? String(patch.status).toUpperCase() : "";
      let poStatus: any = undefined;
      if (statusStr) {
        if (statusStr === "APPROVED") poStatus = "SENT";
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
      return mapPurchaseOrder(updated) as T;
    }

    case "Quotes": {
      const existing = await prisma.quote.findFirst({
        where: { OR: [{ id: idValue }, { code: idValue }] },
      });
      if (!existing) throw new Error(`Quote ${idValue} not found`);
      const statusStr = patch.status ? String(patch.status).toUpperCase() : "";
      let quoteStatus: any = undefined;
      if (statusStr) {
        if (statusStr === "APPROVED") quoteStatus = "ACCEPTED";
        else if (statusStr === "CANCELLED" || statusStr === "CANCEL") quoteStatus = "CANCELLED";
        else if (statusStr === "DRAFT") quoteStatus = "DRAFT";
        else if (statusStr === "SENT") quoteStatus = "SENT";
        else quoteStatus = "ACCEPTED";
      }
      const updated = await prisma.quote.update({
        where: { id: existing.id },
        data: {
          status: quoteStatus,
        },
      });
      return mapQuote(updated) as T;
    }

    case "Invoices": {
      const existing = await prisma.invoice.findFirst({
        where: { OR: [{ id: idValue }, { code: idValue }] },
      });
      if (!existing) throw new Error(`Invoice ${idValue} not found`);
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
          outstanding: patch.outstandingAmount !== undefined ? Number(patch.outstandingAmount) : undefined,
        },
      });
      return mapInvoice(updated) as T;
    }

    case "SupplierBills": {
      const existing = await prisma.supplierBill.findFirst({
        where: { OR: [{ id: idValue }, { code: idValue }] },
      });
      if (!existing) throw new Error(`SupplierBill ${idValue} not found`);
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
          outstanding: patch.outstandingAmount !== undefined ? Number(patch.outstandingAmount) : undefined,
          amountPaid: patch.paidAmount !== undefined ? Number(patch.paidAmount) : undefined,
          journalId: patch.journalId ? String(patch.journalId) : undefined,
        },
      });
      return mapSupplierBill(updated) as T;
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

  if (convertedCount > 0 || sourceDocCount > 0 || String(existing.status).toUpperCase() === "CONVERTED") {
    throw new Error("Cannot delete quotation: quotation has already been converted to a sales invoice or has linked transactions.");
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

  const [paymentCount, creditNoteCount] = await Promise.all([
    prisma.payment.count({ where: { invoiceId: existing.id } }),
    prisma.creditNote.count({ where: { originalInvoiceId: existing.id } }),
  ]);

  const reasons: string[] = [];
  if (existing.glPosted || existing.journalId) reasons.push(`General Ledger journal entry posted (${existing.journalId || "GL"})`);
  if (paymentCount > 0) reasons.push(`${paymentCount} payment(s)`);
  if (creditNoteCount > 0) reasons.push(`${creditNoteCount} credit note(s)`);
  if (Number(existing.amountPaid || 0) > 0) reasons.push(`amount paid K${Number(existing.amountPaid).toFixed(2)}`);

  if (reasons.length > 0) {
    throw new Error(`Cannot delete sales invoice: invoice already has accounts ledger entries or transactions (${reasons.join(", ")}).`);
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
  if (billCount > 0) reasons.push(`${billCount} supplier bill(s)`);
  if (receiptCount > 0) reasons.push(`${receiptCount} goods receipt(s)`);
  if (existing.billId) reasons.push(`converted bill reference (${existing.billId})`);

  if (reasons.length > 0) {
    throw new Error(`Cannot delete purchase order / quotation: document already has linked bills or goods receipts (${reasons.join(", ")}).`);
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
    prisma.payment.count({ where: { billId: existing.id } }),
    prisma.landedCostVoucher.count({ where: { billId: existing.id } }),
  ]);

  const reasons: string[] = [];
  if (existing.glPosted || existing.journalId) reasons.push(`General Ledger journal entry posted (${existing.journalId || "GL"})`);
  if (paymentCount > 0) reasons.push(`${paymentCount} payment(s)`);
  if (landedCostCount > 0) reasons.push(`${landedCostCount} landed cost voucher(s)`);
  if (Number(existing.amountPaid || 0) > 0) reasons.push(`amount paid K${Number(existing.amountPaid).toFixed(2)}`);

  if (reasons.length > 0) {
    throw new Error(`Cannot delete supplier invoice: bill already has accounts ledger entries or payments (${reasons.join(", ")}).`);
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

  const reasons: string[] = [];
  if (existing.status === "CLEARED" || existing.status === "CAPTURED") reasons.push(`payment status is ${existing.status}`);
  if (existing.clearanceDate) reasons.push("bank clearance recorded");

  if (reasons.length > 0) {
    throw new Error(`Cannot delete payment: payment has already been finalized or cleared (${reasons.join(", ")}).`);
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

  if (reasons.length > 0) {
    throw new Error(`Cannot delete expense: expense already has accounts ledger entries (${reasons.join(", ")}).`);
  }

  await prisma.expense.delete({ where: { id: existing.id } });
  return { deleted: true, expenseId: existing.id, expenseNumber: existing.code };
}


