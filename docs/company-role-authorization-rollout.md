# Company-scoped ERP role assignment — incremental implementation

This phase introduces explicit user/company/role rows and company-specific capability overrides, plus a default-deny pure evaluation helper and regression tests.

**It is not yet a complete deployment of role privileges.** Legacy user authentication currently has a single User.role and there is no trusted per-request active-company identity contract. Therefore API enforcement must not be switched on or UI permissions derived from a user-supplied company ID before the context is established.

Rollout requirements:
1. Determine the trusted active-company context from server-side session/membership, with tests preventing company spoofing.
2. Create authenticated role administration endpoints with System Manager provisioning, independent elevation approval and session invalidation.
3. Add document endpoint-by-endpoint authenticated authorization wrappers; never use UI hiding as the only control.
4. Add role-aware menu and data-entry component states based on server-derived effective permissions.
5. Perform migration dry-run against a backup, then end-to-end tests on actual finance and stock transactions and reconciliation before enabling.

The new schema is additive and **has not been applied to an existing database**. Current finance and inventory posting code remains untouched.
