import "server-only";

import { prisma } from "@/src/lib/prisma";
import { documentSeriesId } from "@/lib/accounting/document-numbering";

export type CostCenterRow = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  parentCode: string;
  parentName: string;
  isGroup: boolean;
  isActive: boolean;
  company: string;
  description: string;
  childCount: number;
  display: string;
};

type CostCenterDbRow = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  parentCode: string | null;
  parentName: string | null;
  isGroup: boolean | number;
  isActive: boolean | number;
  company: string | null;
  description: string | null;
  childCount: number | bigint;
};

const normalizeCode = (value: string) => String(value || "").trim().replace(/\s+/g, "-");
const codeFromName = (value: string) => normalizeCode(value).replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 40) || "Cost-Center";
const boolValue = (value: boolean | number) => value === true || value === 1;

function mapCostCenter(row: CostCenterDbRow): CostCenterRow {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    parentId: row.parentId || null,
    parentCode: row.parentCode || "",
    parentName: row.parentName || "",
    isGroup: boolValue(row.isGroup),
    isActive: boolValue(row.isActive),
    company: row.company || "",
    description: row.description || "",
    childCount: Number(row.childCount || 0),
    display: `${row.code} — ${row.name}`,
  };
}

export async function ensureCostCenterInfrastructure() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CostCenter" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "code" TEXT NOT NULL UNIQUE,
      "name" TEXT NOT NULL,
      "parentId" TEXT,
      "isGroup" BOOLEAN NOT NULL DEFAULT false,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "company" TEXT,
      "description" TEXT,
      "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CostCenter_parentId_idx" ON "CostCenter" ("parentId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CostCenter_code_idx" ON "CostCenter" ("code")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CostCenter_isActive_idx" ON "CostCenter" ("isActive")`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "CostCenter" ("id", "code", "name", "isGroup", "isActive", "company", "description", "createdAt", "updatedAt")
    SELECT 'CC-MAIN', 'Main', 'Main', false, true, 'Easynet', 'Default company cost center', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    WHERE NOT EXISTS (SELECT 1 FROM "CostCenter" WHERE "code" = 'Main')
  `);
}

export async function listCostCenters() {
  await ensureCostCenterInfrastructure();
  const rows = await prisma.$queryRawUnsafe<CostCenterDbRow[]>(`
    SELECT c.*,
      p."code" AS "parentCode",
      p."name" AS "parentName",
      (SELECT COUNT(*) FROM "CostCenter" child WHERE child."parentId" = c."id") AS "childCount"
    FROM "CostCenter" c
    LEFT JOIN "CostCenter" p ON p."id" = c."parentId"
    ORDER BY c."code" ASC
  `);
  return rows.map(mapCostCenter);
}

export async function findCostCenterByRef(ref: string) {
  const value = String(ref || "").split("—")[0].trim();
  if (!value) return null;
  const rows = await listCostCenters();
  const normalized = value.toLowerCase();
  return rows.find((row) => [row.id, row.code, row.name, row.display].some((candidate) => candidate.toLowerCase() === normalized)) || null;
}

export async function resolveCostCenterValue(ref: string | undefined, fallback = "Main") {
  const match = await findCostCenterByRef(ref || "");
  if (match?.isActive) return match.code;
  const fallbackMatch = await findCostCenterByRef(fallback);
  return fallbackMatch?.code || fallback;
}

export async function validateCostCenterRefs(refs: Array<{ key: string; value: string; required: boolean }>) {
  const rows = await listCostCenters();
  const active = rows.filter((row) => row.isActive);
  const errors: string[] = [];
  const byRef = (value: string) => {
    const normalized = String(value || "").split("—")[0].trim().toLowerCase();
    if (!normalized) return null;
    return active.find((row) => [row.id, row.code, row.name, row.display].some((candidate) => candidate.toLowerCase() === normalized)) || null;
  };
  for (const ref of refs) {
    if (!ref.value.trim()) {
      if (ref.required) errors.push(`${ref.key} is required`);
      continue;
    }
    if (!byRef(ref.value)) errors.push(`${ref.key} must link to an active Cost Center`);
  }
  return { valid: errors.length === 0, errors };
}

export async function createCostCenter(input: { code?: string; name: string; parentRef?: string; company?: string; description?: string; isActive?: boolean }) {
  await ensureCostCenterInfrastructure();
  const code = normalizeCode(input.code || codeFromName(input.name));
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Cost Center name is required");
  if (!code) throw new Error("Cost Center code is required");
  const existing = await findCostCenterByRef(code);
  if (existing) throw new Error(`Cost Center code already exists: ${code}`);
  const parent = input.parentRef ? await findCostCenterByRef(input.parentRef) : null;
  const id = documentSeriesId("Cost Center");
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CostCenter" ("id", "code", "name", "parentId", "isGroup", "isActive", "company", "description", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, false, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    id,
    code,
    name,
    parent?.id || null,
    input.isActive === false ? false : true,
    String(input.company || "Easynet"),
    String(input.description || ""),
  );
  if (parent) {
    await prisma.$executeRawUnsafe(`UPDATE "CostCenter" SET "isGroup" = true, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ?`, parent.id);
  }
  return findCostCenterByRef(code);
}

export async function updateCostCenter(input: { id: string; name?: string; parentRef?: string; isActive?: boolean; description?: string }) {
  await ensureCostCenterInfrastructure();
  const current = await findCostCenterByRef(input.id);
  if (!current) throw new Error("Cost Center not found");
  const parent = input.parentRef ? await findCostCenterByRef(input.parentRef) : null;
  if (parent && parent.id === current.id) throw new Error("A Cost Center cannot be its own parent");
  await prisma.$executeRawUnsafe(
    `UPDATE "CostCenter" SET "name" = ?, "parentId" = ?, "isActive" = ?, "description" = ?, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ?`,
    input.name !== undefined ? String(input.name || "").trim() : current.name,
    parent?.id || null,
    input.isActive === false ? false : true,
    input.description !== undefined ? String(input.description || "") : current.description,
    current.id,
  );
  if (parent) {
    await prisma.$executeRawUnsafe(`UPDATE "CostCenter" SET "isGroup" = true, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ?`, parent.id);
  }
  return findCostCenterByRef(current.id);
}
