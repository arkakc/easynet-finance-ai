import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { createDatabaseBackup, resolveBackupPath, verifyLiveDatabase } from "../../lib/system/database-backup";
import {
  buildFinancialReconciliationSnapshot,
  compareFinancialSnapshots,
  listFinancialReconciliationSnapshots,
  saveFinancialReconciliationSnapshot,
  type FinancialReconciliationSnapshot,
  type SnapshotComparison,
} from "../../lib/system/financial-reconciliation";
import { prisma } from "../../src/lib/prisma";

type FieldMeta = {
  name: string;
  dbName: string | null;
  kind: "scalar" | "enum" | "object" | "unsupported";
  type: string;
  relationFromFields?: string[];
  relationToFields?: string[];
};

type ModelMeta = {
  name: string;
  dbName: string | null;
  fields: FieldMeta[];
};

type TablePlan = {
  model: ModelMeta;
  table: string;
  dependencies: string[];
  selfRelations: Array<{ from: string[]; to: string[] }>;
};

type TableResult = { table: string; sourceRows: number; targetRows: number; matched: boolean };

const generatedClientEntry = path.resolve(process.cwd(), "prisma", "generated", "postgresql-client", "index.js");
const generatedSchemaPath = path.resolve(process.cwd(), "prisma", "generated", "schema.postgresql.prisma");
const migrationReportDirectory = path.join(process.cwd(), "backups", "migration");

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function modelTable(model: ModelMeta) {
  return model.dbName || model.name;
}

function createTransferPlan() {
  const models = Prisma.dmmf.datamodel.models as unknown as ModelMeta[];
  const tableByModel = new Map(models.map((model) => [model.name, modelTable(model)]));
  const planByTable = new Map<string, TablePlan>();
  for (const model of models) {
    const table = modelTable(model);
    const dependencies = new Set<string>();
    const selfRelations: TablePlan["selfRelations"] = [];
    for (const field of model.fields.filter((item) => item.kind === "object" && item.relationFromFields?.length)) {
      const target = tableByModel.get(field.type);
      if (!target) throw new Error(`Unknown relation target ${field.type} on ${model.name}.${field.name}`);
      if (target === table) selfRelations.push({ from: field.relationFromFields || [], to: field.relationToFields || [] });
      else dependencies.add(target);
    }
    planByTable.set(table, { model, table, dependencies: [...dependencies], selfRelations });
  }

  const ordered: TablePlan[] = [];
  const remaining = new Map(planByTable);
  while (remaining.size) {
    const ready = [...remaining.values()]
      .filter((table) => table.dependencies.every((dependency) => !remaining.has(dependency)))
      .sort((a, b) => a.table.localeCompare(b.table));
    if (!ready.length) {
      const cycles = [...remaining.values()].map((table) => `${table.table}->${table.dependencies.filter((dependency) => remaining.has(dependency)).join(",")}`);
      throw new Error(`Cross-table foreign-key cycle detected: ${cycles.join("; ")}`);
    }
    for (const table of ready) {
      ordered.push(table);
      remaining.delete(table.table);
    }
  }
  return ordered;
}

function relationKey(row: Record<string, unknown>, columns: string[]) {
  return JSON.stringify(columns.map((column) => row[column] ?? null));
}

function orderRowsForSelfRelations(rows: Array<Record<string, unknown>>, relations: TablePlan["selfRelations"]) {
  if (!relations.length || rows.length < 2) return rows;
  const remaining = [...rows];
  const ordered: Array<Record<string, unknown>> = [];
  const availableKeys = relations.map((relation) => new Set(rows.map((row) => relationKey(row, relation.to))));
  const insertedKeys = relations.map(() => new Set<string>());
  while (remaining.length) {
    const index = remaining.findIndex((row) => relations.every((relation, relationIndex) => {
      const values = relation.from.map((column) => row[column]);
      if (values.every((value) => value === null || value === undefined)) return true;
      const key = JSON.stringify(values);
      return !availableKeys[relationIndex].has(key) || insertedKeys[relationIndex].has(key);
    }));
    if (index < 0) throw new Error("Self-referential row cycle detected");
    const [row] = remaining.splice(index, 1);
    ordered.push(row);
    relations.forEach((relation, relationIndex) => insertedKeys[relationIndex].add(relationKey(row, relation.to)));
  }
  return ordered;
}

function convertValue(value: unknown, field: FieldMeta) {
  if (value === null || value === undefined) return null;
  if (field.kind === "enum") return String(value);
  if (field.type === "Boolean") return typeof value === "boolean" ? value : Number(value) !== 0;
  if (field.type === "Int" || field.type === "Float") return Number(value);
  if (field.type === "BigInt") return typeof value === "bigint" ? value : BigInt(String(value));
  if (field.type === "Decimal") return typeof value === "number" ? value : String(value);
  if (field.type === "DateTime") {
    if (value instanceof Date) return value;
    const date = typeof value === "bigint" || typeof value === "number" || /^\d{10,}$/.test(String(value))
      ? new Date(Number(value))
      : new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid DateTime value for ${field.name}`);
    return date;
  }
  if (field.type === "Bytes" && !Buffer.isBuffer(value)) return Buffer.from(value as ArrayBuffer);
  return value;
}

async function sourceRows(client: PrismaClient, plan: TablePlan) {
  const rows = await client.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM ${quoteIdentifier(plan.table)}`);
  return orderRowsForSelfRelations(rows, plan.selfRelations);
}

async function rowCount(client: Pick<PrismaClient, "$queryRawUnsafe">, table: string) {
  const rows = await client.$queryRawUnsafe(`SELECT COUNT(*) AS "count" FROM ${quoteIdentifier(table)}`) as Array<{ count: bigint | number }>;
  return Number(rows[0]?.count || 0);
}

async function insertTable(target: Pick<PrismaClient, "$executeRawUnsafe">, plan: TablePlan, rows: Array<Record<string, unknown>>) {
  const fields = plan.model.fields.filter((field) => field.kind === "scalar" || field.kind === "enum");
  const fieldByColumn = new Map(fields.map((field) => [field.dbName || field.name, field]));
  for (const row of rows) {
    const columns = Object.keys(row);
    const values = columns.map((column) => {
      const field = fieldByColumn.get(column);
      if (!field) throw new Error(`Column ${plan.table}.${column} is absent from the generated PostgreSQL model`);
      return convertValue(row[column], field);
    });
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const statement = `INSERT INTO ${quoteIdentifier(plan.table)} (${columns.map(quoteIdentifier).join(", ")}) VALUES (${placeholders})`;
    await target.$executeRawUnsafe(statement, ...values);
  }
}

function validateTargetUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("DATABASE_URL_POSTGRES is not a valid URL"); }
  if (!url.protocol.startsWith("postgres")) throw new Error("DATABASE_URL_POSTGRES must use postgresql:// or postgres://");
  if (!url.hostname || !url.pathname || url.pathname === "/") throw new Error("DATABASE_URL_POSTGRES must identify a dedicated database");
  return { raw, identity: `${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}` };
}

async function loadTargetClient(databaseUrl: string) {
  await fs.access(generatedClientEntry).catch(() => {
    throw new Error("PostgreSQL client is not generated. Run npm run db:postgres:client first.");
  });
  const module = await import(pathToFileURL(generatedClientEntry).href) as { PrismaClient: new (options: { datasourceUrl: string }) => PrismaClient };
  return new module.PrismaClient({ datasourceUrl: databaseUrl });
}

async function targetTables(target: PrismaClient) {
  return target.$queryRawUnsafe<Array<{ tableName: string }>>(
    `SELECT table_name AS "tableName" FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
}

function pushPostgresSchema(databaseUrl: string) {
  const prismaCliPath = path.resolve(process.cwd(), "node_modules", "prisma", "build", "index.js");
  const result = spawnSync(process.execPath, [prismaCliPath, "db", "push", "--skip-generate", "--schema", generatedSchemaPath], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL_POSTGRES: databaseUrl },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const safeMessage = `${result.stdout || ""}\n${result.stderr || ""}`.replaceAll(databaseUrl, "[REDACTED_DATABASE_URL]").trim();
    throw new Error(`PostgreSQL schema creation failed: ${safeMessage}`);
  }
}

function reportFingerprint(value: object) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function saveMigrationReport(input: {
  target: string;
  backupFile: string;
  baseline: FinancialReconciliationSnapshot;
  comparison: SnapshotComparison;
  tables: TableResult[];
}) {
  await fs.mkdir(migrationReportDirectory, { recursive: true });
  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const content = {
    formatVersion: 1,
    generatedAt,
    target: input.target,
    sourceBackup: input.backupFile,
    baselineFile: input.baseline.fileName,
    baselineFingerprint: input.baseline.fingerprint,
    comparison: input.comparison,
    tables: input.tables,
    status: input.comparison.passed && input.tables.every((table) => table.matched) ? "PASSED" : "FAILED",
  };
  const report = { ...content, fingerprint: reportFingerprint(content) };
  const fileName = `postgres-transfer-${stamp}.json`;
  const target = path.join(migrationReportDirectory, fileName);
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await fs.rename(temporary, target);
  return { fileName, report };
}

async function preflight() {
  await verifyLiveDatabase();
  const plan = createTransferPlan();
  const snapshots = await listFinancialReconciliationSnapshots();
  const baseline = snapshots[0];
  if (!baseline) throw new Error("No fingerprint-verified financial baseline exists");
  if (!baseline.controls.migrationReady) throw new Error(`Latest financial baseline is not migration-ready: ${baseline.controls.exceptions.join("; ")}`);
  const tables = [];
  for (const table of plan) {
    const rows = await sourceRows(prisma, table);
    const fieldByColumn = new Map(table.model.fields
      .filter((field) => field.kind === "scalar" || field.kind === "enum")
      .map((field) => [field.dbName || field.name, field]));
    for (const row of rows) {
      for (const [column, value] of Object.entries(row)) {
        const field = fieldByColumn.get(column);
        if (!field) throw new Error(`Source column ${table.table}.${column} is absent from the generated transfer model`);
        convertValue(value, field);
      }
    }
    tables.push({ table: table.table, rows: rows.length, dependencies: table.dependencies });
  }
  const totalRows = tables.reduce((sum, table) => sum + table.rows, 0);
  console.log(`PostgreSQL transfer preflight passed: ${tables.length} tables, ${totalRows} rows.`);
  console.log(`Signed financial baseline: ${baseline.fileName} (${baseline.fingerprint.slice(0, 12)}...).`);
  console.log(`Foreign-key order validated. Self-referential tables: ${plan.filter((table) => table.selfRelations.length).map((table) => table.table).join(", ") || "none"}.`);
  console.log("No target connection was attempted and no data was changed.");
}

async function transfer() {
  if (argument("confirm") !== "TRANSFER_TO_EMPTY_POSTGRES") {
    throw new Error("Transfer requires --confirm=TRANSFER_TO_EMPTY_POSTGRES");
  }
  const databaseUrl = process.env.DATABASE_URL_POSTGRES?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL_POSTGRES is not configured");
  const targetInfo = validateTargetUrl(databaseUrl);
  await verifyLiveDatabase();

  const backup = await createDatabaseBackup({ createdBy: process.env.USERNAME || "local-operator", reason: "Pre-PostgreSQL-transfer immutable source snapshot" });
  const source = new PrismaClient({ datasourceUrl: `file:${resolveBackupPath(backup.fileName).replace(/\\/g, "/")}` });
  let target = await loadTargetClient(targetInfo.raw);
  try {
    const existingTables = await targetTables(target);
    if (existingTables.length) throw new Error(`Target schema is not empty (${existingTables.length} table(s) found). Use a new dedicated database/schema.`);
    await target.$disconnect();
    pushPostgresSchema(targetInfo.raw);
    target = await loadTargetClient(targetInfo.raw);

    const baseline = await saveFinancialReconciliationSnapshot({ client: source, generatedBy: process.env.USERNAME || "local-operator", source: "local-sqlite" });
    if (!baseline.controls.migrationReady) throw new Error(`Source baseline is not migration-ready: ${baseline.controls.exceptions.join("; ")}`);
    const plan = createTransferPlan();
    const sourceData = new Map<string, Array<Record<string, unknown>>>();
    for (const table of plan) sourceData.set(table.table, await sourceRows(source, table));

    const transferResult = await target.$transaction(async (transaction) => {
      const results: TableResult[] = [];
      for (const table of plan) {
        const rows = sourceData.get(table.table) || [];
        await insertTable(transaction, table, rows);
        const targetRows = await rowCount(transaction, table.table);
        results.push({ table: table.table, sourceRows: rows.length, targetRows, matched: rows.length === targetRows });
      }
      if (results.some((table) => !table.matched)) throw new Error("Target row-count reconciliation failed; transfer rolled back");
      const targetSnapshot = await buildFinancialReconciliationSnapshot({
        client: transaction as unknown as PrismaClient,
        asOf: baseline.asOf,
        generatedBy: "postgres-transfer",
        source: "postgresql-target",
      });
      const comparison = compareFinancialSnapshots(baseline, targetSnapshot);
      if (!comparison.passed) throw new Error("Financial reconciliation failed; transfer rolled back");
      return { tableResults: results, comparison };
    }, { maxWait: 10_000, timeout: 30 * 60 * 1000 });

    const { tableResults, comparison } = transferResult;
    const saved = await saveMigrationReport({ target: targetInfo.identity, backupFile: backup.fileName, baseline, comparison, tables: tableResults });
    const auditUser = await prisma.user.findFirst({ where: { status: "ACTIVE", role: "SYSTEM_MANAGER" }, orderBy: { createdAt: "asc" } });
    if (auditUser) await prisma.auditLog.create({ data: {
      action: "MIGRATE",
      entityType: "DATABASE",
      entityCode: targetInfo.identity,
      description: "Completed controlled SQLite to PostgreSQL transfer with row-count and financial reconciliation",
      changes: JSON.stringify({ report: saved.fileName, sourceBackup: backup.fileName, baseline: baseline.fileName }),
      userId: auditUser.id,
    } });
    console.log(`PostgreSQL transfer PASSED: ${tableResults.length} tables, ${tableResults.reduce((sum, table) => sum + table.targetRows, 0)} rows.`);
    console.log(`Financial controls: ${comparison.differences.length}/${comparison.differences.length} matched.`);
    console.log(`Migration report: ${saved.fileName}`);
    console.log("Application datasource was not switched. Review and approve the report before cutover.");
  } finally {
    await Promise.allSettled([source.$disconnect(), target.$disconnect()]);
  }
}

const mode = argument("mode") || "preflight";
(mode === "transfer" ? transfer() : mode === "preflight" ? preflight() : Promise.reject(new Error("--mode must be preflight or transfer")))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
