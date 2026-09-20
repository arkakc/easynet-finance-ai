import { runAtomicAccounting } from "@/lib/accounting/atomic-posting";
import { expensePosting } from "@/lib/accounting/posting-rules";

export type AtomicExpenseInput = {
  expenseId: string;
  postingDate: string;
  documentNumber: string;
  reference?: string;
  expenseAccountId: string;
  cashBankAccountId: string;
  approveIfDraft?: boolean;
  createdBy?: string;
  approvedBy?: string;
};

export async function finalizeExpenseAtomic(input: AtomicExpenseInput) {
  return runAtomicAccounting(async ({ tx, postJournal }) => {
    const expense = await tx.expense.findFirst({
      where: { OR: [{ id: input.expenseId }, { code: input.expenseId }] },
      include: {
        supplier: { select: { code: true } },
        project: { select: { code: true } },
      },
    });
    if (!expense) throw new Error("Expense not found");

    if (expense.glPosted && expense.journalId) {
      return {
        expenseId: expense.id,
        journalId: expense.journalId,
        status: "POSTED" as const,
        alreadyPosted: true,
      };
    }

    const approvedBy = input.approvedBy || expense.approvedBy || "Finance Controller";
    if (!expense.approvedAt && !input.approveIfDraft) {
      throw new Error("Expense must be APPROVED before posting");
    }

    // Approval and GL state intentionally move before journal persistence.
    // If journal validation/posting fails, Prisma rolls both changes back.
    await tx.expense.update({
      where: { id: expense.id },
      data: {
        approvedBy,
        approvedAt: expense.approvedAt || new Date(),
        glPosted: true,
      },
    });

    const supplierRef = expense.supplier?.code || expense.supplierId || undefined;
    const projectRef = expense.project?.code || expense.projectId || undefined;
    const total = Number(expense.total || 0);
    const net = Number(expense.amount || 0);
    const gst = Number(expense.taxAmount || 0);

    const journal = await postJournal({
      postingDate: input.postingDate,
      documentType: "EXPENSE",
      documentId: expense.id,
      documentNumber: input.documentNumber,
      reference: input.reference || expense.description || input.documentNumber,
      projectId: projectRef,
      createdBy: input.createdBy || "expense-posting",
      approvedBy,
      lines: expensePosting({
        total,
        net,
        gst,
        supplierId: supplierRef,
        projectId: projectRef,
        expenseAccountId: input.expenseAccountId,
        cashBankAccountId: input.cashBankAccountId,
      }),
    });

    await tx.expense.update({
      where: { id: expense.id },
      data: { journalId: journal.journalId },
    });

    return {
      expenseId: expense.id,
      journalId: journal.journalId,
      status: "POSTED" as const,
      alreadyPosted: false,
    };
  });
}
