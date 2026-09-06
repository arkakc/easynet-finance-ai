export const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
export const round4 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;

export type InventoryState = {
  qty: number;
  value: number;
  rate: number;
};

export function signedMovementValue(row: any) {
  const explicit = Number(row.valueAdjustment || 0);
  if (Math.abs(explicit) > 0.0000001) return explicit;
  const value = Math.abs(Number(row.value || 0));
  const qtyIn = Number(row.qtyIn || 0);
  const qtyOut = Number(row.qtyOut || 0);
  if (qtyIn > 0) return value;
  if (qtyOut > 0) return -value;
  return 0;
}

export function inventoryState(rows: any[], fallbackRate = 0): InventoryState {
  let qty = 0;
  let value = 0;
  for (const row of rows) {
    qty += Number(row.qtyIn || 0) - Number(row.qtyOut || 0);
    value += signedMovementValue(row);
  }
  if (Math.abs(qty) < 0.0000001) qty = 0;
  if (Math.abs(value) < 0.005) value = 0;
  const rate = qty > 0 ? value / qty : Number(fallbackRate || 0);
  return { qty: round4(qty), value: round2(value), rate: round4(Math.max(0, rate)) };
}

export function weightedRate(lines: any[]) {
  const qty = lines.reduce((sum, line) => sum + Number(line.qty || 0), 0);
  if (!(qty > 0)) return 0;
  const value = lines.reduce((sum, line) => sum + Number(line.qty || 0) * Number(line.rate || 0), 0);
  return round4(value / qty);
}

export function monthEnd(dateText: string) {
  const [year, month] = String(dateText).slice(0, 10).split("-").map(Number);
  if (!year || !month) throw new Error(`Invalid date: ${dateText}`);
  const date = new Date(Date.UTC(year, month, 0));
  return date.toISOString().slice(0, 10);
}

export function addMonths(dateText: string, months: number) {
  const [year, month, day] = String(dateText).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) throw new Error(`Invalid date: ${dateText}`);
  const date = new Date(Date.UTC(year, month - 1 + months, day));
  return date.toISOString().slice(0, 10);
}

export function addMonthsMonthEnd(dateText: string, months: number) {
  return monthEnd(addMonths(dateText, months));
}

export function splitEvenly(total: number, periods: number) {
  const count = Math.max(1, Math.trunc(periods));
  const base = round2(Number(total || 0) / count);
  const values = Array.from({ length: count }, () => base);
  const diff = round2(Number(total || 0) - values.reduce((sum, value) => sum + value, 0));
  values[count - 1] = round2(values[count - 1] + diff);
  return values;
}
