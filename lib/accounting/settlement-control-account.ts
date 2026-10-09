export type SourceControlLine = { accountId: string; description: string; debit: number | unknown; credit: number | unknown };

/** Fail closed instead of settling an invoice against an unrelated AR/AP ledger. */
export function sourceControlAccount(
  lines: SourceControlLine[],
  direction: "RECEIVABLE" | "PAYABLE",
): string {
  const matches = lines.filter((line) =>
    direction === "RECEIVABLE"
      ? Number(line.debit || 0) > 0 && /^accounts receivable$/i.test(String(line.description || "").trim())
      : Number(line.credit || 0) > 0 && /^accounts payable$/i.test(String(line.description || "").trim()),
  );
  const accounts = [...new Set(matches.map((line) => String(line.accountId || "").trim()).filter(Boolean))];
  if (accounts.length !== 1) {
    throw new Error("Cannot unambiguously resolve AR/AP control account from source journal; settlement blocked");
  }
  return accounts[0];
}
