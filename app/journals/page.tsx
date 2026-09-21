import JournalRegisterClient, { type JournalRegisterRow } from "@/app/components/journal-register-client";
import { prisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";

export default async function JournalsPage() {
  let rows: JournalRegisterRow[] = [];
  let error = "";

  try {
    const headers = await prisma.journalHeader.findMany({
      orderBy: { createdAt: "desc" },
      include: { lines: { orderBy: { lineNo: "asc" } } },
    });

    rows = headers.map((header) => ({
      id: header.id,
      journalId: header.code,
      postingDate: header.date.toISOString(),
      createdAt: header.createdAt.toISOString(),
      documentType: header.sourceDocType || "JOURNAL",
      documentNumber: header.sourceDocId || "",
      reference: header.reference || header.description || "",
      status: header.status,
      maker: header.createdBy || "",
      checker: header.approvedBy || "",
      debit: header.lines.reduce((sum, line) => sum + Number(line.debit || 0), 0),
      credit: header.lines.reduce((sum, line) => sum + Number(line.credit || 0), 0),
      currency: String(header.baseCurrency || "PGK").toUpperCase(),
    }));
  } catch (err) {
    error = err instanceof Error ? err.message : "Journal register load failed";
  }

  return <JournalRegisterClient rows={rows} error={error} />;
}
