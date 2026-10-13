# Easynet Finance Hybrid ERP | Development handoff to UAT

**Baseline:** Phase 8 branch integration on top of `993ff33` (2026-10).  
**Handoff status:** Ready to **begin** functional UAT after local typecheck/build/regression confirmation. **Not** production go-live certified.

## Hybrid architecture
- Next.js 16 + TypeScript UI and API; Prisma-backed local SQLite and separately configured PostgreSQL production runtime.
- Legacy Google Apps Script integrations remain for selected compatibility document/conversion flows. These are **not** atomic with Prisma journals; conversion idempotency claims and human reconciliation protect uncertainty.
- PNG localisation: PGK, GST flows, Pacific/Port_Moresby dates, finance documents and reports.

## Delivered functional areas (UAT scope, not blanket acceptance)
1. **Company setup and masters:** company finance settings, GST certificate evidence, chart of accounts, customers, suppliers, items, projects, warehouses, cost centres, account mapping and bulk list actions. Check lifecycle constraints and restricted deletion on every master list.
2. **Sales:** quotations, sales orders, invoices, customer advances/allocations, receipts, delivery notes, refunds and returns. Test document links, partial settlements, GST and stock effects.
3. **Purchase:** supplier quotes, purchase orders, purchase receipts, bills, supplier advances/allocations, landed costs, supplier returns, PO commitments and partial billing.
4. **Inventory:** item master, warehouses, stock movement, movement valuation, adjustments, stock availability and reconciliation with inventory GL.
5. **Accounting and banking:** posted GL, trial balance, manual journal with independent maker-checker, reversal, FX rates/revaluation, account statements, cash flow, bank reconciliation, AR/AP ageing, period lock and deferred revenue.
6. **Other operations:** projects and profitability, budgets vs actuals, payroll register and posting controls, fixed assets, loans, audit/security/users, approval workflows, document evidence, dashboard.
7. **Management/reporting:** executive management insights, project margin, budget performance, forward AR/AP and cash forecasting, GST and general ledger reports.
8. **Reliability controls:** conversion claim uniqueness, failure quarantine, recovery review and existing unposted target resolution; audit logs; backup manifests/checksums; isolated SQLite restore; release readiness dashboard. Uncertain external outcomes are **not** automatically retried.

## Phase 8 verified versus unverified
| Item | Code available | Verified evidence / UAT gate |
|---|---|---|
| GL / AR / AP / stock / banking checks | Yes | Run live current-data reconciliation and investigate any variance |
| Conversion recovery | Queue, evidence review, four-type draft-target resolution | End-to-end UAT including missing, duplicate, partial and posted targets; no automatic blind retry |
| PostgreSQL | Runtime switch, isolated two-client contention script and go-live evidence gate | Run independent-client concurrency and failure drills against disposable PG QA |
| Permissions | Role mapping, server checks, manual-journal maker-checker | UAT role matrix, unauthorized API attempts, self-approval and session changes |
| Backup | SQLite backup/manifest and isolated restore drill, PostgreSQL attestation gates | Repeat SQLite drill against a current snapshot; execute real PostgreSQL restore/PITR in isolated environment |
| Final release | Go-Live Dashboard | All blocking checks and independent evidence must pass before production |

## Functional UAT order
1. Prepare **isolated UAT dataset** and an intact backup; record environment, revision and operator.
2. **Masters/setup**: new/existing company, mandatory GST certificate on registered status, COA linking, restricted deletion, disable/reactivate, bulk actions, desktop/table clarity.
3. **Sales lifecycle**: quote > order > delivery > invoice > partial/full receipt > credit/return; compare stock and GL/GST.
4. **Purchases lifecycle**: supplier quote > PO > receipt > bill > part/full payment > return; verify PO commitments and GST.
5. **Ledger and reconciliations**: journals, reversal, posting lock, AR/AP, stock, banks, payroll, fixed assets, FX, budgets and cash flow. Export reference balances.
6. **Security**: maker cannot approve or reject own manual journal, every role blocked from unauthorized mutation, evidence/audit immutable to ordinary users.
7. **Failure drills**: two simultaneous conversions, API failure after target creation, duplicate and missing target, recovery review, allowed existing-draft target resolution. Verify no double-posting.
8. **Backup and cutover**: checksum/integrity, isolated restore, compare journal counts/totals and open claims; PostgreSQL multi-instance and restore separately if UAT deployment uses PG.
9. Review Go-Live Dashboard and track all defects with reproduction steps, expected/actual result, screenshots, severity and retest result.

## Commands on Windows
```powershell
git fetch origin
git merge --ff-only origin/main
npm run typecheck
npm run build
npm run test:phase6
npm run test:phase7
npm run test:phase8
npm run db:uat:deep-audit
npm run db:uat:close-controls
npm run db:phase6:release-readiness
npm run db:restore:verify-isolated -- --file=<REAL-EXISTING-BACKUP-FILENAME.sqlite>
```

**PostgreSQL integration:** `npm run db:phase8:verify-postgres` requires explicit `EASYNET_RUN_PG_INTEGRATION=isolated`, a disposable `EASYNET_PHASE6_POSTGRES_TEST_URL`, correct generated PostgreSQL client/schema and a strictly named QA database; never use a live production URL.

## UAT exit criteria
- No critical/high defects in finance posting, duplicates, authentication, approval or restoration.
- Financial control totals match accepted evidence, or every variance has signed resolution.
- Complete traceability from source docs to journal and stock/bank flows.
- All role matrix and recovery tests witnessed.
- PostgreSQL multi-instance and restore/PITR evidence collected before **production** go-live, even if SQLite-only functional UAT passed.
- UAT sign-off is a business decision; successful compilation is not acceptance.

## Known unclosed risk
Legacy Apps Script steps and Prisma transactions cannot be made globally atomic without an architecture change. Any "target absent" retry needs independent target/source/journal verification and approved policy. This handoff deliberately leaves blind automatic retry disabled. No claim is made that external PostgreSQL QA or full UAT was executed by repository changes alone.
