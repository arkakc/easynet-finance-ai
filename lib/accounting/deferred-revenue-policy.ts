/**
 * Pure accounting policy checks for deferred revenue. Kept independent of DB
 * to make the reversal invariants testable without touching financial records.
 */
export function assertRecognitionReversalSchedule(
  schedules: Array<{ status: string }>,
) {
  if (schedules.length !== 1 || schedules[0].status !== "COMPLETED") {
    throw new Error("Linked completed deferred revenue schedule not found; reversal blocked");
  }
}
export function assertInvoiceRecognitionReversible(
  schedules: Array<{ status: string }>,
) {
  if (schedules.some((schedule) => schedule.status === "COMPLETED")) {
    throw new Error("Reverse posted deferred revenue recognition journals before reversing this sales invoice");
  }
}
export function recognitionScheduleTotalsMatch(amounts: Array<number | string>, invoiceNetAmount: number) {
  const cents = (n: number) => Math.round((n + Number.EPSILON) * 100);
  const scheduledCents = amounts.reduce<number>((total, amount) => total + cents(Number(amount)), 0);
  return Number.isFinite(invoiceNetAmount) && Math.abs(scheduledCents - cents(invoiceNetAmount)) <= 2;
}
