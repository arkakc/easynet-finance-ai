# Phase 5 — Role-specific Approval Inbox preview

This phase is stacked on #317 (and #316, #315, #314). It is **UI-only** and cannot approve live records.

## Added

- Read-only role-filtered inbox view model, displaying company, role, assignment and anti-self-review restrictions for illustration.
- A dedicated `/approvals/workflow-preview` page using clearly marked synthetic data only.
- Search, role selector, pending count/value and responsive table using existing design classes.
- Unit tests for inbox filtering and default-deny when actor context is absent.

## Existing behavior unchanged

- The existing live `/approvals` page is **not modified**.
- No new live approval endpoint exists; no mutation controls are provided.
- Existing document APIs, accounting posting, inventory movement and user authentication are untouched.

## Security/UAT blockers

- Presentation filtering is not an authorization boundary; live API must query by authenticated tenant/company/user permissions.
- Approvals need company membership mapping, step ownership, immutable audit and all Phase 3/4 outstanding fixes.
- Demo data must never be mixed with production data.
- Need Next/React typecheck, accessibility, role UX and browser tests.
- Keep draft until implementation is validated and all prior phase PRs are reviewed.
