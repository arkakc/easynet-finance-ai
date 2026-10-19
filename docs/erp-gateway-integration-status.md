# ERP gateway authorization integration — scoped rollout

Added exact approval-type capability mapping and tests. Unmapped mixed routes (stock, payment, expense, quote, master-data) are intentionally excluded rather than assuming a wrong DocType or permission. Existing route permission checks remain authoritative until activation.

**Do not enforce these new roles on existing live actions until company identity is server-validated, users are provisioned, and every direct route is audited**. A client-supplied companyId is not authorization. Routes relying on internal APP_SECRET must also be included in full enforcement, otherwise wrapping /api/erp/actions alone is incomplete.

Pending: role grant admin API and audit, migration rehearsal, per-route legacy endpoint enforcement, field-level UI read/write restrictions, realistic dual-user multi-company UAT, and posting reconciliation.
