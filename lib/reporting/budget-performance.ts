export type BudgetPlan = { budgetId: string; financialYear: string; period: string; accountId: string; projectId: string; budgetAmount: number };
export type PostedBudgetLine = { accountId: string; projectId: string; costCenter: string; date: string; debit: number; credit: number };
export type BudgetAccount = { accountId: string; accountType: string };
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function calculateBudgetActuals(budgets: BudgetPlan[], lines: PostedBudgetLine[], accounts: BudgetAccount[]) {
  const type = new Map(accounts.map(a => [a.accountId, a.accountType]));
  return budgets.map(b => {
    if (!Number.isFinite(b.budgetAmount)) throw new Error("Invalid budget amount");
    const annual = b.period === "ANNUAL" || b.period === "YEARLY" || b.period === b.financialYear;
    const actual = round(lines.filter(l =>
      l.accountId === b.accountId &&
      (b.projectId ? l.projectId === b.projectId : !l.projectId) &&
      l.date.startsWith(b.financialYear + "-") &&
      (annual || l.date.startsWith(b.period + "-"))
    ).reduce((sum, l) => {
      if (!Number.isFinite(l.debit) || !Number.isFinite(l.credit)) throw new Error("Invalid posted journal amount");
      return sum + (["Income", "Liability", "Equity"].includes(type.get(l.accountId) || "") ? l.credit - l.debit : l.debit - l.credit);
    }, 0));
    const budget = round(b.budgetAmount), variance = round(budget - actual);
    return { ...b, budgetAmount: budget, actualAmount: actual, variance, variancePercent: budget !== 0 ? round(variance / Math.abs(budget) * 100) : null, utilizationPercent: budget !== 0 ? round(actual / budget * 100) : null, overspent: actual > budget };
  });
}
export function summarizeCostCenters(lines: PostedBudgetLine[], accounts: BudgetAccount[], year: string) {
  const type = new Map(accounts.map(a => [a.accountId, a.accountType]));
  const sums = new Map<string, number>();
  for (const l of lines) {
    if (!l.costCenter || !l.date.startsWith(year + "-") || type.get(l.accountId) !== "Expense") continue;
    if (!Number.isFinite(l.debit) || !Number.isFinite(l.credit)) throw new Error("Invalid posted journal amount");
    sums.set(l.costCenter, (sums.get(l.costCenter) || 0) + l.debit - l.credit);
  }
  return [...sums].map(([costCenter, actualAmount]) => ({ costCenter, actualAmount: round(actualAmount) })).sort((a,b) => b.actualAmount-a.actualAmount);
}
