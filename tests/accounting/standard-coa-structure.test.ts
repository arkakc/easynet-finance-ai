import test from "node:test";
import assert from "node:assert/strict";
import { standardCoaRows } from "../../lib/accounting/standard-coa";

const rows = standardCoaRows("Example", "PGK");
const byCode = new Map(rows.map(row => [row.code, row]));
test("standard COA codes are unique and parent references resolve", () => {
  assert.equal(byCode.size, rows.length);
  for (const row of rows) {
    if (row.parentCode) assert.ok(byCode.has(row.parentCode), row.code);
  }
});
test("GST input belongs to current-asset tax group, not stock", () => {
  assert.equal(byCode.get("1162")?.parentCode, "1170");
  assert.equal(byCode.get("1170")?.parentCode, "1100");
});
test("payroll liability is separate from trade payables", () => {
  assert.equal(byCode.get("2120")?.parentCode, "2100");
});
test("revenue and payroll group headers have posting children", () => {
  assert.ok(rows.some(row => row.parentCode === "4200"));
  assert.ok(rows.some(row => row.parentCode === "5400"));
});
test("standard COA provides GST settlement, deferred revenue and accrual ledgers", () => {
  for (const code of ["2132", "2133", "2160", "2170", "1180"]) assert.ok(byCode.has(code), code);
});
