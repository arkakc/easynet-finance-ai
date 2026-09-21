import "server-only";
import { createHash } from "node:crypto";

export type ParsedBankStatementRow = {
  rowNumber: number;
  date: string;
  description: string;
  referenceNumber: string;
  amount: number;
  statementBalance: number | null;
  type: "DEPOSIT" | "WITHDRAWAL" | "FEE" | "INTEREST" | "TRANSFER_IN" | "TRANSFER_OUT" | "CHECK" | "AUTOMATIC_PAYMENT";
  fingerprint: string;
  errors: string[];
};

const clean = (value: unknown) => String(value ?? "").trim();
const key = (value: unknown) => clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");

function normalizedRecord(row: Record<string, unknown>) {
  const result = new Map<string, unknown>();
  for (const [header, value] of Object.entries(row)) result.set(key(header), value);
  return result;
}

function pick(row: Map<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const value = row.get(key(alias));
    if (value !== undefined && clean(value) !== "") return clean(value);
  }
  return "";
}

function amount(value: string): number | null {
  if (!value) return null;
  const negativeByBrackets = /^\(.*\)$/.test(value.trim());
  const cleaned = value.replace(/[K$£€,\s]/g, "").replace(/[()]/g, "").replace(/\b(CR|DR)\b/gi, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  const negativeByDr = /\bDR\b/i.test(value);
  return Math.round((negativeByBrackets || negativeByDr ? -Math.abs(parsed) : parsed) * 100) / 100;
}

function dateFromExcelSerial(serial: number) {
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + serial * 86_400_000).toISOString().slice(0, 10);
}

function accountingDate(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (/^\d{5}(\.\d+)?$/.test(text)) return dateFromExcelSerial(Number(text));
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) {
    const [, year, month, day] = match;
    const result = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    return Number.isNaN(new Date(`${result}T00:00:00Z`).getTime()) ? null : result;
  }
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (match) {
    const [, day, month, year] = match;
    const result = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    return Number.isNaN(new Date(`${result}T00:00:00Z`).getTime()) ? null : result;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function transactionType(signedAmount: number, description: string, rawType: string): ParsedBankStatementRow["type"] {
  const haystack = `${description} ${rawType}`.toLowerCase();
  if (/fee|charge|levy/.test(haystack)) return "FEE";
  if (/interest/.test(haystack)) return "INTEREST";
  if (/cheque|check/.test(haystack)) return "CHECK";
  if (/direct debit|automatic|autopay/.test(haystack)) return "AUTOMATIC_PAYMENT";
  if (/transfer/.test(haystack)) return signedAmount >= 0 ? "TRANSFER_IN" : "TRANSFER_OUT";
  return signedAmount >= 0 ? "DEPOSIT" : "WITHDRAWAL";
}

export function parseBankStatementRows(sourceRows: Record<string, unknown>[], bankAccountId: string) {
  const parsed = sourceRows.map((raw, index): ParsedBankStatementRow => {
    const row = normalizedRecord(raw);
    const rawDate = pick(row, ["Transaction Date", "Date", "Value Date", "Posting Date"]);
    const date = accountingDate(rawDate) || "";
    const description = pick(row, ["Transaction Description", "Description", "Details", "Narrative", "Particulars", "Memo"]);
    const referenceNumber = pick(row, ["Reference Number", "Reference", "Transaction ID", "Cheque Number", "Check Number"]);
    const debit = amount(pick(row, ["Debit", "Withdrawal", "Withdrawals", "Money Out", "DR"]));
    const credit = amount(pick(row, ["Credit", "Deposit", "Deposits", "Money In", "CR"]));
    const singleAmount = amount(pick(row, ["Amount", "Transaction Amount", "Value"]));
    const rawType = pick(row, ["Transaction Type", "Type", "DR/CR", "Debit Credit"]);
    let signedAmount = debit !== null || credit !== null ? Math.abs(credit || 0) - Math.abs(debit || 0) : singleAmount;
    if (signedAmount !== null && singleAmount !== null && /^(dr|debit|withdrawal)$/i.test(rawType)) signedAmount = -Math.abs(singleAmount);
    if (signedAmount !== null && singleAmount !== null && /^(cr|credit|deposit)$/i.test(rawType)) signedAmount = Math.abs(singleAmount);
    const statementBalance = amount(pick(row, ["Balance", "Running Balance", "Closing Balance", "Available Balance"]));
    const errors: string[] = [];
    if (!date) errors.push(`Invalid or missing transaction date: ${rawDate || "blank"}`);
    if (!description) errors.push("Description is required");
    if (signedAmount === null || signedAmount === 0) errors.push("A non-zero amount, or debit/credit value, is required");
    const normalizedAmount = signedAmount || 0;
    const fingerprint = createHash("sha256")
      .update([bankAccountId, date, normalizedAmount.toFixed(2), referenceNumber.toLowerCase(), description.toLowerCase()].join("|"))
      .digest("hex");
    return {
      rowNumber: index + 2,
      date,
      description,
      referenceNumber,
      amount: normalizedAmount,
      statementBalance,
      type: transactionType(normalizedAmount, description, rawType),
      fingerprint,
      errors,
    };
  });

  const seen = new Set<string>();
  for (const row of parsed) {
    if (seen.has(row.fingerprint)) row.errors.push("Duplicate transaction row in this file");
    seen.add(row.fingerprint);
  }
  return parsed;
}
