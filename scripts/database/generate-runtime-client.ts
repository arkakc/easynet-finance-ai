import { spawnSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

// npm prebuild runs outside Next.js, so load its local environment explicitly.
if (existsSync(path.resolve(process.cwd(), ".env.local"))) {
  loadEnvFile(path.resolve(process.cwd(), ".env.local"));
}

if (process.env.DATABASE_PROVIDER && process.env.DATABASE_PROVIDER.trim().toLowerCase() !== "postgresql") {
  throw new Error("SQLite runtime has been removed; set DATABASE_PROVIDER=postgresql or unset it.");
}
if (!process.env.DATABASE_URL_POSTGRES?.trim()) {
  throw new Error("DATABASE_URL_POSTGRES is required for PostgreSQL Prisma client generation.");
}
const cli = path.resolve(process.cwd(), "node_modules", "prisma", "build", "index.js");
const result = spawnSync(process.execPath, [cli, "generate", "--schema", path.resolve(process.cwd(), "prisma", "schema.prisma")], {
  stdio: "inherit", env: process.env,
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error("PostgreSQL Prisma client generation failed");
console.log("Runtime Prisma client generated for PostgreSQL.");
