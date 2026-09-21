import { requirePermission } from "@/lib/auth";
import { listTable } from "@/lib/backend/apps-script";
import { prisma } from "@/src/lib/prisma";
import { ManualJournalEntryClient, type ManualJournalAccount } from "@/app/components/manual-journal-entry-client";

export const dynamic = "force-dynamic";

export default async function ManualJournalEntryPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  await requirePermission("accounts.write");
  const { edit } = await searchParams;
  let editJournal: any = null;
  let accounts: ManualJournalAccount[] = [];
  let baseCurrency = "PGK";
  let error = "";

  try {
    if (edit) {
      const journal = await prisma.journalHeader.findFirst({
        where: { OR: [{ id: edit }, { code: edit }] },
        include: { lines: { orderBy: { lineNo: "asc" }, include: { account: true } } },
      });
      if (!journal || !String(journal.sourceDocType || "").startsWith("MANUAL_")) throw new Error("Manual journal not found");
      if (!["DRAFT", "PENDING"].includes(journal.status)) throw new Error("Approved/posted journals cannot be edited");
      editJournal = {
        journalId: journal.id,
        entryType: String(journal.sourceDocType || "MANUAL_JOURNAL_ENTRY").replace(/^MANUAL_/, ""),
        postingDate: journal.date.toISOString().slice(0, 10),
        remarks: journal.description || "",
        lines: journal.lines.map((line) => ({
          accountId: `ACC-${line.account.code}`,
          debit: Number(line.debit) ? String(Number(line.debit)) : "",
          credit: Number(line.credit) ? String(Number(line.credit)) : "",
          description: line.description || "",
        })),
      };
    }
    // Core operational data is Prisma-only. Optional Apps Script integrations
    // must never switch this route away from the authoritative database.
    const backendConfigured = false;
    if (!backendConfigured) {
      const chartOfAccounts = await prisma.chartOfAccounts.findMany({
        orderBy: { code: "asc" },
        include: { children: { select: { id: true } }, parent: { select: { code: true } }, journalLines: { where: { journal: { status: "POSTED" } }, select: { debit: true, credit: true } } },
      });
      const currencySetting = await prisma.globalSettings.findFirst({ where: { key: { in: ["currency", "base_currency"] } }, orderBy: { updatedAt: "desc" } });
      baseCurrency = String(currencySetting?.value || "PGK").trim().toUpperCase();
      accounts = chartOfAccounts.map((row) => ({
        accountId: row.id,
        postingAccountId: `ACC-${row.code}`,
        accountCode: row.code,
        accountName: row.name,
        accountType: row.type,
        parentAccount: row.parent ? `ACC-${row.parent.code}` : "",
        active: row.isActive,
        isGroup: row.children.length > 0,
        balance: row.journalLines.reduce((sum, line) => sum + Number(line.debit || 0) - Number(line.credit || 0), 0),
      }));
    } else {
      const result = await listTable<ManualJournalAccount>("Accounts", 500, 0);
      accounts = result.rows;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Account list load failed";
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Manual Journal Entry</h2>
          <p className="small">Maker-controlled double-entry entry · submits as PENDING and reaches the immutable GL only after approval by a different authorised checker.</p>
        </div>
        {error ? <div className="badge">Account list warning</div> : <div className="badge">MAKER ENTRY</div>}
      </div>
      {error ? <section className="panel"><strong>Backend warning:</strong> {error}</section> : null}
      <ManualJournalEntryClient accounts={accounts} baseCurrency={baseCurrency} defaultPostingDate={new Date().toISOString().slice(0, 10)} editJournal={editJournal} />
    </>
  );
}
