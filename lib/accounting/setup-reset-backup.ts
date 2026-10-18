import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export function backupBeforeReset() {
  const url = process.env.DATABASE_URL_POSTGRES;
  if (!url) throw new Error("PostgreSQL connection is not configured.");
  const database = new URL(url);
  if (!["postgres:", "postgresql:"].includes(database.protocol)) throw new Error("Only PostgreSQL reset is supported.");
  const name = decodeURIComponent(database.pathname.slice(1));
  if (!name) throw new Error("Missing PostgreSQL database name.");
  const binaryDir = process.env.POSTGRES_BIN_DIR || (process.platform === "win32" ? "C:\\Program Files\\PostgreSQL\\17\\bin" : "");
  const binary = (base: string) => binaryDir ? path.join(binaryDir, process.platform === "win32" ? base + ".exe" : base) : base;
  const env = { ...process.env, PGHOST: database.hostname, PGPORT: database.port || "5432", PGUSER: decodeURIComponent(database.username), PGPASSWORD: decodeURIComponent(database.password), PGDATABASE: name };
  const directory = path.resolve("backups", "postgresql");
  mkdirSync(directory, { recursive: true });
  const backupPath = path.join(directory, `finance-setup-pre-reset-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.dump`);
  const dump = spawnSync(binary("pg_dump"), ["--format=custom", "--file", backupPath, "--no-password"], { env, encoding: "utf8", windowsHide: true });
  if (dump.error || dump.status !== 0) throw new Error(`PostgreSQL backup failed: ${String(dump.stderr || dump.error || "").slice(0, 500)}`);
  const check = spawnSync(binary("pg_restore"), ["--list", backupPath], { env, encoding: "utf8", windowsHide: true });
  if (check.error || check.status !== 0 || !check.stdout?.includes("TABLE")) throw new Error("Backup verification failed; no reset performed.");
  const size = statSync(backupPath).size;
  if (size < 1024) throw new Error("Backup too small; reset blocked.");
  const sha256 = createHash("sha256").update(readFileSync(backupPath)).digest("hex");
  writeFileSync(backupPath + ".json", JSON.stringify({ purpose: "finance-setup-reset", database: name, createdAt: new Date().toISOString(), sha256, size, verification: "pg_restore --list passed; restoration not independently verified" }, null, 2));
  return { fileName: path.basename(backupPath), sha256 };
}

