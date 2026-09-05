import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import {
  appendRecord,
  batchAppend,
  findRecords,
  listTable,
  updateRecord,
} from "@/lib/backend/apps-script";
import {
  expensePosting,
  postJournal,
  receiptPosting,
  salesInvoicePostingByLines,
  supplierBillPostingByLines,
  supplierPaymentPosting,
} from "@/lib/accounting/posting";

const text = z.string().trim();
const optionalText = text.optional().default("");
const money = z.coerce.number().finite().nonnegative();
const qty = z.coerce.number().finite().positive();

const lineSchema = z.object({
  itemId: optionalText,
  description: text.min(1),
  qty: qty.default(1),
  uom: optionalText.default("Each"),
  rate: money,
});

const commercialSchema = z.object({
  documentNumber: optionalText,
  partyId: text.min(1),
  projectId: optionalText,
  documentDate: text.min(8),
  dueDate: optionalText,
  expiryDate: optionalText,
  gstRate: z.coerce.number().finite().min(0).max(1).default(0),
  accountId: optionalText,
  poId: optionalText,
  lines: z.array(lineSchema).min(1),
});

const paymentSchema = z.object({
  paymentNumber: optionalText,
  paymentType: z.enum(["RECEIVE", "PAY"]),
  partyType: z.enum(["Customer", "Supplier"]),
  partyId: text.min(1),
  projectId: optionalText,
  paymentDate: text.min(8),
  amount: money.refine(
    (value) => value > 0,
    "Amount must be greater than zero",
  ),
  paymentMethod: text.min(1),
  cashBankAccountId: text.min(1),
  reference: optionalText,
  againstDocumentType: optionalText,
  againstDocumentId: optionalText,
});

const expenseSchema = z.object({
  expenseNumber: optionalText,
  expenseDate: text.min(8),
  supplierId: optionalText,
  projectId: optionalText,
  expenseAccountId: text.min(1),
  description: text.min(1),
  netAmount: money,
  gstAmount: money.default(0),
  paymentMethod: text.min(1),
  cashBankAccountId: text.min(1),
});

const postSchema = z.object({
  recordType: z.enum([
    "invoice",
    "supplierBill",
    "payment",
    "expense",
  ]),
  recordId: text.min(1),
});

const round2 = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

function requireSecret(secret?: string) {
  if (!env.APP_SECRET) {
    throw new Error("APP_SECRET is not configured");
  }

  if (!secret || secret !== env.APP_SECRET) {
    throw new Error("Unauthorized");
  }
}

function id(prefix: string) {
  return `${prefix}-${new Date().getUTCFullYear()}-${randomUUID()
    .slice(0, 8)
    .toUpperCase()}`;
}

function totals(
  lines: z.infer<typeof lineSchema>[],
  gstRate: number,
) {
  const normalized = lines.map((line, index) => {
    const netAmount = round2(line.qty * line.rate);
    const gstAmount = round2(netAmount * gstRate);

    return {
      ...line,
      lineNo: index + 1,
      netAmount,
      gstAmount,
      totalAmount: round2(netAmount + gstAmount),
    };
  });

  const net = round2(
    normalized.reduce(
      (sum, line) => sum + line.netAmount,
      0,
    ),
  );

  const gst = round2(
    normalized.reduce(
      (sum, line) => sum + line.gstAmount,
      0,
    ),
  );

  return {
    lines: normalized,
    net,
    gst,
    total: round2(net + gst),
  };
}

async function gstStatus() {
  const result = await findRecords<{
    key: string;
    value: string;
  }>(
    "Settings",
    { key: "gst_status" },
    1,
  );

  return String(
    result.rows[0]?.value || "UNVERIFIED",
  ).toUpperCase();
}

async function assertParty(
  table: "Customers" | "Suppliers",
  idField: "customerId" | "supplierId",
  value: string,
) {
  const result = await findRecords(
    table,
    { [idField]: value },
    1,
  );

  if (!result.rows.length) {
    throw new Error(
      `${
        table === "Customers"
          ? "Customer"
          : "Supplier"
      } does not exist`,
    );
  }
}

async function assertProject(projectId: string) {
  if (!projectId) return;

  const result = await findRecords(
    "Projects",
    { projectId },
    1,
  );

  if (!result.rows.length) {
    throw new Error("Project does not exist");
  }
}

async function createCommercial(
  type:
    | "quote"
    | "purchaseOrder"
    | "invoice"
    | "supplierBill",
  raw: unknown,
) {
  const parsed = commercialSchema.parse(raw);

  const isSales =
    type === "quote" ||
    type === "invoice";

  await assertParty(
    isSales ? "Customers" : "Suppliers",
    isSales ? "customerId" : "supplierId",
    parsed.partyId,
  );

  await assertProject(parsed.projectId);

  const t = totals(
    parsed.lines,
    parsed.gstRate,
  );

  /*
   * -------------------------------------------
   * QUOTATION
   * -------------------------------------------
   */

  if (type === "quote") {
    const quoteId = id("QT");
    const quoteNumber =
      parsed.documentNumber || quoteId;

    await appendRecord(
      "Quotes",
      {
        quoteId,
        quoteNumber,
        customerId: parsed.partyId,
        projectId: parsed.projectId,
        quoteDate: parsed.documentDate,
        expiryDate: parsed.expiryDate,
        netAmount: t.net,
        gstAmount: t.gst,
        totalAmount: t.total,
        status: "DRAFT",
        sourceDocumentId: "",
      },
      "transaction-ui",
    );

    await batchAppend(
      "QuoteLines",
      t.lines.map((line) => ({
        quoteLineId: `${quoteId}-${String(
          line.lineNo,
        ).padStart(3, "0")}`,
        quoteId,
        ...line,
      })),
      "transaction-ui",
    );

    return {
      type,
      recordId: quoteId,
      documentNumber: quoteNumber,
      totals: t,
      status: "DRAFT",
    };
  }

  /*
   * -------------------------------------------
   * PURCHASE ORDER
   * -------------------------------------------
   */

  if (type === "purchaseOrder") {
    const poId = id("PO");
    const poNumber =
      parsed.documentNumber || poId;

    await appendRecord(
      "PurchaseOrders",
      {
        poId,
        poNumber,
        supplierId: parsed.partyId,
        projectId: parsed.projectId,
        poDate: parsed.documentDate,
        netAmount: t.net,
        gstAmount: t.gst,
        totalAmount: t.total,
        status: "DRAFT",
        sourceDocumentId: "",
      },
      "transaction-ui",
    );

    await batchAppend(
      "POLines",
      t.lines.map((line) => ({
        poLineId: `${poId}-${String(
          line.lineNo,
        ).padStart(3, "0")}`,
        poId,
        ...line,
      })),
      "transaction-ui",
    );

    return {
      type,
      recordId: poId,
      documentNumber: poNumber,
      totals: t,
      status: "DRAFT",
    };
  }

  /*
   * -------------------------------------------
   * SALES INVOICE
   * -------------------------------------------
   */

  if (type === "invoice") {
    const invoiceId = id("INV");
    const invoiceNumber =
      parsed.documentNumber || invoiceId;

    await appendRecord(
      "Invoices",
      {
        invoiceId,
        invoiceNumber,
        customerId: parsed.partyId,
        projectId: parsed.projectId,
        invoiceDate: parsed.documentDate,
        dueDate: parsed.dueDate,
        netAmount: t.net,
        gstAmount: t.gst,
        totalAmount: t.total,
        paidAmount: 0,
        outstandingAmount: t.total,
        status: "DRAFT",
        sourceDocumentId: "",
        journalId: "",
      },
      "transaction-ui",
    );

    await batchAppend(
      "InvoiceLines",
      t.lines.map((line) => ({
        invoiceLineId: `${invoiceId}-${String(
          line.lineNo,
        ).padStart(3, "0")}`,
        invoiceId,
        ...line,
        revenueAccountId:
          parsed.accountId || "ACC-4100",
      })),
      "transaction-ui",
    );

    return {
      type,
      recordId: invoiceId,
      documentNumber: invoiceNumber,
      totals: t,
      status: "DRAFT",
    };
  }

  /*
   * -------------------------------------------
   * SUPPLIER BILL
   * -------------------------------------------
   */

  const billId = id("BILL");

  const billNumber =
    parsed.documentNumber || billId;

  await appendRecord(
    "SupplierBills",
    {
      billId,
      billNumber,
      supplierId: parsed.partyId,
      projectId: parsed.projectId,
      billDate: parsed.documentDate,
      dueDate: parsed.dueDate,
      poId: parsed.poId,
      netAmount: t.net,
      gstAmount: t.gst,
      totalAmount: t.total,
      paidAmount: 0,
      outstandingAmount: t.total,
      status: "DRAFT",
      sourceDocumentId: "",
      journalId: "",
    },
    "transaction-ui",
  );

  await batchAppend(
    "SupplierBillLines",
    t.lines.map((line) => ({
      billLineId: `${billId}-${String(
        line.lineNo,
      ).padStart(3, "0")}`,
      billId,
      ...line,
      costAccountId:
        parsed.accountId || "ACC-5100",
    })),
    "transaction-ui",
  );

  return {
    type,
    recordId: billId,
    documentNumber: billNumber,
    totals: t,
    status: "DRAFT",
  };
}

/*
 * -------------------------------------------
 * PAYMENT
 * -------------------------------------------
 */

async function createPayment(raw: unknown) {
  const parsed =
    paymentSchema.parse(raw);

  if (
    parsed.paymentType === "RECEIVE" &&
    parsed.partyType !== "Customer"
  ) {
    throw new Error(
      "Receive payments must use a Customer",
    );
  }

  if (
    parsed.paymentType === "PAY" &&
    parsed.partyType !== "Supplier"
  ) {
    throw new Error(
      "Supplier payments must use a Supplier",
    );
  }

  await assertParty(
    parsed.partyType === "Customer"
      ? "Customers"
      : "Suppliers",
    parsed.partyType === "Customer"
      ? "customerId"
      : "supplierId",
    parsed.partyId,
  );

  await assertProject(
    parsed.projectId,
  );

  const paymentId = id("PAY");

  const paymentNumber =
    parsed.paymentNumber ||
    paymentId;

  /*
   * IMPORTANT:
   * parsed is spread first.
   * Generated paymentId/paymentNumber are applied afterwards
   * to avoid duplicate-property TS2783 errors and ensure the
   * final generated values cannot be overwritten.
   */

  await appendRecord(
    "Payments",
    {
      ...parsed,
      paymentId,
      paymentNumber,
      sourceDocumentId: "",
      journalId: "",
      status: "DRAFT",
    },
    "transaction-ui",
  );

  return {
    type: "payment",
    recordId: paymentId,
    documentNumber: paymentNumber,
    status: "DRAFT",
  };
}

/*
 * -------------------------------------------
 * EXPENSE
 * -------------------------------------------
 */

async function createExpense(raw: unknown) {
  const parsed =
    expenseSchema.parse(raw);

  if (parsed.supplierId) {
    await assertParty(
      "Suppliers",
      "supplierId",
      parsed.supplierId,
    );
  }

  await assertProject(
    parsed.projectId,
  );

  const expenseId =
    id("EXP");

  const expenseNumber =
    parsed.expenseNumber ||
    expenseId;

  const totalAmount =
    round2(
      parsed.netAmount +
        parsed.gstAmount,
    );

  /*
   * IMPORTANT:
   * parsed is spread first.
   * Generated expenseId/expenseNumber are applied afterwards.
   */

  await appendRecord(
    "Expenses",
    {
      ...parsed,
      expenseId,
      expenseNumber,
      totalAmount,
      sourceDocumentId: "",
      journalId: "",
      status: "DRAFT",
    },
    "transaction-ui",
  );

  return {
    type: "expense",
    recordId: expenseId,
    documentNumber:
      expenseNumber,
    totalAmount,
    status: "DRAFT",
  };
}

/*
 * -------------------------------------------
 * POST TRANSACTION
 * -------------------------------------------
 */

async function synchronizePaymentAllocation(row: any) {
  const againstId = String(row.againstDocumentId || "");
  if (!againstId) return;
  const receive = String(row.paymentType || "").toUpperCase() === "RECEIVE";

  const postedPayments = await findRecords<any>(
    "Payments",
    { againstDocumentId: againstId, status: "POSTED" },
    500,
  );
  const allocated = round2(
    postedPayments.rows
      .filter((payment: any) => receive
        ? String(payment.paymentType || "").toUpperCase() === "RECEIVE"
        : String(payment.paymentType || "").toUpperCase() === "PAY")
      .reduce((sum: number, payment: any) => sum + Number(payment.amount || 0), 0),
  );

  if (receive) {
    const inv = await findRecords<any>("Invoices", { invoiceId: againstId }, 1);
    const invoice = inv.rows[0];
    if (!invoice) return;
    const total = Number(invoice.totalAmount || 0);
    if (allocated > total + 0.001) throw new Error("Posted customer receipts exceed invoice total; allocation review required");
    const outstandingAmount = Math.max(0, round2(total - allocated));
    await updateRecord(
      "Invoices",
      "invoiceId",
      againstId,
      { paidAmount: allocated, outstandingAmount, status: outstandingAmount === 0 ? "PAID" : "POSTED" },
      "finance-controller",
    );
  } else {
    const billResult = await findRecords<any>("SupplierBills", { billId: againstId }, 1);
    const bill = billResult.rows[0];
    if (!bill) return;
    const total = Number(bill.totalAmount || 0);
    if (allocated > total + 0.001) throw new Error("Posted supplier payments exceed bill total; allocation review required");
    const outstandingAmount = Math.max(0, round2(total - allocated));
    await updateRecord(
      "SupplierBills",
      "billId",
      againstId,
      { paidAmount: allocated, outstandingAmount, status: outstandingAmount === 0 ? "PAID" : "POSTED" },
      "finance-controller",
    );
  }
}

async function postRecord(
  raw: unknown,
) {
  const parsed =
    postSchema.parse(raw);

  /*
   * SALES INVOICE
   */

  if (
    parsed.recordType ===
    "invoice"
  ) {
    const result =
      await findRecords<any>(
        "Invoices",
        {
          invoiceId:
            parsed.recordId,
        },
        1,
      );

    const row =
      result.rows[0];

    if (!row) {
      throw new Error(
        "Invoice not found",
      );
    }

    if (
      row.status === "POSTED"
    ) {
      return {
        recordType:
          parsed.recordType,
        recordId:
          parsed.recordId,
        status:
          "already-posted",
        journalId:
          row.journalId,
      };
    }

    if (
      Number(
        row.gstAmount || 0,
      ) > 0 &&
      (await gstStatus()) !==
        "VERIFIED"
    ) {
      throw new Error(
        "GST status is UNVERIFIED. Verify GST registration before posting GST-bearing invoices.",
      );
    }

    const lineResult =
      await findRecords<any>(
        "InvoiceLines",
        {
          invoiceId:
            parsed.recordId,
        },
        500,
      );

    if (!lineResult.rows.length) {
      throw new Error("Invoice has no lines");
    }

    const journal =
      await postJournal({
        postingDate: String(
          row.invoiceDate,
        ),
        documentType:
          "SALES_INVOICE",
        documentId:
          row.invoiceId,
        documentNumber:
          row.invoiceNumber,
        reference: `Sales invoice ${row.invoiceNumber}`,
        projectId:
          row.projectId,

        lines:
          salesInvoicePostingByLines({
            total: Number(row.totalAmount),
            gst: Number(row.gstAmount),
            customerId: row.customerId,
            projectId: row.projectId,
            revenueLines: lineResult.rows.map((line: any) => ({
              accountId: String(line.revenueAccountId || "ACC-4100"),
              amount: Number(line.netAmount || 0),
              description: String(line.description || "Sales revenue"),
            })),
          }),
      });

    await updateRecord(
      "Invoices",
      "invoiceId",
      row.invoiceId,
      {
        status: "POSTED",
        journalId:
          journal.journalId,
      },
      "finance-controller",
    );

    return {
      recordType:
        parsed.recordType,
      recordId:
        row.invoiceId,
      status: "POSTED",
      journalId:
        journal.journalId,
    };
  }

  /*
   * SUPPLIER BILL
   */

  if (
    parsed.recordType ===
    "supplierBill"
  ) {
    const result =
      await findRecords<any>(
        "SupplierBills",
        {
          billId:
            parsed.recordId,
        },
        1,
      );

    const row =
      result.rows[0];

    if (!row) {
      throw new Error(
        "Supplier bill not found",
      );
    }

    if (
      row.status === "POSTED"
    ) {
      if (row.poId) {
        const po = await findRecords<any>("PurchaseOrders", { poId: row.poId }, 1);
        if (po.rows[0] && String(po.rows[0].status || "").toUpperCase() !== "BILLED") {
          await updateRecord("PurchaseOrders", "poId", row.poId, { status: "BILLED" }, "finance-controller");
        }
      }
      return {
        recordType:
          parsed.recordType,
        recordId:
          parsed.recordId,
        status:
          "already-posted",
        journalId:
          row.journalId,
      };
    }

    if (
      Number(
        row.gstAmount || 0,
      ) > 0 &&
      (await gstStatus()) !==
        "VERIFIED"
    ) {
      throw new Error(
        "GST status is UNVERIFIED. Verify GST registration before posting input GST.",
      );
    }

    const lineResult =
      await findRecords<any>(
        "SupplierBillLines",
        {
          billId:
            parsed.recordId,
        },
        500,
      );

    if (!lineResult.rows.length) {
      throw new Error("Supplier bill has no lines");
    }

    if (row.poId) {
      const poResult = await findRecords<any>("PurchaseOrders", { poId: row.poId }, 1);
      const po = poResult.rows[0];
      if (!po) throw new Error("Referenced purchase order not found");
      if (String(po.supplierId || "") !== String(row.supplierId || "")) throw new Error("Supplier bill supplier does not match the purchase order");
      if (String(po.projectId || "") !== String(row.projectId || "")) throw new Error("Supplier bill project does not match the purchase order");
      if (Math.abs(Number(po.totalAmount || 0) - Number(row.totalAmount || 0)) > 0.01) {
        throw new Error("Supplier bill total does not match the purchase order total");
      }

      const poLines = await findRecords<any>("POLines", { poId: row.poId }, 500);
      const items = await listTable<any>("Items", 500, 0);
      const itemType = new Map(items.rows.map((item: any) => [String(item.itemId || ""), String(item.itemType || "").toUpperCase()]));
      const receipts = await findRecords<any>("StockMovements", { sourceDocumentId: row.poId }, 500);

      for (const poLine of poLines.rows) {
        const itemId = String(poLine.itemId || "");
        if (!itemId || itemType.get(itemId) !== "STOCK") continue;
        const ordered = Number(poLine.qty || 0);
        const received = receipts.rows
          .filter((movement: any) => String(movement.itemId || "") === itemId && String(movement.movementType || "") === "PURCHASE_RECEIPT")
          .reduce((sum: number, movement: any) => sum + Number(movement.qtyIn || 0), 0);
        if (received + 0.0001 < ordered) {
          throw new Error(`Three-way match failed for ${itemId}: ordered ${ordered}, received ${received}`);
        }
      }
    }

    const journal =
      await postJournal({
        postingDate: String(
          row.billDate,
        ),
        documentType:
          "SUPPLIER_BILL",
        documentId:
          row.billId,
        documentNumber:
          row.billNumber,
        reference: `Supplier bill ${row.billNumber}`,
        projectId:
          row.projectId,

        lines:
          supplierBillPostingByLines({
            total: Number(row.totalAmount),
            gst: Number(row.gstAmount),
            supplierId: row.supplierId,
            projectId: row.projectId,
            costLines: lineResult.rows.map((line: any) => ({
              accountId: String(line.costAccountId || "ACC-5100"),
              amount: Number(line.netAmount || 0),
              description: String(line.description || "Supplier cost"),
            })),
          }),
      });

    await updateRecord(
      "SupplierBills",
      "billId",
      row.billId,
      {
        status: "POSTED",
        journalId:
          journal.journalId,
      },
      "finance-controller",
    );
    if (row.poId) {
      await updateRecord("PurchaseOrders", "poId", row.poId, { status: "BILLED" }, "finance-controller");
    }

    return {
      recordType:
        parsed.recordType,
      recordId:
        row.billId,
      status: "POSTED",
      journalId:
        journal.journalId,
    };
  }

  /*
   * PAYMENT / RECEIPT
   */

  if (
    parsed.recordType ===
    "payment"
  ) {
    const result =
      await findRecords<any>(
        "Payments",
        {
          paymentId:
            parsed.recordId,
        },
        1,
      );

    const row =
      result.rows[0];

    if (!row) {
      throw new Error(
        "Payment not found",
      );
    }

    if (
      row.status === "POSTED"
    ) {
      await synchronizePaymentAllocation(row);
      return {
        recordType:
          parsed.recordType,
        recordId:
          parsed.recordId,
        status:
          "already-posted",
        journalId:
          row.journalId,
      };
    }

    const receive =
      row.paymentType ===
      "RECEIVE";

    if (row.againstDocumentId) {
      if (receive) {
        const inv = await findRecords<any>("Invoices", { invoiceId: row.againstDocumentId }, 1);
        const invoice = inv.rows[0];
        if (!invoice) throw new Error("Against invoice not found");
        if (String(invoice.customerId) !== String(row.partyId)) throw new Error("Payment customer does not match the against invoice");
        if (!["POSTED", "PAID"].includes(String(invoice.status).toUpperCase())) throw new Error("Customer receipt can only be allocated against a posted invoice");
        if (Number(row.amount) > Number(invoice.outstandingAmount || 0) + 0.001) throw new Error("Customer receipt exceeds invoice outstanding amount");
      } else {
        const billResult = await findRecords<any>("SupplierBills", { billId: row.againstDocumentId }, 1);
        const bill = billResult.rows[0];
        if (!bill) throw new Error("Against supplier bill not found");
        if (String(bill.supplierId) !== String(row.partyId)) throw new Error("Payment supplier does not match the against supplier bill");
        if (!["POSTED", "PAID"].includes(String(bill.status).toUpperCase())) throw new Error("Supplier payment can only be allocated against a posted supplier bill");
        if (Number(row.amount) > Number(bill.outstandingAmount || 0) + 0.001) throw new Error("Supplier payment exceeds bill outstanding amount");
      }
    }

    const lines = receive
      ? receiptPosting({
          amount: Number(
            row.amount,
          ),
          customerId:
            row.partyId,
          projectId:
            row.projectId,
          cashBankAccountId:
            row.cashBankAccountId,
        })
      : supplierPaymentPosting(
          {
            amount: Number(
              row.amount,
            ),
            supplierId:
              row.partyId,
            projectId:
              row.projectId,
            cashBankAccountId:
              row.cashBankAccountId,
          },
        );

    const journal =
      await postJournal({
        postingDate: String(
          row.paymentDate,
        ),

        documentType:
          receive
            ? "CUSTOMER_RECEIPT"
            : "SUPPLIER_PAYMENT",

        documentId:
          row.paymentId,

        documentNumber:
          row.paymentNumber,

        reference:
          row.reference ||
          row.paymentNumber,

        projectId:
          row.projectId,

        lines,
      });

    await updateRecord(
      "Payments",
      "paymentId",
      row.paymentId,
      {
        status: "POSTED",
        journalId:
          journal.journalId,
      },
      "finance-controller",
    );

    await synchronizePaymentAllocation({ ...row, status: "POSTED" });

    return {
      recordType:
        parsed.recordType,
      recordId:
        row.paymentId,
      status: "POSTED",
      journalId:
        journal.journalId,
    };
  }

  /*
   * EXPENSE
   */

  const result =
    await findRecords<any>(
      "Expenses",
      {
        expenseId:
          parsed.recordId,
      },
      1,
    );

  const row =
    result.rows[0];

  if (!row) {
    throw new Error(
      "Expense not found",
    );
  }

  if (
    row.status === "POSTED"
  ) {
    return {
      recordType:
        parsed.recordType,
      recordId:
        parsed.recordId,
      status:
        "already-posted",
      journalId:
        row.journalId,
    };
  }

  if (
    Number(
      row.gstAmount || 0,
    ) > 0 &&
    (await gstStatus()) !==
      "VERIFIED"
  ) {
    throw new Error(
      "GST status is UNVERIFIED. Verify GST registration before posting input GST.",
    );
  }

  const journal =
    await postJournal({
      postingDate: String(
        row.expenseDate,
      ),

      documentType:
        "EXPENSE",

      documentId:
        row.expenseId,

      documentNumber:
        row.expenseNumber,

      reference:
        row.description,

      projectId:
        row.projectId,

      lines:
        expensePosting({
          total: Number(
            row.totalAmount,
          ),
          net: Number(
            row.netAmount,
          ),
          gst: Number(
            row.gstAmount,
          ),
          supplierId:
            row.supplierId,
          projectId:
            row.projectId,
          expenseAccountId:
            row.expenseAccountId,
          cashBankAccountId:
            row.cashBankAccountId,
        }),
    });

  await updateRecord(
    "Expenses",
    "expenseId",
    row.expenseId,
    {
      status: "POSTED",
      journalId:
        journal.journalId,
    },
    "finance-controller",
  );

  return {
    recordType:
      parsed.recordType,
    recordId:
      row.expenseId,
    status: "POSTED",
    journalId:
      journal.journalId,
  };
}

/*
 * -------------------------------------------
 * GET
 * -------------------------------------------
 */

export async function GET() {
  try {
    const [
      quotes,
      purchaseOrders,
      invoices,
      supplierBills,
      payments,
      expenses,
    ] = await Promise.all([
      listTable(
        "Quotes",
        500,
        0,
      ),

      listTable(
        "PurchaseOrders",
        500,
        0,
      ),

      listTable(
        "Invoices",
        500,
        0,
      ),

      listTable(
        "SupplierBills",
        500,
        0,
      ),

      listTable(
        "Payments",
        500,
        0,
      ),

      listTable(
        "Expenses",
        500,
        0,
      ),
    ]);

    return NextResponse.json({
      ok: true,
      quotes:
        quotes.rows,
      purchaseOrders:
        purchaseOrders.rows,
      invoices:
        invoices.rows,
      supplierBills:
        supplierBills.rows,
      payments:
        payments.rows,
      expenses:
        expenses.rows,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Transaction read failed",
      },
      {
        status: 500,
      },
    );
  }
}

/*
 * -------------------------------------------
 * POST
 * -------------------------------------------
 */

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request.json()) as {
        secret?: string;
        action?: string;
        payload?: unknown;
      };

    requireSecret(
      body.secret,
    );

    let result: unknown;

    if (
      body.action ===
      "createQuote"
    ) {
      result =
        await createCommercial(
          "quote",
          body.payload,
        );
    } else if (
      body.action ===
      "createPurchaseOrder"
    ) {
      result =
        await createCommercial(
          "purchaseOrder",
          body.payload,
        );
    } else if (
      body.action ===
      "createInvoice"
    ) {
      result =
        await createCommercial(
          "invoice",
          body.payload,
        );
    } else if (
      body.action ===
      "createSupplierBill"
    ) {
      result =
        await createCommercial(
          "supplierBill",
          body.payload,
        );
    } else if (
      body.action ===
      "createPayment"
    ) {
      result =
        await createPayment(
          body.payload,
        );
    } else if (
      body.action ===
      "createExpense"
    ) {
      result =
        await createExpense(
          body.payload,
        );
    } else if (
      body.action ===
      "post"
    ) {
      result =
        await postRecord(
          body.payload,
        );
    } else {
      throw new Error(
        "Unsupported transaction action",
      );
    }

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    const message =
      error instanceof
      z.ZodError
        ? error.errors
            .map(
              (item) =>
                `${item.path.join(
                  ".",
                )}: ${
                  item.message
                }`,
            )
            .join("; ")
        : error instanceof Error
          ? error.message
          : "Transaction failed";

    const status =
      message ===
      "Unauthorized"
        ? 401
        : 400;

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      {
        status,
      },
    );
  }
}
