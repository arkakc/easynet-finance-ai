import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { spawnSync } from "node:child_process";
import path from "node:path";

if (!process.argv.includes("--apply")) {
  console.log("Dry-run: additive PurchaseReturn table migration. Pass --apply to execute. No data was changed.");
  process.exit(0);
}
const envFile = path.resolve(".env.local");
if (existsSync(envFile)) loadEnvFile(envFile);
const raw = process.env.DATABASE_URL_POSTGRES;
if (!raw) throw new Error("DATABASE_URL_POSTGRES missing in .env.local");
const target = new URL(raw);
if (!["postgres:", "postgresql:"].includes(target.protocol)) throw new Error("PostgreSQL URL required.");
const database = decodeURIComponent(target.pathname.slice(1));
if (!database) throw new Error("Database name is required.");
const binaryDir = process.env.POSTGRES_BIN_DIR || (process.platform === "win32" ? "C:\\Program Files\\PostgreSQL\\17\\bin" : "");
const executable = binaryDir ? path.join(binaryDir, process.platform === "win32" ? "psql.exe" : "psql") : "psql";
const file = path.resolve("scripts/database/migrations/20261019-purchase-returns.sql");
if (!existsSync(file)) throw new Error("PurchaseReturn migration SQL is missing.");
const pgEnvironment = {
  ...process.env,
  PGHOST: target.hostname,
  PGPORT: target.port || "5432",
  PGUSER: decodeURIComponent(target.username),
  PGPASSWORD: decodeURIComponent(target.password),
  PGDATABASE: database,
};
console.log("Applying additive PurchaseReturn table migration to PostgreSQL database:", database);
const command = spawnSync(executable, ["-X", "-v", "ON_ERROR_STOP=1", "-1", "-f", file], {
  env: pgEnvironment, stdio: "inherit", windowsHide: true,
});
if (command.error) throw command.error;
if (command.status !== 0) throw new Error("PurchaseReturn migration failed; check PostgreSQL output.");
console.log("PASS: PurchaseReturn table migration applied.");
