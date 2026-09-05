# Easynet Finance AI — v0.2.1 Fix Pass

This patch is a hardening/reliability pass over the v0.2.0 MVP.

## Backend reliability

- Serializes Apps Script calls inside each Next.js worker to avoid concurrent SpreadsheetApp bursts.
- Retries transient `404/429/5xx` responses for read-only backend actions only.
- Never auto-retries write actions, preventing duplicate writes after an uncertain network response.
- Validates backend response shapes so missing `rows` cannot crash pages with `.map()`.
- Adds richer HTTP/non-JSON error details.
- Apps Script backend version raised to `0.2.1`.
- `Code.gs` and `Code-v2.gs` are now identical.
- Bootstrap status validates both missing sheets and header/schema drift.
- Additive sheet-schema upgrades are supported when existing columns are an exact prefix.

## Journal/accounting integrity

- Generic external append/update access to `JournalHeaders`, `JournalLines`, and `AuditLog` is blocked.
- Adds a dedicated balanced `postJournal` backend action.
- Journal header + lines are written as one controlled operation with rollback of the header if line writing fails.
- Posting to parent/control accounts is blocked both in Next.js and Apps Script.
- Sales invoice posting now respects line-level revenue accounts.
- Supplier bill posting now respects line-level cost accounts.
- Payment allocation is rebuilt deterministically from posted payments, avoiding double-counted AR/AP balances.
- Payments cannot exceed the linked invoice/bill outstanding balance.
- Journal reversal synchronizes supported source documents/subledgers and blocks unsafe loan-journal reversal.

## Purchase/stock controls

- Stock movements are limited to STOCK items.
- Outbound stock cannot exceed on-hand quantity.
- Purchase receipts require an approved PO, matching project and matching PO item.
- Purchase receipt quantity cannot exceed PO quantity.
- Supplier bill posting enforces PO supplier/project/amount match and full receipt of STOCK items.
- Control Centre now checks ordered-vs-received quantity rather than only the existence of one receipt.
- PO-to-bill conversion uses `BILL_CREATED` until the supplier bill is actually posted, then becomes `BILLED`.
- Quote/PO conversions can recover safely from a prior partial line-write failure.

## Loan controls

- Adds controlled loan metadata fields and a `LoanEvents` audit table.
- Opening loan bootstrap records the disbursement event.
- Interest accrual uses the recorded outstanding balance and monthly-anniversary periods since the last approved accrual.
- Repayment is blocked if due anniversary interest has not first been accrued through the payment date.
- Loan dashboard/register use recorded accounting balances instead of projecting future interest as booked amounts.

## AI/source evidence

- Adds secondary duplicate detection using document number + type + party/project/date + amount.
- AI totals and line totals are reconciled and exceptions are persisted for Finance Controller review.
- Item codes are resolved to controlled Item master IDs where possible.
- Unmatched party/project/item and low-confidence extraction create review exceptions.
- If Drive retention succeeds but the document database write fails, the retained file is rolled back to trash.
- Adds source document types `SERVICE_COMPLETION`, `DELIVERY_NOTE`, and `GST_REGISTRATION`.

## Tax, master and management controls

- GST cannot be marked VERIFIED without a recorded GST number, evidence/reference note, and retained GST registration document.
- Project contract total must equal net + GST.
- Budget period is controlled to `ANNUAL` or `YYYY-MM`, with semantic duplicate prevention.
- Payment-schedule percentages/amounts are validated against the source total.
- Fixed assets require retained source evidence and duplicate serial numbers are blocked.
- Dashboard and core reports fail closed: backend failure displays `Unavailable` instead of misleading `K0.00` figures.

## Security/repository hygiene

- Adds security response headers and `noindex` metadata.
- Adds `.gitignore` and safe `.env.example`.
- No hard-coded OpenAI key, Apps Script token, APP_SECRET, or live Apps Script deployment URL is included in the patch.

## Deployment note

The Apps Script schema changed. Replace the bound Apps Script code with `apps-script/Code.gs`, save, run `bootstrapDatabase()`, then create/update the Web App deployment. After that, deploy the Next.js code and run `/setup/finance` once to seed the controlled chart of accounts and opening K500 loan/journal if the finance tables are still empty.

- Added public `bootstrapStatus()` Apps Script wrapper so schema health can be run from the editor UI.
