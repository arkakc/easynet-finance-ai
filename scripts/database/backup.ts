import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import { loadEnvFile } from "node:process";
import path from "node:path";

// PostgreSQL-only backup: no SQLite files, PRAGMA, or VACUUM INTO.
const envFile = path.resolve(".env.local");
if (existsSync(envFile)) loadEnvFile(envFile);
if (process.env.DATABASE_PROVIDER && process.env.DATABASE_PROVIDER !== "postgresql") {
  throw new Error("Backups require PostgreSQL");
}
const url = process.env.DATABASE_URL_POSTGRES;
if (!url) throw new Error("DATABASE_URL_POSTGRES is required");
const target = new URL(url);
if (!["postgres:", "postgresql:"].includes(target.protocol)) throw new Error("Not a PostgreSQL URL");
if (!target.hostname || !target.pathname.slice(1)) throw new Error("Incomplete PostgreSQL URL");
const binaryDir = process.env.POSTGRES_BIN_DIR || (process.platform === "win32" ? "C:\\Program Files\\PostgreSQL\\17\\bin" : "");
const bin = (name: string) => binaryDir ? path.join(binaryDir, process.platform === "win32" ? name + ".exe" : name) : name;
const pgEnv = {
  ...process.env,
  PGHOST: target.hostname,
  PGPORT: target.port || "5432",
  PGUSER: decodeURIComponent(target.username),
  PGPASSWORD: decodeURIComponent(target.password),
  PGDATABASE: decodeURIComponent(target.pathname.slice(1)),
};
const backupDir = path.resolve("backups", "postgresql");
function run(name: string, args: string[]) {
  const result = spawnSync(bin(name), args, { env: pgEnv, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(name + " failed: " + (result.stderr || "").trim());
}
type BackupRecord = { fileName: string; createdAt: string; engine: string; database: string; sha256: string; sizeBytes: number };
async function listBackups(): Promise<BackupRecord[]> {
  await fs.mkdir(backupDir, { recursive: true });
  const names = (await fs.readdir(backupDir)).filter(name => /^easynet-postgres-[0-9-]+-[0-9a-f]{8}\\.dump$/.test(name));
  const backups: BackupRecord[] = [];
  for (const name of names) {
    try {
      const record = JSON.parse(await fs.readFile(path.join(backupDir, name + ".json"), "utf8")) as BackupRecord;
      if (record.fileName === name && record.engine === "postgresql" && record.database === pgEnv.PGDATABASE) backups.push(record);
    } catch { /* Incomplete manifests are deliberately excluded from managed retention. */ }
  }
  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async function pruneBackups(maxCount: number) {
  if (!Number.isInteger(maxCount) || maxCount < 7 || maxCount > 365) throw new Error("Retention must be 7..365");
  const records = await listBackups();
  for (const record of records.slice(maxCount)) {
    const fullPath = path.join(backupDir, record.fileName);
    const content = await fs.readFile(fullPath);
    if (createHash("sha256").update(content).digest("hex") !== record.sha256) {
      throw new Error("Refusing to prune a backup with invalid checksum: " + record.fileName);
    }
    await fs.rm(fullPath);
    await fs.rm(fullPath + ".json");
    console.log("Pruned: " + record.fileName);
  }
}
async function main() {
  await fs.mkdir(backupDir, { recursive: true });
  if (process.argv.includes("--list")) {
    for (const backup of await listBackups()) console.log(backup.createdAt + " " + backup.fileName + " " + backup.sizeBytes + " bytes");
    return;
  }
  if (process.argv.includes("--prune")) {
    await pruneBackups(Number(process.env.BACKUP_RETENTION_COUNT || "30"));
    return;
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const name = "easynet-postgres-" + stamp + "-" + randomUUID().slice(0, 8) + ".dump";
  const temp = path.join(backupDir, name + ".tmp");
  const final = path.join(backupDir, name);
  try {
    run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", temp]);
    run("pg_restore", ["--list", temp]);
    const buffer = await fs.readFile(temp);
    const hash = createHash("sha256").update(buffer).digest("hex");
    await fs.rename(temp, final);
    const manifest = {
      formatVersion: 1, fileName: name, createdAt: new Date().toISOString(),
      engine: "postgresql", database: pgEnv.PGDATABASE, sizeBytes: buffer.length,
      sha256: hash, verifiedArchiveListing: true,
    };
    await fs.writeFile(final + ".json", JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
    console.log("PostgreSQL backup created: " + name);
    console.log("SHA-256: " + hash);
    console.log("pg_restore archive listing: PASS");
    console.log("Note: archive listing is not a full restore test.");
  } finally {
    await fs.rm(temp, { force: true });
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
