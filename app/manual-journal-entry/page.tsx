import { requirePermission } from "@/lib/auth";
import { listTable } from "@/lib/backend/apps-script";
import { prisma } from "@/src/lib/prisma";
import { ManualJournalEntryClient, type ManualJournalAccount } from "@/app/components/manual-journal-entry-client";

export const dynamic = "force-dynamic";

export default async function ManualJournalEntryPage() {
  await requirePermission("accounts.write");
  let accounts: ManualJournalAccount[] = [];
  let error = "";

  try {
    // Core operational data is Prisma-only. Optional Apps Script integrations
    // must never switch this route away from the authoritative database.
    const backendConfigured = false;
    if (!backendConfigured) {
      const chartOfAccounts = await prisma.chartOfAccounts.findMany({
        orderBy: { code: "asc" },
        include: { children: { select: { id: true } }, parent: { select: { code: true } } },
      });
      accounts = chartOfAccounts.map((row) => ({
        accountId: row.id,
        postingAccountId: `ACC-${row.code}`,
        accountCode: row.code,
        accountName: row.name,
        accountType: row.type,
        parentAccount: row.parent ? `ACC-${row.parent.code}` : "",
        active: row.isActive,
        isGroup: row.children.length > 0,
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
          <p className="small">Accountant-controlled double-entry doctype · posts through the posting engine into immutable journals and ledgers.</p>
        </div>
        {error ? <div className="badge">Account list warning</div> : <div className="badge">MANUAL POSTING</div>}
      </div>
      {error ? <section className="panel"><strong>Backend warning:</strong> {error}</section> : null}
      <ManualJournalEntryClient accounts={accounts} defaultPostingDate={new Date().toISOString().slice(0, 10)} />
    </>
  );
}
