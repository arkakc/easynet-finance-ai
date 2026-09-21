import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { databaseRuntimeInfo, prisma } from "@/src/lib/prisma";

export const databasePath = path.join(process.cwd(), "prisma", "dev.db");
export const databaseBackupDirectory = path.join(process.cwd(), "backups", "database");

export type DatabaseBackupManifest = {
  formatVersion: 1;
  fileName: string;
  createdAt: string;
  createdBy: string;
  reason: string;
  sizeBytes: number;
  sha256: string;
  integrity: "ok";
  engine: "sqlite";
  application: "easynet-finance-ai";
};

export type DatabaseBackupSummary = DatabaseBackupManifest & {
  manifestPresent: boolean;
};

function assertPathInside(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Unsafe backup path");
  }
}

export function resolveBackupPath(fileName: string) {
  if (!/^easynet-[0-9]{8}-[0-9]{6}-[a-f0-9]{8}\.sqlite$/i.test(fileName)) {
    throw new Error("Invalid backup file name");
  }
  const resolved = path.resolve(databaseBackupDirectory, fileName);
  assertPathInside(databaseBackupDirectory, resolved);
  return resolved;
}

function manifestPathFor(backupPath: string) {
  return `${backupPath}.json`;
}

function sqliteUrl(filePath: string) {
  return `file:${filePath.replace(/\\/g, "/")}`;
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function sha256(filePath: string) {
  const buffer = await fs.readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function pragmaResult(client: PrismaClient, pragma: "quick_check" | "integrity_check") {
  const rows = await client.$queryRawUnsafe<Array<Record<string, unknown>>>(`PRAGMA ${pragma}`);
  return rows.map((row) => String(Object.values(row)[0] ?? "").toLowerCase());
}

function assertSqliteRuntime() {
  const runtime = databaseRuntimeInfo();
  if (runtime.provider !== "sqlite") {
    throw new Error("SQLite backup/restore utilities are disabled while DATABASE_PROVIDER=postgresql; use managed PostgreSQL backups/PITR.");
  }
}

export async function verifyLiveDatabase() {
  assertSqliteRuntime();
  const checks = await pragmaResult(prisma, "quick_check");
  if (checks.length !== 1 || checks[0] !== "ok") {
    throw new Error(`Live database quick check failed: ${checks.join("; ") || "no result"}`);
  }
  return true;
}

export async function verifyDatabaseBackup(fileName: string) {
  const backupPath = resolveBackupPath(fileName);
  const manifestPath = manifestPathFor(backupPath);
  const rawManifest = await fs.readFile(manifestPath, "utf8").catch(() => null);
  if (!rawManifest) throw new Error("Backup manifest is missing");
  const manifest = JSON.parse(rawManifest) as DatabaseBackupManifest;
  if (manifest.fileName !== fileName) throw new Error("Backup manifest does not match the file");

  const [stats, actualChecksum] = await Promise.all([fs.stat(backupPath), sha256(backupPath)]);
  if (stats.size !== manifest.sizeBytes) throw new Error("Backup size does not match its manifest");
  if (actualChecksum !== manifest.sha256) throw new Error("Backup checksum mismatch");

  const client = new PrismaClient({ datasourceUrl: sqliteUrl(backupPath) });
  try {
    const checks = await pragmaResult(client, "integrity_check");
    if (checks.length !== 1 || checks[0] !== "ok") {
      throw new Error(`Backup integrity check failed: ${checks.join("; ") || "no result"}`);
    }
  } finally {
    await client.$disconnect();
  }

  return { manifest, verifiedAt: new Date().toISOString() };
}

export async function createDatabaseBackup(options?: { createdBy?: string; reason?: string }) {
  await verifyLiveDatabase();
  await fs.mkdir(databaseBackupDirectory, { recursive: true });

  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const fileName = `easynet-${stamp}-${randomUUID().slice(0, 8)}.sqlite`;
  const backupPath = resolveBackupPath(fileName);
  const temporaryPath = `${backupPath}.tmp`;

  try {
    await prisma.$executeRawUnsafe(`VACUUM INTO ${sqlString(temporaryPath.replace(/\\/g, "/"))}`);
    await fs.rename(temporaryPath, backupPath);

    const stats = await fs.stat(backupPath);
    const manifest: DatabaseBackupManifest = {
      formatVersion: 1,
      fileName,
      createdAt: now.toISOString(),
      createdBy: options?.createdBy?.trim() || "local-system",
      reason: options?.reason?.trim() || "Manual verified backup",
      sizeBytes: stats.size,
      sha256: await sha256(backupPath),
      integrity: "ok",
      engine: "sqlite",
      application: "easynet-finance-ai",
    };
    const manifestPath = manifestPathFor(backupPath);
    const temporaryManifestPath = `${manifestPath}.tmp`;
    await fs.writeFile(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporaryManifestPath, manifestPath);
    await verifyDatabaseBackup(fileName);
    return manifest;
  } catch (error) {
    await Promise.all([
      fs.rm(temporaryPath, { force: true }),
      fs.rm(`${manifestPathFor(backupPath)}.tmp`, { force: true }),
    ]);
    throw error;
  }
}

export async function listDatabaseBackups(): Promise<DatabaseBackupSummary[]> {
  assertSqliteRuntime();
  await fs.mkdir(databaseBackupDirectory, { recursive: true });
  const entries = await fs.readdir(databaseBackupDirectory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /^easynet-.*\.sqlite$/i.test(entry.name))
    .map((entry) => entry.name);

  const backups = await Promise.all(files.map(async (fileName) => {
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPathFor(resolveBackupPath(fileName)), "utf8")) as DatabaseBackupManifest;
      return { ...manifest, manifestPresent: true };
    } catch {
      const stats = await fs.stat(path.resolve(databaseBackupDirectory, fileName));
      return {
        formatVersion: 1 as const,
        fileName,
        createdAt: stats.birthtime.toISOString(),
        createdBy: "unknown",
        reason: "Manifest missing or invalid",
        sizeBytes: stats.size,
        sha256: "",
        integrity: "ok" as const,
        engine: "sqlite" as const,
        application: "easynet-finance-ai" as const,
        manifestPresent: false,
      };
    }
  }));

  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function pruneDatabaseBackups(maxCount: number) {
  if (!Number.isInteger(maxCount) || maxCount < 7 || maxCount > 365) {
    throw new Error("Backup retention count must be between 7 and 365");
  }
  const backups = await listDatabaseBackups();
  const removable = backups.slice(maxCount);
  for (const backup of removable) {
    const backupPath = resolveBackupPath(backup.fileName);
    await fs.rm(backupPath, { force: true });
    await fs.rm(manifestPathFor(backupPath), { force: true });
  }
  return removable.map((backup) => backup.fileName);
}
