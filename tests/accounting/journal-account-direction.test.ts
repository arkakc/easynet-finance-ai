import test from "node:test";
import assert from "node:assert/strict";
import { journalAccountDirection } from "../../lib/accounting/journal-account-direction";

test("normal asset, liability, equity, income and expense directions", () => {
  const expected = [
    ["Asset", true, false],
    ["Liability", false, true],
    ["Equity", false, true],
    ["Income", false, true],
    ["Revenue", false, true],
    ["Expense", true, false],
    ["COGS", true, false],
  ] as const;
  for (const [type, debitIncrease, creditIncrease] of expected) {
    assert.equal(journalAccountDirection(type, "debit")?.accountIncrease, debitIncrease, type + " Dr");
    assert.equal(journalAccountDirection(type, "credit")?.accountIncrease, creditIncrease, type + " Cr");
  }
});

test("contra equity debit raises drawings but reduces total equity", () => {
  const result = journalAccountDirection("Contra Equity", "debit");
  assert.equal(result?.accountIncrease, true);
  assert.equal(result?.baseEffect, "decrease");
  assert.match(result?.text || "", /↑ contra balance.*↓ Equity/);
});

test("contra asset credit raises accumulated depreciation but reduces assets", () => {
  const result = journalAccountDirection("Contra Asset", "credit");
  assert.equal(result?.accountIncrease, true);
  assert.equal(result?.baseEffect, "decrease");
});

test("unknown types do not display potentially misleading arrows", () => {
  assert.equal(journalAccountDirection("Unclassified", "debit"), null);
});
