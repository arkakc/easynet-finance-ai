import { normalizeAccountingDate } from "@/lib/accounting/loan";

/** Render accounting dates in the company's PNG timezone, preserving date-only values. */
export function formatAccountingDate(value: string | null | undefined): string {
  if (!value || !value.trim()) return "—";
  try {
    const [year, month, day] = normalizeAccountingDate(value).split("-");
    return `${day}/${month}/${year}`;
  } catch {
    return "Invalid date — review required";
  }
}
