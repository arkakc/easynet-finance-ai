import { spawnSync } from "node:child_process";

type UatCase = {
  id: string;
  area: string;
  script: string;
  destructive?: boolean;
};

const cases: UatCase[] = [
  { id: "UAT-001", area: "Journal reversal", script: "test:journal-reversal" },
  { id: "UAT-002", area: "Single accounting source", script: "test:single-source" },
  { id: "UAT-003", area: "Atomic posting rollback", script: "test:atomic-posting" },
  { id: "UAT-004", area: "Atomic payment", script: "test:atomic-payment" },
  { id: "UAT-005", area: "Sales invoice posting", script: "test:atomic-sales-invoice" },
  { id: "UAT-006", area: "Supplier bill posting", script: "test:atomic-supplier-bill" },
  { id: "UAT-007", area: "Expense posting", script: "test:atomic-expense" },
  { id: "UAT-008", area: "Atomic stock posting", script: "test:atomic-stock" },
  { id: "UAT-009", area: "Partial advance allocation", script: "test:atomic-partial-advance" },
  { id: "UAT-010", area: "Sales return", script: "test:atomic-sales-return" },
  { id: "UAT-011", area: "Manual journal maker-checker", script: "test:manual-journal-approval" },
  { id: "UAT-012", area: "Period close and reopen", script: "test:period-close" },
  { id: "UAT-013", area: "Payment allocation", script: "test:payment-allocation" },
  { id: "UAT-014", area: "Warehouse stock", script: "test:warehouse-stock" },
  { id: "UAT-015", area: "Multi-currency and FX", script: "test:multi-currency" },
  { id: "UAT-016", area: "Financial statements", script: "test:financial-statements" },
  { id: "UAT-017", area: "Cash flow", script: "test:cash-flow" },
  { id: "UAT-018", area: "Subledger recovery", script: "test:subledger-recovery" },
  { id: "UAT-019", area: "Opening subledger", script: "test:opening-subledger" },
  { id: "UAT-020", area: "Payroll", script: "test:payroll" },
  { id: "UAT-021", area: "GST", script: "test:gst" },
  { id: "UAT-022", area: "Stock and assets", script: "test:stock-assets" },
  { id: "UAT-023", area: "Financial reconciliation", script: "test:financial-reconciliation" },
  { id: "UAT-024", area: "Reporting reconciliation hardening", script: "test:reporting-reconciliation" },
  { id: "UAT-025", area: "COA import", script: "test:coa-import" },
  { id: "UAT-026", area: "Setup workflow", script: "test:setup-workflow" },
  { id: "UAT-027", area: "Business route RBAC", script: "test:business-routes" },
  { id: "UAT-028", area: "Health endpoint", script: "test:health" },
  { id: "UAT-029", area: "Go-live blocker controls", script: "test:go-live" },
  { id: "UAT-030", area: "Transaction reset isolation", script: "test:transaction-reset" },
  { id: "UAT-031", area: "Master reset isolation", script: "test:master-reset" },
  { id: "UAT-032", area: "Security and audit controls", script: "test:security-audit" },
  { id: "UAT-033", area: "Master reset API", script: "test:master-reset-api", destructive: true },
];

function run(script: string) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  return spawnSync(command, ["run", script], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
}

async function main() {
  if (process.env.PHASE10_ISOLATED_UAT !== "1") {
    throw new Error(
      "Full UAT is intentionally locked to an isolated database/server. Set PHASE10_ISOLATED_UAT=1 only inside the Phase 10 isolated harness.",
    );
  }

  const results: Array<UatCase & { status: "PASS" | "FAIL"; exitCode: number }> = [];

  for (const test of cases) {
    console.log("\n" + "=".repeat(96));
    console.log(`${test.id} | ${test.area} | npm run ${test.script}${test.destructive ? " | ISOLATED-DESTRUCTIVE" : ""}`);
    console.log("=".repeat(96));

    const result = run(test.script);
    const exitCode = result.status ?? 1;
    results.push({ ...test, status: exitCode === 0 ? "PASS" : "FAIL", exitCode });
  }

  const failed = results.filter((row) => row.status === "FAIL");
  console.log("\n" + "=".repeat(96));
  console.log("PHASE 10 FULL UAT SIGN-OFF MATRIX");
  console.log("=".repeat(96));
  for (const row of results) {
    console.log(`${row.id.padEnd(8)} ${row.status.padEnd(5)} ${row.area}`);
  }
  console.log("-".repeat(96));
  console.log(`TOTAL: ${results.length} | PASS: ${results.length - failed.length} | FAIL: ${failed.length}`);

  console.log(JSON.stringify({
    phase: 10,
    database: "isolated SQLite UAT database",
    liveDatabaseChanged: false,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    migrationToPostgresAllowed: failed.length === 0,
    failures: failed.map(({ id, area, script, exitCode }) => ({ id, area, script, exitCode })),
  }, null, 2));

  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
