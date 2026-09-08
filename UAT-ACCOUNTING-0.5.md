# EASYNET FINANCE AI — Accounting 0.5 UAT Gate

This checklist is the release gate for `feature/backend-split-0.4.0`. Do not merge the feature branch to `main` until every required test is PASS and the Reporting backend is upgraded to v0.4.1.

## Backend prerequisites

- Core Apps Script health: **v0.5.0**
- Document Apps Script health: **v0.4.0**
- Reporting Apps Script health: **v0.4.1**
- Reporting materializer refreshed after the v0.4.1 deployment
- No unbalanced posted journals in Finance Control Centre
- AR/AP/Inventory/Advance reconciliation exceptions reviewed before sign-off

## 1. Item Master

1. Create a STOCK item.
2. Confirm Item Code auto-generates and UOM is saved.
3. Confirm Moving Average Cost is read-only/system controlled.
4. Create a SERVICE item and confirm stock is not controlled.
5. For a deferred service item, confirm the deferred-revenue months and revenue account are saved.

**Expected:** PASS with permanent Item Master links used downstream.

## 2. Supplier Quotation

1. Create a Supplier Quotation with at least one existing item and one TEMP supplier item.
2. Save Draft and verify visible Saving state until completion.
3. Approve the quotation.
4. Resolve TEMP item to Item Master before PO conversion.
5. Convert to Purchase Order.

**Expected:** source quotation remains linked and auditable.

## 3. Purchase Order

1. Approve PO.
2. Verify PO itself creates no GL.
3. Verify GRN/Purchase Receipt CTA is active only for remaining STOCK quantity.
4. Verify Supplier Invoice CTA is available according to the PO lifecycle.

## 4. Partial Purchase Receipt / GRN

Receive only part of the ordered STOCK quantity.

**Expected GL:**

- Dr Inventory / Project Materials (`ACC-1150`)
- Cr Stock Received But Not Billed / GRNI (`ACC-2190`)

Verify:

- PO shows PARTIAL RECEIPT.
- Remaining quantity is correct.
- Over-receipt is blocked.
- Moving Average Cost updates correctly.
- Full receipt disables further receipt creation.

## 5. Partial Supplier Invoice

Create a Supplier Invoice after the partial receipt.

For STOCK lines, billed quantity must not exceed received quantity. Service/non-stock lines may bill against remaining ordered quantity.

**Expected STOCK GL:**

- Dr GRNI (`ACC-2190`) for receipt value cleared
- Dr Input GST (`ACC-1140`) where applicable
- Dr/Cr Purchase Price Variance (`ACC-5110`) as applicable
- Cr Accounts Payable (`ACC-2110`)

**Expected SERVICE/NON-STOCK GL:**

- Dr configured cost/expense account
- Dr Input GST (`ACC-1140`) where applicable
- Cr Accounts Payable (`ACC-2110`)

Verify partial billing does not fail solely because the whole PO has not been received or billed.

## 6. Purchase Price Variance

Test a supplier invoice rate within configured tolerance and one above tolerance.

- Within tolerance: posting allowed, PPV calculated where applicable.
- Above tolerance: posting blocked for review.

## 7. Supplier Payment

Make a partial supplier payment and then settle the remainder.

**Expected GL:**

- Dr Accounts Payable (`ACC-2110`)
- Cr selected Cash/Bank account

Verify lifecycle: `POSTED -> PARTLY_PAID -> PAID`.

## 8. Supplier Advance

Create a supplier advance against an approved PO before billing starts.

**Expected GL on Final Save:**

- Dr Supplier Advances (`ACC-1160`)
- Cr Cash/Bank

Allocate only part of the advance to a posted Supplier Invoice.

**Expected allocation GL:**

- Dr Accounts Payable (`ACC-2110`)
- Cr Supplier Advances (`ACC-1160`)

Verify remaining advance stays available and unrelated PO/invoice chains cannot consume it.

## 9. Sales Quotation and stock readiness

1. Create and approve a Sales Quotation.
2. Resolve any TEMP item to permanent Item Master.
3. Confirm stock readiness and backorder quantity.
4. If stock is short, follow the procurement flow and return to the quotation.
5. Create full or available-quantity Sales Invoice as appropriate.

## 10. Sales Invoice — revenue, GST and COGS

**Expected customer posting:**

- Dr Accounts Receivable (`ACC-1130`)
- Cr Revenue account(s)
- Cr Output GST (`ACC-2120`) where applicable

For STOCK items also expect:

- Dr configured COGS account, normally `ACC-5100`
- Cr Inventory (`ACC-1150`)

Verify stock cannot go negative and Moving Average Cost is used for COGS.

## 11. Customer Receipt

Post a partial receipt then the final receipt.

**Expected GL:**

- Dr Cash/Bank
- Cr Accounts Receivable (`ACC-1130`)

Verify lifecycle: `POSTED -> PARTLY_PAID -> PAID`.

## 12. Customer Advance

Create a deposit against an approved Sales Quotation.

**Expected GL on Final Save:**

- Dr Cash/Bank
- Cr Customer Advances / Unearned Revenue (`ACC-2150`)

Allocate part of the advance to a posted Sales Invoice.

**Expected allocation GL:**

- Dr Customer Advances (`ACC-2150`)
- Cr Accounts Receivable (`ACC-1130`)

Verify the remaining advance stays available for later linked invoices.

## 13. Deferred revenue

Use a non-stock/service item configured for deferred revenue.

Verify:

- Sales Invoice initially credits contract liability/deferred revenue rather than all immediate revenue.
- PaymentSchedules are generated.
- Scheduled recognition creates Dr Customer Advances / Cr Revenue.
- Scheduled recognition is idempotent and does not double-post.

## 14. Inventory valuation controls

Test each controlled adjustment:

- Landed Cost
- Revaluation
- NRV write-down
- Quantity adjustment where applicable

Verify stock movement value and GL stay synchronized and no parent/control account is posted directly.

## 15. Sales Return / Credit Note

Create a partial Sales Return from a posted Sales Invoice.

Verify:

- return quantity cannot exceed remaining returnable quantity;
- original Sales Invoice is not edited/deleted;
- Credit Note remains DRAFT until approved;
- revenue/GST reverses correctly;
- Accounts Receivable reduces first;
- excess becomes customer credit;
- STOCK returns at original issued cost;
- Inventory increases and COGS reverses.

## 16. Customer Refund

Where a posted Credit Note creates refundable customer credit, create and finalize a customer refund.

**Expected GL:**

- Dr Customer Advances / customer credit (`ACC-2150`)
- Cr Cash/Bank

Refund must not exceed available refundable credit.

## 17. PO partial close / backorder transfer

Partially receive a PO and close the unfulfilled remainder using the controlled close flow.

Verify:

- original PO history remains intact;
- no additional receipt is allowed against closed remainder;
- already received quantity remains billable;
- replacement/backorder PO links remain auditable if used.

## 18. Reports

After all posting tests:

- P&L uses only POSTED journals.
- Balance Sheet balance check is zero or explained.
- Cash Flow includes Cash, Operating Bank and Savings/Reserve Bank.
- GST report agrees to posted GST control accounts.
- AR aging agrees to AR subledger.
- AP aging agrees to AP subledger.
- Credit Notes reduce sales reporting correctly after Reporting v0.4.1 materialization.
- Project profitability comes from posted GL truth.

## 19. Finance Control Centre

Verify:

- no unbalanced posted journals;
- AR GL vs subledger difference is zero or explained;
- AP GL vs subledger difference is zero or explained;
- Inventory GL vs stock movement ledger difference is zero or explained;
- Customer Advance GL vs unallocated advance subledger difference is zero or explained;
- Supplier Advance GL vs unallocated advance subledger difference is zero or explained;
- partial PO/Supplier Invoice/Purchase Receipt matches do not produce false failures;
- real overbilling/overreceipt mismatches do produce exceptions.

## 20. Security / workflow controls

- Unauthenticated users are redirected/blocked.
- Role-restricted pages are inaccessible without permission.
- Settings reads require `settings.manage`.
- Legacy write endpoints cannot be called directly from the browser.
- Draft documents may be edited; posted/finalized documents are locked.
- Posted corrections use reversal/corrected journal rather than destructive edit.

## Final release decision

Release is **PASS** only when:

1. latest feature deployment is Vercel `READY`;
2. Core = v0.5.0, Reporting = v0.4.1, Document = v0.4.0;
3. Reporting materializer has refreshed successfully;
4. all required UAT tests above are PASS;
5. control-centre differences are zero or formally explained;
6. exposed development API tokens/passwords are rotated before production;
7. user approves merge to `main`.
