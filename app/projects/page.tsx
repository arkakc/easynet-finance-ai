import { listTable } from "@/lib/backend/apps-script";
import { prisma } from "@/src/lib/prisma";
import ProjectLifecycleTable from "@/app/components/project-lifecycle-table";

export const dynamic = "force-dynamic";

type Project = { projectId: string; projectName: string; customerId: string; status: string; contractTotal: number | string; expectedCost: number | string; usageCount?: number };
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
    // Core operational data is Prisma-only. Optional Apps Script integrations
    // must never switch this route away from the authoritative database.
    const backendConfigured = false;
    if (!backendConfigured) {
      const [p, a, j, po, b] = await Promise.all([
        prisma.project.findMany({
          include: {
            _count: {
              select: {
                quotes: true,
                invoices: true,
                purchaseOrders: true,
                bills: true,
                payments: true,
                creditNotes: true,
                refunds: true,
                expenses: true,
                timeEntries: true,
                budgets: true,
              },
            },
          },
        }),
        prisma.chartOfAccounts.findMany(),
        prisma.journalLine.findMany({ include: { journal: true } }),
        prisma.purchaseOrder.findMany(),
        prisma.supplierBill.findMany(),
      ]);
      projects = p.map((row) => ({ projectId: row.id, projectName: row.name, customerId: row.customerId || "", status: row.status, contractTotal: Number(row.budget || 0), expectedCost: 0, usageCount: Object.values(row._count || {}).reduce((sum, value) => sum + Number(value || 0), 0) }));
      accounts = a.map((row) => ({ accountId: row.id, accountType: row.type }));
      lines = j.filter((row) => row.journal.status === "POSTED").map((row) => ({ accountId: row.accountId, projectId: row.projectId || "", debit: Number(row.debit), credit: Number(row.credit) }));
      pos = po.map((row) => ({ poId: row.id, projectId: row.projectId || "", totalAmount: Number(row.total), status: row.status }));
      bills = b.map((row) => ({ billId: row.id, projectId: row.projectId || "", totalAmount: Number(row.total), status: row.status }));
    } else {
      const [p, a, j, po, b] = await Promise.all([
        listTable<Project>("Projects", 500, 0),
        listTable<Account>("Accounts", 500, 0),
        listTable<JournalLine>("JournalLines", 500, 0),
        listTable<PurchaseOrder>("PurchaseOrders", 500, 0),
        listTable<Bill>("SupplierBills", 500, 0),
      ]);
      projects = p.rows; accounts = a.rows; lines = j.rows; pos = po.rows; bills = b.rows;
    }
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

  const activeProjects = rows.filter((row) => String(row.status || "").toUpperCase() === "ACTIVE").length;
  const totalContract = rows.reduce((sum, r) => sum + n(r.contractTotal), 0);
  const totalRevenue = rows.reduce((sum, r) => sum + r.revenue, 0);
  const totalCost = rows.reduce((sum, r) => sum + r.cost, 0);
  const totalGrossProfit = totalRevenue - totalCost;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Project Profitability & Job Costing</h2>
          <p className="small">Live contract budgets, posted revenue/cost and purchase-order commitments by project.</p>
        </div>
        <div className="page-head-actions">
          {error && (
            <details className="system-notice-tab">
              <summary>
                <span>ℹ️ System Notice</span>
                <span className="notice-arrow">▾</span>
              </summary>
              <div className="system-notice-dropdown">
                <strong className="system-notice-warning">Backend notice:</strong> {error}
              </div>
            </details>
          )}
          <span className="badge">PGK (K)</span>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="label">Active Projects</div>
          <div className="value">{activeProjects}</div>
        </div>
        <div className="card">
          <div className="label">Total Contract Value</div>
          <div className="value">{money(totalContract)}</div>
        </div>
        <div className="card">
          <div className="label">Posted Revenue</div>
          <div className="value">{money(totalRevenue)}</div>
        </div>
        <div className="card">
          <div className="label">Overall Gross Profit</div>
          <div className="value">{money(totalGrossProfit)}</div>
        </div>
      </div>

      <ProjectLifecycleTable rows={rows.map((row)=>({
        projectId:row.projectId,
        projectName:row.projectName,
        customerId:row.customerId,
        status:row.status,
        contractTotal:n(row.contractTotal),
        revenue:row.revenue,
        cost:row.cost,
        grossProfit:row.grossProfit,
        margin:row.margin,
        commitments:row.commitments,
        openCommitment:row.openCommitment,
        usageCount:Number(row.usageCount||0),
      }))} error={error}/>
    </>
  );
}
