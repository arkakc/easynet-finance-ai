import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";

type ScheduleClient = Prisma.TransactionClient | PrismaClient;

export type PaymentScheduleRow = {
  scheduleId: string;
  sourceType: string;
  sourceId: string;
  projectId: string;
  partyId: string;
  milestone: string;
  dueDate: string;
  percentage: number;
  amount: number;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type DbRow = {
  scheduleId: string;
  sourceType: string;
  sourceId: string;
  projectId: string | null;
  partyId: string | null;
  milestone: string;
  dueDate: string | null;
  percentage: number | string;
  amount: number | string;
  status: string;
  createdBy: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const iso = (value: Date | string) => value instanceof Date ? value.toISOString() : String(value || "");

function mapRow(row: DbRow): PaymentScheduleRow {
  return {
    scheduleId: row.scheduleId,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    projectId: row.projectId || "",
    partyId: row.partyId || "",
    milestone: row.milestone,
    dueDate: row.dueDate || "",
    percentage: Number(row.percentage || 0),
    amount: Number(row.amount || 0),
    status: row.status,
    createdBy: row.createdBy || "",
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function ensurePaymentScheduleInfrastructure(client: ScheduleClient = prisma) {
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PaymentSchedule" (
      "scheduleId" TEXT NOT NULL PRIMARY KEY,
      "sourceType" TEXT NOT NULL,
      "sourceId" TEXT NOT NULL,
      "projectId" TEXT,
      "partyId" TEXT,
      "milestone" TEXT NOT NULL,
      "dueDate" TEXT,
      "percentage" DECIMAL NOT NULL DEFAULT 0,
      "amount" DECIMAL NOT NULL DEFAULT 0,
      "status" TEXT NOT NULL DEFAULT 'PENDING',
      "createdBy" TEXT,
      "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PaymentSchedule_source_idx" ON "PaymentSchedule" ("sourceType", "sourceId")`);
  await client.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PaymentSchedule_due_idx" ON "PaymentSchedule" ("dueDate")`);
  await client.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PaymentSchedule_status_idx" ON "PaymentSchedule" ("status")`);
}

export async function listPaymentSchedules(limit = 100, offset = 0, client: ScheduleClient = prisma) {
  await ensurePaymentScheduleInfrastructure(client);
  const rows = await client.$queryRaw<DbRow[]>(Prisma.sql`
    SELECT
      "scheduleId", "sourceType", "sourceId", "projectId", "partyId",
      "milestone", "dueDate", "percentage", "amount", "status",
      "createdBy", "createdAt", "updatedAt"
    FROM "PaymentSchedule"
    ORDER BY "dueDate" ASC, "scheduleId" ASC
    LIMIT ${limit} OFFSET ${offset}
  `);
  return rows.map(mapRow);
}

export async function findPaymentSchedules(
  sourceType: string,
  sourceId: string,
  client: ScheduleClient = prisma,
) {
  await ensurePaymentScheduleInfrastructure(client);
  const rows = await client.$queryRaw<DbRow[]>(Prisma.sql`
    SELECT
      "scheduleId", "sourceType", "sourceId", "projectId", "partyId",
      "milestone", "dueDate", "percentage", "amount", "status",
      "createdBy", "createdAt", "updatedAt"
    FROM "PaymentSchedule"
    WHERE "sourceType" = ${sourceType} AND "sourceId" = ${sourceId}
    ORDER BY "dueDate" ASC, "scheduleId" ASC
  `);
  return rows.map(mapRow);
}

export async function insertPaymentSchedule(
  input: Record<string, unknown>,
  actor = "web-app",
  client: ScheduleClient = prisma,
) {
  await ensurePaymentScheduleInfrastructure(client);
  const scheduleId = String(input.scheduleId || "").trim();
  const sourceType = String(input.sourceType || "").trim();
  const sourceId = String(input.sourceId || "").trim();
  const milestone = String(input.milestone || "").trim();
  if (!scheduleId || !sourceType || !sourceId || !milestone) {
    throw new Error("Payment Schedule requires scheduleId, sourceType, sourceId and milestone");
  }

  await client.$executeRaw(Prisma.sql`
    INSERT INTO "PaymentSchedule" (
      "scheduleId", "sourceType", "sourceId", "projectId", "partyId",
      "milestone", "dueDate", "percentage", "amount", "status",
      "createdBy", "createdAt", "updatedAt"
    ) VALUES (
      ${scheduleId},
      ${sourceType},
      ${sourceId},
      ${String(input.projectId || "") || null},
      ${String(input.partyId || "") || null},
      ${milestone},
      ${String(input.dueDate || "") || null},
      ${Number(input.percentage || 0)},
      ${Number(input.amount || 0)},
      ${String(input.status || "PENDING")},
      ${actor},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `);

  const rows = await client.$queryRaw<DbRow[]>(Prisma.sql`
    SELECT
      "scheduleId", "sourceType", "sourceId", "projectId", "partyId",
      "milestone", "dueDate", "percentage", "amount", "status",
      "createdBy", "createdAt", "updatedAt"
    FROM "PaymentSchedule"
    WHERE "scheduleId" = ${scheduleId}
  `);
  if (!rows[0]) throw new Error("Payment Schedule could not be reloaded after insert");
  return mapRow(rows[0]);
}

export async function updatePaymentSchedule(
  scheduleId: string,
  patch: Record<string, unknown>,
  client: ScheduleClient = prisma,
) {
  await ensurePaymentScheduleInfrastructure(client);
  const currentRows = await client.$queryRaw<DbRow[]>(Prisma.sql`
    SELECT
      "scheduleId", "sourceType", "sourceId", "projectId", "partyId",
      "milestone", "dueDate", "percentage", "amount", "status",
      "createdBy", "createdAt", "updatedAt"
    FROM "PaymentSchedule"
    WHERE "scheduleId" = ${scheduleId}
  `);
  const current = currentRows[0];
  if (!current) throw new Error(`Payment Schedule ${scheduleId} not found`);

  await client.$executeRaw(Prisma.sql`
    UPDATE "PaymentSchedule"
    SET
      "projectId" = ${patch.projectId !== undefined ? (String(patch.projectId || "") || null) : current.projectId},
      "partyId" = ${patch.partyId !== undefined ? (String(patch.partyId || "") || null) : current.partyId},
      "milestone" = ${patch.milestone !== undefined ? String(patch.milestone || "") : current.milestone},
      "dueDate" = ${patch.dueDate !== undefined ? (String(patch.dueDate || "") || null) : current.dueDate},
      "percentage" = ${patch.percentage !== undefined ? Number(patch.percentage || 0) : Number(current.percentage || 0)},
      "amount" = ${patch.amount !== undefined ? Number(patch.amount || 0) : Number(current.amount || 0)},
      "status" = ${patch.status !== undefined ? String(patch.status || "") : current.status},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "scheduleId" = ${scheduleId}
  `);

  const rows = await client.$queryRaw<DbRow[]>(Prisma.sql`
    SELECT
      "scheduleId", "sourceType", "sourceId", "projectId", "partyId",
      "milestone", "dueDate", "percentage", "amount", "status",
      "createdBy", "createdAt", "updatedAt"
    FROM "PaymentSchedule"
    WHERE "scheduleId" = ${scheduleId}
  `);
  return mapRow(rows[0]);
}
