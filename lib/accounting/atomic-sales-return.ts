import { runAtomicAccounting, type AtomicPostingLine } from "@/lib/accounting/atomic-posting";
import { INITIAL_ACCOUNT_IDS } from "@/lib/accounting/chart-of-accounts";
import { ensurePaymentScheduleInfrastructure, findPaymentSchedules, updatePaymentSchedule } from "@/lib/accounting/payment-schedule-store";
import { round2, round4 } from "@/lib/accounting/inventory";
import { normalizeAccountingDate } from "@/lib/accounting/loan";
import { prisma } from "@/src/lib/prisma";
import { resolveWarehouse, syncWarehouseBalance, warehouseInventoryState } from "@/lib/accounting/warehouse-stock";
import { assertSettlementCurrency, resolveDocumentExchangeRate, toBaseAmount } from "@/lib/accounting/currency";

export type AtomicSalesCreditNoteInput = {
  creditNoteId: string;
  approveIfDraft?: boolean;
  createdBy?: string;
  approvedBy?: string;
};

export async function postSalesCreditNoteAtomic(input: AtomicSalesCreditNoteInput) {
  await ensurePaymentScheduleInfrastructure(prisma);

  return runAtomicAccounting(async ({ tx, postJournal }) => {
    const credit = await tx.invoice.findFirst({
      where: { OR: [{ id: input.creditNoteId }, { code: input.creditNoteId }] },
      include: {
        customer: { select: { code: true } },
        project: { select: { code: true } },
        lines: {
          include: { item: true },
          orderBy: { lineNo: "asc" },
        },
      },
    });
    if (!credit || !credit.code.toUpperCase().startsWith("CN-")) {
      throw new Error("Document is not a Sales Credit Note");
    }

    if (credit.glPosted && credit.journalId) {
      return {
        recordType: "invoice" as const,
        recordId: credit.id,
        status: "already-posted" as const,
        journalId: credit.journalId,
        originalInvoiceId: credit.sourceDocId || "",
        arCredit: 0,
        customerCredit: 0,
        stockReturned: 0,
        alreadyPosted: true,
      };
    }

    if (credit.status === "DRAFT") {
      if (!input.approveIfDraft) {
        throw new Error("Sales Credit Note must be APPROVED before posting");
      }
    } else if (credit.status !== "SENT") {
      throw new Error(`Sales Credit Note cannot be posted from status ${credit.status}`);
    }

    const originalRef = String(credit.sourceDocId || "").trim();
    if (!originalRef) throw new Error("Credit Note has no original Sales Invoice reference");

    const original = await tx.invoice.findFirst({
      where: { OR: [{ id: originalRef }, { code: originalRef }] },
      include: {
        customer: { select: { code: true } },
        project: { select: { code: true } },
      },
    });
    if (!original || original.code.toUpperCase().startsWith("CN-")) {
      throw new Error("Original Sales Invoice not found");
    }
    if (!original.glPosted || !["SENT", "PARTIAL", "PAID"].includes(original.status)) {
      throw new Error("Original Sales Invoice is not posted");
    }
    if (original.customerId !== credit.customerId) {
      throw new Error("Credit Note customer does not match the original Sales Invoice");
    }
    assertSettlementCurrency(credit.currency, original.currency);
    const originalFx = await resolveDocumentExchangeRate(tx, {
      currency: original.currency,
      exchangeRate: Number(original.exchangeRate || 0) || undefined,
      postingDate: original.issuedDate,
    });
    const creditFx = {
      currency: originalFx.currency,
      baseCurrency: originalFx.baseCurrency,
      exchangeRate: originalFx.exchangeRate,
    };
    if (!credit.lines.length) throw new Error("Credit Note has no lines");

    const reasons = await findPaymentSchedules("SALES_RETURN_REASON", credit.id, tx);
    const reason = reasons.find((row) => String(row.status || "").toUpperCase() !== "CANCELLED");
    if (!reason) throw new Error("Credit Note reason is missing");

    const customerRef = credit.customer?.code || credit.customerId;
    const projectRef = credit.project?.code || credit.projectId || original.project?.code || original.projectId || "";
    const postingLines: AtomicPostingLine[] = [];

    const revenue = new Map<string, number>();
    for (const line of credit.lines) {
      const accountId = String(
        line.revenueAccount
        || line.item?.revenueAccount
        || "ACC-4100",
      );
      const amount = round2(Number(line.amount || 0));
      if (amount > 0) {
        revenue.set(accountId, round2((revenue.get(accountId) || 0) + amount));
      }
    }
    for (const [accountId, amount] of revenue.entries()) {
      postingLines.push({
        accountId,
        debit: toBaseAmount(amount, creditFx.currency, creditFx.baseCurrency, creditFx.exchangeRate),
        transactionCurrency: creditFx.currency,
        exchangeRate: creditFx.exchangeRate,
        transactionDebit: amount,
        transactionCredit: 0,
        customerId: customerRef,
        projectId: projectRef,
        description: "Sales return / revenue reversal",
      });
    }

    const gst = round2(Number(credit.taxTotal || 0));
    if (gst > 0) {
      postingLines.push({
        accountId: INITIAL_ACCOUNT_IDS.gstPayable,
        debit: toBaseAmount(gst, creditFx.currency, creditFx.baseCurrency, creditFx.exchangeRate),
        transactionCurrency: creditFx.currency,
        exchangeRate: creditFx.exchangeRate,
        transactionDebit: gst,
        transactionCredit: 0,
        customerId: customerRef,
        projectId: projectRef,
        taxCode: "GST",
        description: "Reverse Output GST",
      });
    }

    const originalOutstanding = round2(Number(original.outstanding || 0));
    const creditTotal = round2(Number(credit.total || 0));
    const arCredit = round2(Math.min(originalOutstanding, creditTotal));
    const customerCredit = round2(Math.max(0, creditTotal - arCredit));

    if (arCredit > 0) {
      postingLines.push({
        accountId: INITIAL_ACCOUNT_IDS.accountsReceivable,
        credit: toBaseAmount(arCredit, originalFx.currency, originalFx.baseCurrency, originalFx.exchangeRate),
        transactionCurrency: originalFx.currency,
        exchangeRate: originalFx.exchangeRate,
        transactionDebit: 0,
        transactionCredit: arCredit,
        customerId: customerRef,
        projectId: projectRef,
        description: "Reduce Accounts Receivable",
      });
    }
    if (customerCredit > 0) {
      postingLines.push({
        accountId: INITIAL_ACCOUNT_IDS.customerAdvances,
        credit: toBaseAmount(customerCredit, originalFx.currency, originalFx.baseCurrency, originalFx.exchangeRate),
        transactionCurrency: originalFx.currency,
        exchangeRate: originalFx.exchangeRate,
        transactionDebit: 0,
        transactionCredit: customerCredit,
        customerId: customerRef,
        projectId: projectRef,
        description: "Customer credit / refundable balance",
      });
    }

    const originalIssueWhere: any[] = [
      { type: "SALES_ISSUE", referenceId: original.id },
    ];
    if (original.sourceDocId) {
      originalIssueWhere.push({ type: "SALES_DELIVERY", referenceId: original.sourceDocId });
    }
    const originalIssues = await tx.stockMovement.findMany({
      where: { OR: originalIssueWhere },
      orderBy: { createdAt: "asc" },
    });

    const priorCredits = await tx.invoice.findMany({
      where: {
        id: { not: credit.id },
        sourceDocId: original.id,
        glPosted: true,
      },
      select: { id: true },
    });
    const priorCreditIds = priorCredits.map((row) => row.id);
    const priorReturns = priorCreditIds.length
      ? await tx.stockMovement.findMany({
          where: {
            type: "RETURN_IN",
            referenceId: { in: priorCreditIds },
          },
          select: { itemId: true, quantity: true, warehouseId: true },
        })
      : [];
    const priorReturnedByItem = new Map<string, number>();
    const priorReturnedByWarehouse = new Map<string, number>();
    for (const movement of priorReturns) {
      priorReturnedByItem.set(
        movement.itemId,
        (priorReturnedByItem.get(movement.itemId) || 0) + Number(movement.quantity || 0),
      );
      const warehouse = await resolveWarehouse(tx, movement.warehouseId);
      const key = `${movement.itemId}|${warehouse.id}`;
      priorReturnedByWarehouse.set(
        key,
        (priorReturnedByWarehouse.get(key) || 0) + Number(movement.quantity || 0),
      );
    }

    const existingReturns = await tx.stockMovement.findMany({
      where: {
        type: "RETURN_IN",
        referenceId: credit.id,
      },
    });
    if (existingReturns.length) {
      throw new Error("Existing Sales Return stock movement found without a posted Credit Note journal; manual review required");
    }

    const createdReturnIds: string[] = [];
    const cogsCredits = new Map<string, number>();
    let inventoryDebit = 0;

    for (const [index, line] of credit.lines.entries()) {
      if (!line.item || line.item.type !== "GOOD") continue;

      const itemIssues = originalIssues.filter((movement) => movement.itemId === line.itemId);
      const issuedQty = itemIssues.reduce(
        (sum, movement) => sum + Number(movement.quantity || 0),
        0,
      );
      if (issuedQty <= 0.0001) {
        throw new Error(`Original stock issue not found for ${line.item.code}`);
      }

      const alreadyReturned = Number(priorReturnedByItem.get(line.itemId || "") || 0);
      const returnQty = Number(line.quantity || 0);
      if (returnQty > issuedQty - alreadyReturned + 0.0001) {
        throw new Error(
          `Return quantity for ${line.item.code} exceeds remaining issued quantity ${Math.max(0, issuedQty - alreadyReturned)}`,
        );
      }

      const issueGroups = new Map<string, {
        warehouseId: string;
        qty: number;
        value: number;
      }>();
      for (const movement of itemIssues) {
        const warehouse = await resolveWarehouse(tx, movement.warehouseId);
        const group = issueGroups.get(warehouse.id) || {
          warehouseId: warehouse.id,
          qty: 0,
          value: 0,
        };
        group.qty += Number(movement.quantity || 0);
        group.value += Math.abs(Number(
          movement.totalCost
          ?? (Number(movement.quantity || 0) * Number(movement.unitCost || 0)),
        ));
        issueGroups.set(warehouse.id, group);
      }

      let remainingReturn = returnQty;
      let fragment = 0;
      for (const [warehouseKey, group] of issueGroups.entries()) {
        if (remainingReturn <= 0.0001) break;
        const priorAtWarehouse = Number(
          priorReturnedByWarehouse.get(`${line.itemId || ""}|${warehouseKey}`) || 0,
        );
        const availableAtWarehouse = Math.max(0, group.qty - priorAtWarehouse);
        if (availableAtWarehouse <= 0.0001) continue;

        const qtyToReturn = Math.min(remainingReturn, availableAtWarehouse);
        const costRate = group.qty > 0 ? group.value / group.qty : 0;
        const value = round2(qtyToReturn * costRate);
        inventoryDebit = round2(inventoryDebit + value);

        const costAccountId = String(line.item.costAccount || "ACC-5100");
        cogsCredits.set(
          costAccountId,
          round2((cogsCredits.get(costAccountId) || 0) + value),
        );

        const warehouse = await resolveWarehouse(tx, group.warehouseId);
        const current = await warehouseInventoryState(
          tx,
          line.item.id,
          warehouse.id,
          Number(line.item.purchasePrice || 0),
        );

        fragment += 1;
        const movementId = `RET-STK-${credit.id}-${String(index + 1).padStart(3, "0")}-${String(fragment).padStart(2, "0")}`;
        await tx.stockMovement.create({
          data: {
            id: movementId,
            itemId: line.item.id,
            warehouseId: warehouse.id,
            type: "RETURN_IN",
            quantity: qtyToReturn,
            unitCost: round4(costRate),
            totalCost: value,
            referenceType: "SALES_RETURN",
            referenceId: credit.id,
            projectId: credit.projectId || original.projectId || null,
            createdAt: new Date(credit.issuedDate),
            createdBy: input.createdBy || "sales-return:stock",
          },
        });
        createdReturnIds.push(movementId);

        const nextQty = round4(current.qty + qtyToReturn);
        const nextValue = round2(current.value + value);
        await syncWarehouseBalance(tx, {
          itemId: line.item.id,
          warehouseId: warehouse.id,
          quantity: nextQty,
          value: nextValue,
          rate: nextQty > 0 ? round4(nextValue / nextQty) : round4(costRate),
        });

        remainingReturn = round4(remainingReturn - qtyToReturn);
      }

      if (remainingReturn > 0.0001) {
        throw new Error(
          `Return quantity for ${line.item.code} could not be matched back to the original issuing warehouse(s)`,
        );
      }
    }

    if (inventoryDebit > 0) {
      postingLines.push({
        accountId: INITIAL_ACCOUNT_IDS.inventory,
        debit: inventoryDebit,
        transactionCurrency: originalFx.baseCurrency,
        exchangeRate: 1,
        transactionDebit: inventoryDebit,
        transactionCredit: 0,
        customerId: customerRef,
        projectId: projectRef,
        description: "Inventory returned by customer",
      });
    }
    for (const [accountId, amount] of cogsCredits.entries()) {
      postingLines.push({
        accountId,
        credit: amount,
        transactionCurrency: originalFx.baseCurrency,
        exchangeRate: 1,
        transactionDebit: 0,
        transactionCredit: amount,
        customerId: customerRef,
        projectId: projectRef,
        description: "Reverse cost of goods sold",
      });
    }

    // Approval, AR settlement, return stock and reason status intentionally
    // move before journal persistence. Any posting failure rolls all of them back.
    await tx.invoice.update({
      where: { id: credit.id },
      data: {
        status: "SENT",
        glPosted: true,
        approvedBy: input.approvedBy || credit.approvedBy || "Finance Controller",
        approvedAt: credit.approvedAt || new Date(),
      },
    });

    const newPaid = round2(Math.min(
      Number(original.total || 0),
      Number(original.amountPaid || 0) + arCredit,
    ));
    const newOutstanding = round2(Math.max(0, Number(original.total || 0) - newPaid));
    const originalBaseTotal = Number(original.baseTotal || 0) > 0
      ? Number(original.baseTotal)
      : toBaseAmount(Number(original.total || 0), originalFx.currency, originalFx.baseCurrency, originalFx.exchangeRate);
    const creditBaseAgainstAr = toBaseAmount(arCredit, originalFx.currency, originalFx.baseCurrency, originalFx.exchangeRate);
    const newBasePaid = round2(Math.min(
      originalBaseTotal,
      Number(original.baseAmountPaid || 0) + creditBaseAgainstAr,
    ));
    const newBaseOutstanding = round2(Math.max(0, originalBaseTotal - newBasePaid));
    await tx.invoice.update({
      where: { id: original.id },
      data: {
        amountPaid: newPaid,
        outstanding: newOutstanding,
        baseAmountPaid: newBasePaid,
        baseOutstanding: newBaseOutstanding,
        status: newOutstanding <= 0.001
          ? "PAID"
          : newPaid > 0.001
            ? "PARTIAL"
            : "SENT",
      },
    });

    await updatePaymentSchedule(reason.scheduleId, { status: "POSTED" }, tx);

    const journal = await postJournal({
      postingDate: normalizeAccountingDate(credit.issuedDate.toISOString()),
      documentType: "SALES_CREDIT_NOTE",
      documentId: credit.id,
      documentNumber: credit.code,
      reference: String(reason.milestone || `Credit Note ${credit.code}`),
      projectId: projectRef,
      currency: creditFx.currency,
      baseCurrency: creditFx.baseCurrency,
      exchangeRate: creditFx.exchangeRate,
      createdBy: input.createdBy || "sales-return:post",
      approvedBy: input.approvedBy || "Finance Controller",
      lines: postingLines,
    });

    if (createdReturnIds.length) {
      await tx.stockMovement.updateMany({
        where: { id: { in: createdReturnIds } },
        data: { journalId: journal.journalId },
      });
    }
    await tx.invoice.update({
      where: { id: credit.id },
      data: {
        journalId: journal.journalId,
        exchangeRate: creditFx.exchangeRate,
        baseSubtotal: toBaseAmount(Number(credit.subtotal || 0), creditFx.currency, creditFx.baseCurrency, creditFx.exchangeRate),
        baseTaxTotal: toBaseAmount(Number(credit.taxTotal || 0), creditFx.currency, creditFx.baseCurrency, creditFx.exchangeRate),
        baseTotal: toBaseAmount(Number(credit.total || 0), creditFx.currency, creditFx.baseCurrency, creditFx.exchangeRate),
        baseOutstanding: 0,
      },
    });

    return {
      recordType: "invoice" as const,
      recordId: credit.id,
      status: "POSTED" as const,
      journalId: journal.journalId,
      originalInvoiceId: original.id,
      arCredit,
      customerCredit,
      stockReturned: createdReturnIds.length,
      alreadyPosted: false,
    };
  });
}
