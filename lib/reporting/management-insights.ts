export type FinanceInsightsInput = {
  revenue: number; expenses: number; cashBank: number;
  receivables: number; payables: number; purchaseCommitments: number;
  arDifference: number; apDifference: number;
};
export type Insight = { key: string; label: string; value: number | null; unit: "percent" | "PGK"; status: "normal" | "warning" | "unavailable"; explanation: string };

export function deriveFinanceInsights(input: FinanceInsightsInput): Insight[] {
  if (Object.values(input).some(value => !Number.isFinite(value))) throw new Error("Financial insights require valid numbers");
  const netProfit = input.revenue - input.expenses;
  const margin = input.revenue > 0 ? netProfit / input.revenue * 100 : null;
  const workingCapital = input.cashBank + input.receivables - input.payables;
  const afterCommitments = workingCapital - input.purchaseCommitments;
  return [
    { key: "profitMargin", label: "Net Profit Margin", value: margin, unit: "percent", status: margin === null ? "unavailable" : margin < 0 ? "warning" : "normal", explanation: "Posted net profit divided by posted revenue; unavailable when revenue is zero or negative." },
    { key: "workingCapital", label: "Operating Liquidity Proxy", value: workingCapital, unit: "PGK", status: workingCapital < 0 ? "warning" : "normal", explanation: "Cash and bank + posted receivables − posted payables. Not a full balance-sheet working capital measure." },
    { key: "afterCommitments", label: "Liquidity After PO Commitments", value: afterCommitments, unit: "PGK", status: afterCommitments < 0 ? "warning" : "normal", explanation: "Liquidity proxy less outstanding purchase order commitments. Indicative only; not a cash-flow forecast." },
    { key: "reconciliation", label: "AR/AP Reconciliation Variance", value: Math.abs(input.arDifference) + Math.abs(input.apDifference), unit: "PGK", status: Math.abs(input.arDifference) >= 0.01 || Math.abs(input.apDifference) >= 0.01 ? "warning" : "normal", explanation: "Sum of absolute differences between GL control and AR/AP subledgers." },
  ];
}
