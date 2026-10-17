import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { setupConfigSchema, validateOpeningBalances } from "../../lib/accounting/setup-workflow";

const company = {
  companyName: "Example PNG Company", companyShortName: "Example",
  country: "Papua New Guinea", registrationNo: "REGISTERED-EXAMPLE",
  baseCurrency: "PGK", financialYearPeriod: "FY 2026 (01 Jan 2026 - 31 Dec 2026)",
  gstStatus: "UNVERIFIED" as const, businessType: "IT_TECHNOLOGY" as const,
  openingMode: "NEW_BUSINESS" as const, openingDate: "2026-10-17",
};

test("company setup requires real identity fields", () => {
  const result = setupConfigSchema.safeParse({ ...company, registrationNo: "" });
  assert.equal(result.success, false);
  if (!result.success) assert.ok(result.error.issues.some(issue => issue.path.includes("registrationNo")));
});

test("GST registered or verified requires tax number and certificate metadata", () => {
  for (const status of ["REGISTERED", "VERIFIED"] as const) {
    const result = setupConfigSchema.safeParse({ ...company, gstStatus: status });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some(issue => issue.path.includes("gstNumber")));
      assert.ok(result.error.issues.some(issue => issue.path.includes("gstEvidenceDocName")));
    }
    assert.equal(setupConfigSchema.safeParse({
      ...company, gstStatus: status, gstNumber: "TIN-TEST",
      gstEvidenceDocId: "evidence-id", gstEvidenceDocName: "certificate.pdf",
    }).success, true);
  }
});

test("non-registered GST states do not require a certificate", () => {
  for (const status of ["UNVERIFIED", "NOT_REGISTERED", "EXEMPT"] as const) {
    assert.equal(setupConfigSchema.safeParse({ ...company, gstStatus: status }).success, true);
  }
});

test("Other business category requires a description", () => {
  assert.equal(setupConfigSchema.safeParse({ ...company, businessType: "OTHER", customBusinessType: "" }).success, false);
  assert.equal(setupConfigSchema.safeParse({ ...company, businessType: "OTHER", customBusinessType: "Professional services" }).success, true);
});

test("accounting policy cannot be overridden through setup input", () => {
  const result = setupConfigSchema.parse({ ...company, accountingMethod: "CASH", inventoryMethod: "PERIODIC" });
  assert.equal(result.accountingMethod, "ACCRUAL");
  assert.equal(result.inventoryMethod, "PERPETUAL");
});

function mockClient() {
  const calls: string[] = [];
  const client = {
    chartOfAccounts: {
      async findMany() {
        calls.push("account-read");
        return [
          { id: "bank", code: "1121", children: [] },
          { id: "equity", code: "3100", children: [] },
          { id: "group", code: "1000", children: [{ id: "bank" }] },
        ];
      },
    },
  } as unknown as PrismaClient;
  return { client, calls };
}

test("new business with empty opening balances has a zero balance without writing GL", async () => {
  const { client, calls } = mockClient();
  const result = await validateOpeningBalances([], client);
  assert.equal(result.valid, true);
  assert.equal(result.totalDebit, 0);
  assert.equal(result.totalCredit, 0);
  assert.deepEqual(calls, []);
});

test("balanced nonzero opening entries pass without posting GL", async () => {
  const { client, calls } = mockClient();
  const result = await validateOpeningBalances([
    { accountCode: "1121", debit: 100 },
    { accountCode: "3100", credit: 100 },
  ], client);
  assert.equal(result.valid, true);
  assert.equal(result.difference, 0);
  assert.deepEqual(calls, ["account-read"]);
});

test("unbalanced, group and dual-sided opening balances are blocked", async () => {
  const { client } = mockClient();
  const result = await validateOpeningBalances([
    { accountCode: "1000", debit: 100 },
    { accountCode: "3100", debit: 2, credit: 100 },
  ], client);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /group account/i);
  assert.match(result.errors.join(" "), /either a positive debit or credit/i);
  assert.match(result.errors.join(" "), /not balanced/i);
});

test("unknown accounts and negative opening amounts are blocked", async () => {
  const { client } = mockClient();
  const result = await validateOpeningBalances([
    { accountCode: "MISSING", debit: -10 },
  ], client);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /not found or is inactive/i);
  assert.match(result.errors.join(" "), /positive debit or credit/i);
});
