# Easynet Finance ERP CTA standard (UI contract)

## Positions
- Main module: only navigation links/cards. Do not place duplicate create shortcuts next to the same doctype link.
- Doctype list: **View Existing** on the left, **Create New** immediately next to it. Disable direct creation for source-controlled doctypes, with a reason.
- Full document: status and document number in header; action toolbar below title, before editable fields. **Save Draft** primary, **Submit for Approval** primary at draft review, **Approve/Reject** checker-only, **Final Save / Post** approval-stage success, and **Reverse/Cancel** in a separately marked danger/warning group. Avoid multiple equally prominent primary actions.
- Table: selection checkbox in first data column, row actions at far right. Bulk actions next to selection count; never show a destructive action as the default.
- Mobile: wrap groups, retain keyboard focus indicators and >=40px tap targets.

## Workflow display matrix (recommendation, not backend authorization)

| State | Visible actions | Forbidden or withheld |
| --- | --- | --- |
| Draft | Edit, Save Draft, Delete Draft, Submit | Approve, Post, Reverse |
| Submitted / Pending Approval | Approve, Reject (checker); View | Edit/Delete without explicit withdraw workflow |
| Approved | Final Save / Post (authorized poster), Cancel only where supported | Delete or ordinary edit |
| Posted | View, Reverse with documented reason and matching authorization | Edit, Delete, ordinary Cancel |
| Rejected | View, Edit, Save Draft, Resubmit; Delete only when backend allows | Post |
| Cancelled | View | Edit, Delete, Post |

## Meaning of actions
- **Save Draft**: persist without ledger posting. Use a clear success notification with document reference, no implicit approval.
- **Submit for Approval**: validate mandatory fields and prevent duplicate submissions; display submission state and reviewer information.
- **Approve / Reject**: authorized checker must be distinct from maker where the backend requires maker-checker. Rejection requires reason.
- **Final Save / Post**: server must recheck approval, source integrity, period locks, GL balance, tax, stock, and idempotency.
- **Delete Draft**: destructive, confirmation and eligibility from backend; never delete posted/converted documents.
- **Cancel / Reverse**: cancellation and accounting reversal are different operations. Posted financial documents require authorized reversals and audit trail.
- **Disable / Activate**: master lifecycle, not deletion; preserve records linked to transactions.
- **Warnings**: inline near the problem; errors explain why and retain unsaved fields. Never rely on colour alone. Success messages show source document ID. Disabled CTA gets an explanation (title or adjacent text).

The `ErpActionButton` component provides labels, semantic colours, sizing, keyboard focus and optional confirmation. `documentActionVisible` is a **display recommendation only** and MUST NOT be used in place of backend permission or posting validation. Existing server checks remain authoritative.

## Rollout checklist
1. Master data registers and bulk lifecycle controls: shared CTA used.
2. Transaction doctype list/create: existing shared `ef-doctype-action` toolbar retained; unification with semantic component still to audit.
3. Full document view and approval actions: audit each doctype, preserve workflow-specific server gating and replace presentation only.
4. Dedicated journal, refund, stock, asset, bank, payroll and admin screens: audit and migrate.
5. Run typecheck, production build, regression tests and real UAT for all state transitions.

Do not claim global standardization completed before steps 2-5 are verified.
