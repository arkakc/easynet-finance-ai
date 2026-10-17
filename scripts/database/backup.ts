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
async function main() {
  await fs.mkdir(backupDir, { recursive: true });
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
