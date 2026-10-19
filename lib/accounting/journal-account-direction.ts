/** Presentation-only accounting direction indicators. Never used for posting. */
export function journalAccountDirection(accountType: string | null | undefined, side: "debit" | "credit") {
  const normalized = String(accountType || "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  const contra = normalized.startsWith("contra ");
  const baseType = contra ? normalized.slice(7) : normalized;
  const debitNormal = ["asset", "expense", "cost of sales", "cogs"].includes(baseType);
  const creditNormal = ["liability", "equity", "income", "revenue"].includes(baseType);
  if (!debitNormal && !creditNormal) return null;
  const accountIncrease = (side === "debit") === (contra ? !debitNormal : debitNormal);
  const baseIncrease = contra ? !accountIncrease : accountIncrease;
  const baseLabel = baseType === "income" ? "Revenue" : baseType === "cogs" || baseType === "cost of sales" ? "Expense" : baseType.charAt(0).toUpperCase() + baseType.slice(1);
  return {
    arrow: accountIncrease ? "↑" : "↓",
    accountIncrease,
    text: contra
      ? `${accountIncrease ? "↑" : "↓"} contra balance · ${baseIncrease ? "↑" : "↓"} ${baseLabel}`
      : `${accountIncrease ? "↑" : "↓"} ${baseLabel}`,
    // This signals account-type effect, not guaranteed net period profit.
    baseEffect: baseIncrease ? "increase" : "decrease",
  };
}
