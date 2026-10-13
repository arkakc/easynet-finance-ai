export type JournalLine = { accountId: string; debit: number; credit: number };
export type AccountingFlowEvidence = {
  sourceId: string;
  net: number;
  gst: number;
  gross: number;
  journal: JournalLine[];
  receivableOrPayableControl: number;
  allocatedPayments: number;
  remainingBalance: number;
};

const money = (n: number) => Math.round(n * 100);
export function checkAccountingFlow(evidence: AccountingFlowEvidence): string[] {
  const issues: string[] = [];
  const nums = [evidence.net, evidence.gst, evidence.gross, evidence.receivableOrPayableControl, evidence.allocatedPayments, evidence.remainingBalance];
  if (!evidence.sourceId.trim()) issues.push("Source reference required");
  if (nums.some(n => !Number.isFinite(n))) issues.push("Non-finite financial amount");
  if (!evidence.journal.length) issues.push("Missing posted journal lines");
  if (evidence.journal.some(line => !line.accountId.trim() || !Number.isFinite(line.debit) || !Number.isFinite(line.credit) || line.debit < 0 || line.credit < 0 || (line.debit > 0 && line.credit > 0))) issues.push("Invalid debit or credit journal line");
  if (issues.length) return issues;
  if (money(evidence.net + evidence.gst) !== money(evidence.gross)) issues.push("Net plus GST does not equal gross");
  const debit = evidence.journal.reduce((sum, line) => sum + money(line.debit), 0);
  const credit = evidence.journal.reduce((sum, line) => sum + money(line.credit), 0);
  if (debit !== credit) issues.push("Journal debit and credit do not balance");
  if (money(evidence.receivableOrPayableControl) !== money(evidence.gross)) issues.push("AR/AP control does not match document gross");
  if (money(evidence.allocatedPayments + evidence.remainingBalance) !== money(evidence.gross)) issues.push("Payments plus remaining balance do not reconcile");
  return issues;
}
