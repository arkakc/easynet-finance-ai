import { NextResponse } from "next/server";
import { z } from "zod";
import { documentSeriesId } from "@/lib/accounting/document-numbering";
import { postJournal } from "@/lib/accounting/posting";
import { listTable } from "@/lib/backend/apps-script";
import { requireRequestPermission } from "@/lib/auth";

const lineSchema = z.object({
  accountId: z.string().trim().min(1, "Particular account is required"),
  description: z.string().trim().min(2, "Description is required").max(300),
  amount: z.coerce.number().finite().positive("Amount must be greater than zero"),
  projectId: z.string().trim().optional().default(""),
});

const schema = z.object({
  postingDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Posting date must be YYYY-MM-DD"),
  paymentType: z.enum(["CASH", "BANK"]),
  paidFromAccountId: z.string().trim().min(1, "Cash / Bank account is required"),
  payeeType: z.enum(["SUPPLIER", "EMPLOYEE", "CUSTOMER", "OWNER", "OTHER"]).optional().default("OTHER"),
  payeeName: z.string().trim().max(200).optional().default(""),
  reference: z.string().trim().min(3, "Reference is required").max(300),
  remarks: z.string().trim().max(500).optional().default(""),
  lines: z.array(lineSchema).min(1, "At least one particular line is required"),
});

const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

async function accountBalance(accountId: string) {
  const result = await listTable<{ accountId: string; debit: number | string; credit: number | string }>("JournalLines", 500, 0);
  return round2((result.rows || [])
    .filter((line) => String(line.accountId || "") === accountId)
    .reduce((sum, line) => sum + Number(line.debit || 0) - Number(line.credit || 0), 0));
}

export async function POST(request: Request) {
  try {
    const user = requireRequestPermission(request, "accounts.write");
    const input = schema.parse(await request.json());
    const total = round2(input.lines.reduce((sum, line) => sum + Number(line.amount || 0), 0));
    if (!(total > 0)) throw new Error("Total payment amount must be greater than zero");

    const available = await accountBalance(input.paidFromAccountId);
    if (available + 0.001 < total) {
      throw new Error(`Insufficient funds in selected cash/bank account. Available K${available.toFixed(2)}, payment K${total.toFixed(2)}.`);
    }

    const voucherId = documentSeriesId("Bank Cash Pay");
    const payee = [input.payeeType, input.payeeName].filter(Boolean).join(": ");
    const reference = [`${input.paymentType} Pay Entry`, payee, input.reference, input.remarks ? `Remarks: ${input.remarks}` : ""].filter(Boolean).join(" · ");
    const journal = await postJournal({
      postingDate: input.postingDate,
      documentType: "BANK_CASH_PAY_ENTRY",
      documentId: voucherId,
      documentNumber: voucherId,
      reference,
      createdBy: user.email || "bank-cash-pay-ui",
      approvedBy: user.name || "Finance Controller",
      lines: [
        ...input.lines.map((line) => ({
          accountId: line.accountId,
          debit: round2(Number(line.amount || 0)),
          projectId: line.projectId,
          description: line.description,
        })),
        {
          accountId: input.paidFromAccountId,
          credit: total,
          description: `Paid from ${input.paymentType === "CASH" ? "cash" : "bank"} account`,
        },
      ],
    });

    return NextResponse.json({ ok: true, voucherId, journalId: journal.journalId, total });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((issue) => issue.message).join("; ")
      : error instanceof Error
        ? error.message
        : "Bank/Cash Pay Entry failed";
    const status = message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
