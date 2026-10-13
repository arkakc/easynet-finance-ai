# Phase 5 conversion recovery and concurrency verification

The protected source-to-target routes are:
- Sales Quotation to Sales Order: `/api/erp/sales-order-conversion`
- Supplier Quotation to Purchase Order: `/api/erp/purchase-conversions`
- Purchase Order to Supplier Invoice: `/api/erp/purchase-conversions` and `/api/erp/conversions` (`poToBill`), sharing the same claim key
- Sales Quotation to Invoice: `/api/erp/conversions` (`quoteToInvoice`)

## Fail-closed behavior
A unique `ApprovalRequest.code` is acquired before the existing creation routine runs. Competing calls cannot acquire the same source+target claim **when all instances use the same SQLite database**. On confirmed success the claim becomes APPROVED. On exception or uncertain downstream outcome it becomes IN_REVIEW, remains unique, and **blocks retry**. Never automatically delete this claim: the Apps Script transaction and Prisma claim cannot be committed atomically.

An operator should check the source document, corresponding target records, their line rows, and accounting/stock side effects before manually resolving an IN_REVIEW claim. Only an authorized operator with an explicit reconciliation procedure should clear a claim after confirming *no target or side effect* exists. If an incomplete target exists, repair it instead of creating a duplicate.

## Release gates not covered by TypeScript build
1. Against an isolated shared database, submit two parallel valid conversions for the same source. Expect one creation and the other a claim conflict.
2. Simulate an error *after writing the target parent*, then retry. Expect the claim to block retry and require reconciliation.
3. Exercise both PO-to-Bill endpoints concurrently. Expect only one claim acquisition.
4. Validate source party/project/amount/item prefills and maker-checker/GST posting remain correct.
5. Exercise multiple app instances against the same DB; independent SQLite copies do not give cross-instance protection.
6. Validate mobile/tablet navigation and functional accounting UAT before release.

These gates are not represented as PASS until executed with an isolated backend and evidence.
