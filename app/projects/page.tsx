import { listTable } from "@/lib/backend/apps-script";

export const dynamic = "force-dynamic";

type Project = { projectId: string; projectName: string; customerId: string; status: string; contractTotal: number | string; expectedCost: number | string };
type Account = { accountId: string; accountType: string };
type JournalLine = { accountId: string; projectId: string; debit: number | string; credit: number | string };
type PurchaseOrder = { poId: string; projectId: string; totalAmount: number | string; status: string };
type Bill = { billId: string; projectId: string; totalAmount: number | string; status: string };

const n = (value: unknown) => Number(value || 0);
const money = (value: number) => new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK", minimumFractionDigits: 2 }).format(value);

export default async function ProjectsPage() {
  let projects: Project[] = [];
  let accounts: Account[] = [];
  let lines: JournalLine[] = [];
  let pos: PurchaseOrder[] = [];
  let bills: Bill[] = [];
  let error = "";

  try {
    const [p, a, j, po, b] = await Promise.all([
      listTable<Project>("Projects", 500, 0),
      listTable<Account>("Accounts", 500, 0),
      listTable<JournalLine>("JournalLines", 500, 0),
      listTable<PurchaseOrder>("PurchaseOrders", 500, 0),
      listTable<Bill>("SupplierBills", 500, 0),
    ]);
    projects = p.rows;
    accounts = a.rows;
    lines = j.rows;
    pos = po.rows;
    bills = b.rows;
  } catch (err) {
    error = err instanceof Error ? err.message : "Project report load failed";
  }

  const accountType = new Map(accounts.map((a) => [a.accountId, a.accountType]));
  const rows = projects.map((project) => {
    let revenue = 0;
    let cost = 0;
    for (const line of lines.filter((line) => line.projectId === project.projectId)) {
      const type = accountType.get(line.accountId);
      if (type === "Income") revenue += n(line.credit) - n(line.debit);
      if (type === "Expense") cost += n(line.debit) - n(line.credit);
    }
    const postedBillIds = new Set(bills.filter((bill) => bill.projectId === project.projectId && bill.status !== "DRAFT").map((bill) => bill.billId));
    const commitments = pos
      .filter((po) => po.projectId === project.projectId && po.status !== "CANCELLED")
      .reduce((sum, po) => sum + n(po.totalAmount), 0);
    const billTotal = bills
      .filter((bill) => bill.projectId === project.projectId && postedBillIds.has(bill.billId))
      .reduce((sum, bill) => sum + n(bill.totalAmount), 0);
    const openCommitment = Math.max(0, commitments - billTotal);
    const grossProfit = revenue - cost;
    const margin = revenue ? (grossProfit / revenue) * 100 : 0;
    return { ...project, revenue, cost, grossProfit, margin, commitments, billTotal, openCommitment };
  });

  return (
    <>
      <h2>Project Profitability</h2>
      <p className="small">Posted revenue/cost plus purchase-order commitments by project.</p>
      {error && <section className="panel"><strong>Backend warning:</strong> {error}</section>}

      <section className="panel table-wrap">
        <table className="data-table">
          <thead><tr><th>Project</th><th>Customer</th><th>Status</th><th>Contract</th><th>Revenue</th><th>Posted Cost</th><th>Gross Profit</th><th>Margin</th><th>PO Commitments</th><th>Open Commitment</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.projectId}>
                <td><strong>{row.projectName}</strong><br/><span className="small">{row.projectId}</span></td>
                <td>{row.customerId}</td><td>{row.status}</td><td>{money(n(row.contractTotal))}</td>
                <td>{money(row.revenue)}</td><td>{money(row.cost)}</td><td>{money(row.grossProfit)}</td><td>{row.margin.toFixed(1)}%</td>
                <td>{money(row.commitments)}</td><td>{money(row.openCommitment)}</td>
              </tr>
            ))}
            {!rows.length && !error && <tr><td colSpan={10}>No projects found.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
