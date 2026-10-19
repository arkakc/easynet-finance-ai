-- Additive ERP approval storage. No backfill or replacement of legacy approvals.
-- Run only through the controlled PostgreSQL migration procedure after review.
CREATE TABLE IF NOT EXISTS "ErpApprovalCase" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "documentKind" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "creatorUserId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "amountPgk" DECIMAL(18,2) NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "activeStepIndex" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpApprovalCase_companyId_documentKind_documentId_key" ON "ErpApprovalCase" ("companyId","documentKind","documentId");
CREATE INDEX IF NOT EXISTS "ErpApprovalCase_companyId_status_updatedAt_idx" ON "ErpApprovalCase" ("companyId","status","updatedAt");

CREATE TABLE IF NOT EXISTS "ErpApprovalStep" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "caseId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "requiredRole" TEXT NOT NULL,
  "assignedUserId" TEXT,
  "decidedByUserId" TEXT,
  "decision" TEXT NOT NULL DEFAULT 'PENDING',
  "decisionNote" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErpApprovalStep_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ErpApprovalCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpApprovalStep_caseId_ordinal_key" ON "ErpApprovalStep" ("caseId","ordinal");
CREATE INDEX IF NOT EXISTS "ErpApprovalStep_assignedUserId_decision_idx" ON "ErpApprovalStep" ("assignedUserId","decision");

CREATE TABLE IF NOT EXISTS "ErpApprovalEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "caseId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "fromStatus" TEXT NOT NULL,
  "toStatus" TEXT NOT NULL,
  "note" TEXT,
  "payloadJson" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErpApprovalEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ErpApprovalCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ErpApprovalEvent_caseId_occurredAt_idx" ON "ErpApprovalEvent" ("caseId","occurredAt");

CREATE TABLE IF NOT EXISTS "ErpApprovalPolicyVersion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "limitsJson" JSONB NOT NULL,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpApprovalPolicyVersion_companyId_version_key" ON "ErpApprovalPolicyVersion" ("companyId","version");
CREATE INDEX IF NOT EXISTS "ErpApprovalPolicyVersion_companyId_status_idx" ON "ErpApprovalPolicyVersion" ("companyId","status");
