-- Additive role and company grant tables. Review and back up target PostgreSQL first.
-- Does not create or assign any role. Existing sessions remain legacy until activation.
CREATE TABLE IF NOT EXISTS "ErpUserRoleAssignment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "grantedById" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "ErpUserRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpUserRoleAssignment_companyId_userId_role_key" ON "ErpUserRoleAssignment" ("companyId","userId","role");
CREATE INDEX IF NOT EXISTS "ErpUserRoleAssignment_companyId_userId_isActive_idx" ON "ErpUserRoleAssignment" ("companyId","userId","isActive");
CREATE TABLE IF NOT EXISTS "ErpCompanyPrivilegeOverride" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "resourceKind" TEXT NOT NULL,
  "resourceName" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "allowed" BOOLEAN NOT NULL,
  "updatedById" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpCompanyPrivilegeOverride_companyId_role_resourceKind_resourceName_action_key"
  ON "ErpCompanyPrivilegeOverride" ("companyId","role","resourceKind","resourceName","action");
CREATE INDEX IF NOT EXISTS "ErpCompanyPrivilegeOverride_companyId_role_idx"
  ON "ErpCompanyPrivilegeOverride" ("companyId","role");
