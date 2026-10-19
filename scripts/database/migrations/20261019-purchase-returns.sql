-- Additive PostgreSQL migration only: no existing tables or records removed.
-- Apply with: npx prisma db execute --file scripts/database/migrations/20261019-purchase-returns.sql --schema prisma/schema.prisma
CREATE TABLE IF NOT EXISTS "PurchaseReturn" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "linesJson" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "createdBy" TEXT NOT NULL,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseReturn_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "PurchaseReturn" ADD COLUMN IF NOT EXISTS "requestKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseReturn_requestKey_key" ON "PurchaseReturn"("requestKey");
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseReturn_code_key" ON "PurchaseReturn"("code");
CREATE INDEX IF NOT EXISTS "PurchaseReturn_receiptId_status_idx" ON "PurchaseReturn"("receiptId", "status");
CREATE INDEX IF NOT EXISTS "PurchaseReturn_purchaseOrderId_idx" ON "PurchaseReturn"("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "PurchaseReturn_supplierId_idx" ON "PurchaseReturn"("supplierId");
CREATE INDEX IF NOT EXISTS "PurchaseReturn_status_idx" ON "PurchaseReturn"("status");
