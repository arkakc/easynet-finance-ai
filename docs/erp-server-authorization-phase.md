# Server-side company-scoped role permission groundwork

Provides authenticated, database-derived user role assignments and effective privilege checks. The request companyId is only a selector; it is rejected unless the validated session user has an active role grant in that company. No caller-provided role or userId is accepted.

GET /api/erp/role-capabilities?companyId=... returns a no-store capability snapshot for menus/data-entry UI. For writes, routes must call requireErpResourcePermission before mutations and separately apply document ownership, status, segregation of duties and atomic posting restrictions.

**Important:** Existing Finance, Purchase, Sales and Inventory mutation APIs have NOT been replaced or retrofitted. They use legacy role/permission infrastructure, and direct legacy internal-secret entry points require independent audit before migration. Capability snapshot is not enforcement for those legacy routes. No UI modifications or transactional UAT in this increment.

The new role tables must exist before enabling this endpoint. The database migration has not run. Integration test must verify two users and two real companies, revoked grant, cross-company denial, direct API access and accounting invariants. Do not mark this complete or merge to production as an active replacement for current authentication.
