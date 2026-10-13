export type ProjectJournalLine = { projectId: string; accountId: string; debit: number; credit: number };
export type ProjectAccount = { accountId: string; accountType: string; accountName?: string };
export function projectFinancialBreakdown(lines: ProjectJournalLine[], accounts: ProjectAccount[]) {
  const accountMap = new Map(accounts.map(a => [a.accountId, a]));
  const totals = new Map<string, { revenue: number; directCost: number; costByAccount: Map<string, number> }>();
  for (const line of lines) {
    if (!line.projectId) continue;
    if (![line.debit, line.credit].every(Number.isFinite)) throw new Error("Invalid posted journal amount");
    const account = accountMap.get(line.accountId);
    if (!account) continue;
    const current = totals.get(line.projectId) || { revenue: 0, directCost: 0, costByAccount: new Map<string, number>() };
    if (account.accountType === "Income") current.revenue += line.credit - line.debit;
    if (account.accountType === "Expense") {
      const amount = line.debit - line.credit;
      current.directCost += amount;
      current.costByAccount.set(line.accountId, (current.costByAccount.get(line.accountId) || 0) + amount);
    }
    totals.set(line.projectId, current);
  }
  return new Map([...totals].map(([projectId, v]) => [projectId, {
    revenue: Math.round(v.revenue * 100) / 100,
    cost: Math.round(v.directCost * 100) / 100,
    profit: Math.round((v.revenue - v.directCost) * 100) / 100,
    margin: v.revenue > 0 ? (v.revenue - v.directCost) / v.revenue * 100 : null,
    expenses: [...v.costByAccount].map(([accountId, amount]) => ({
      accountId, accountName: accountMap.get(accountId)?.accountName || accountId, amount: Math.round(amount * 100) / 100,
    })).sort((a,b) => Math.abs(b.amount) - Math.abs(a.amount)),
  }]));
}
