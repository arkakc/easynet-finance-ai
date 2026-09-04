import { listTable } from "@/lib/backend/apps-script";

export const dynamic = "force-dynamic";

type Account = {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  parentAccount: string;
  active: boolean | string;
};

export default async function AccountsPage() {
  let accounts: Account[] = [];
  let error = "";

  try {
    const result = await listTable<Account>("Accounts", 500, 0);
    accounts = result.rows.sort((a, b) =>
      String(a.accountCode).localeCompare(String(b.accountCode)),
    );
  } catch (err) {
    error = err instanceof Error ? err.message : "Unable to load accounts";
  }

  return (
    <>
      <h2>Chart of Accounts</h2>
      <p className="small">
        Live master data from Google Sheets. Account codes are the controlled accounting structure used by journal postings.
      </p>

      {error && <section className="panel"><strong>Backend warning:</strong> {error}</section>}

      <section className="panel table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Account</th>
              <th>Type</th>
              <th>Parent</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.accountId}>
                <td>{account.accountCode}</td>
                <td>{account.accountName}</td>
                <td>{account.accountType}</td>
                <td>{account.parentAccount || "—"}</td>
                <td>{String(account.active).toLowerCase() === "false" ? "Inactive" : "Active"}</td>
              </tr>
            ))}
            {!accounts.length && !error && (
              <tr><td colSpan={5}>No accounts found.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
