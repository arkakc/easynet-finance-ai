import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { loadConfiguredPostingAccounts } from "@/lib/accounting/finance-settings.server";
import { postFxRevaluationAtomic } from "@/lib/accounting/fx-revaluation";
import { prisma } from "@/src/lib/prisma";

const schema = z.object({
  revaluationDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function GET() {
  try {
    await requirePermission("accounts.read");
    const rows = await prisma.fxRevaluation.findMany({
      orderBy: { revaluationDate: "desc" },
      include: { lines: { orderBy: [{ currency: "asc" }, { documentNumber: "asc" }] } },
      take: 100,
    });
    return NextResponse.json({
      ok: true,
      revaluations: rows.map((row) => ({
        revaluationId: row.id,
        revaluationCode: row.code,
        revaluationDate: row.revaluationDate.toISOString().slice(0, 10),
        reversalDate: row.reversalDate.toISOString().slice(0, 10),
        baseCurrency: row.baseCurrency,
        status: row.status,
        totalGain: Number(row.totalGain || 0),
        totalLoss: Number(row.totalLoss || 0),
        journalId: row.journalId,
        reversalJournalId: row.reversalJournalId,
        createdBy: row.createdBy,
        lineCount: row.lines.length,
        lines: row.lines.map((line) => ({
          documentType: line.documentType,
          documentId: line.documentId,
          documentNumber: line.documentNumber,
          partyType: line.partyType,
          partyId: line.partyId,
          currency: line.currency,
          outstandingAmount: Number(line.outstandingAmount || 0),
          historicalBase: Number(line.historicalBase || 0),
          closingRate: Number(line.closingRate || 0),
          closingBase: Number(line.closingBase || 0),
          baseDifference: Number(line.baseDifference || 0),
          gainAmount: Number(line.gainAmount || 0),
          lossAmount: Number(line.lossAmount || 0),
        })),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "FX revaluation read failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("post.approve");
    const input = schema.parse(await request.json());
    const defaults = await loadConfiguredPostingAccounts();
    const result = await postFxRevaluationAtomic({
      revaluationDate: input.revaluationDate,
      receivableAccountId: defaults.defaultReceivableAccount,
      payableAccountId: defaults.defaultPayableAccount,
      exchangeGainAccountId: defaults.exchangeUnrealizedGainAccount,
      exchangeLossAccountId: defaults.exchangeUnrealizedLossAccount,
      createdBy: user.email,
      approvedBy: user.email,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((entry) => `${entry.path.join(".")}: ${entry.message}`).join("; ")
      : error instanceof Error ? error.message : "FX revaluation failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400 },
    );
  }
}
