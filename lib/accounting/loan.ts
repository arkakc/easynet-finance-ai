export type CompoundMonthlyLoanInput = {
  principal: number;
  monthlyRate: number;
  loanDate: string;
  principalRepaid?: number;
  interestPaid?: number;
  asOf?: string;
};

export type CompoundMonthlyLoanSnapshot = {
  completedMonths: number;
  accruedBalanceBeforePayments: number;
  accruedInterest: number;
  principalOutstanding: number;
  interestOutstanding: number;
  totalOutstanding: number;
  nextAccrualDate: string;
};

const BUSINESS_TIME_ZONE = "Pacific/Port_Moresby";

function partsToUtcDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid date: ${year}-${month}-${day}`);
  }
  return date;
}

function dateOnlyInBusinessTimeZone(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function normalizeAccountingDate(value: string) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Date is required");

  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    partsToUtcDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
    return raw;
  }

  const dmy = raw.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
  if (dmy) {
    const normalized = `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    partsToUtcDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
    return normalized;
  }

  // Google Sheets commonly serializes date cells as ISO timestamps. Convert
  // them back to the PNG business date instead of appending another time part.
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return dateOnlyInBusinessTimeZone(parsed);
  }

  throw new Error(`Invalid date: ${raw}`);
}

function toUtcDate(value: string) {
  const normalized = normalizeAccountingDate(value);
  const [year, month, day] = normalized.split("-").map(Number);
  return partsToUtcDate(year, month, day);
}

function addMonthsUtc(date: Date, months: number) {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function monthlyAnniversaryDate(loanDate: string, months: number) {
  if (!Number.isInteger(months) || months < 0) throw new Error("Anniversary month count must be a non-negative integer");
  return addMonthsUtc(toUtcDate(loanDate), months).toISOString().slice(0, 10);
}

export function completedMonthlyPeriods(loanDate: string, asOf: string) {
  const start = toUtcDate(loanDate);
  const end = toUtcDate(asOf);
  if (end < start) return 0;

  let months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth());

  const anniversary = addMonthsUtc(start, months);
  if (anniversary > end) months -= 1;
  return Math.max(0, months);
}

function currentBusinessDate() {
  return dateOnlyInBusinessTimeZone(new Date());
}

export function calculateCompoundMonthlyLoan(
  input: CompoundMonthlyLoanInput,
): CompoundMonthlyLoanSnapshot {
  if (input.principal < 0) throw new Error("Principal cannot be negative");
  if (input.monthlyRate < 0) throw new Error("Monthly rate cannot be negative");

  const asOf = input.asOf
    ? normalizeAccountingDate(input.asOf)
    : currentBusinessDate();
  const loanDate = normalizeAccountingDate(input.loanDate);
  const completedMonths = completedMonthlyPeriods(loanDate, asOf);

  const accruedBalanceBeforePayments =
    input.principal * Math.pow(1 + input.monthlyRate, completedMonths);
  const accruedInterest = accruedBalanceBeforePayments - input.principal;

  const principalRepaid = Math.max(0, input.principalRepaid ?? 0);
  const interestPaid = Math.max(0, input.interestPaid ?? 0);

  const principalOutstanding = Math.max(0, input.principal - principalRepaid);
  const interestOutstanding = Math.max(0, accruedInterest - interestPaid);
  const totalOutstanding = principalOutstanding + interestOutstanding;

  const nextAccrualDate = addMonthsUtc(
    toUtcDate(loanDate),
    completedMonths + 1,
  )
    .toISOString()
    .slice(0, 10);

  return {
    completedMonths,
    accruedBalanceBeforePayments,
    accruedInterest,
    principalOutstanding,
    interestOutstanding,
    totalOutstanding,
    nextAccrualDate,
  };
}
