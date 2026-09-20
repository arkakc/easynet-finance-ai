import { spawnSync } from "node:child_process";
import path from "node:path";

const schemaPath = path.resolve(process.cwd(), "prisma", "generated", "schema.postgresql.prisma");
const prismaCliPath = path.resolve(process.cwd(), "node_modules", "prisma", "build", "index.js");
const result = spawnSync(process.execPath, [prismaCliPath, "validate", "--schema", schemaPath], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL_POSTGRES: process.env.DATABASE_URL_POSTGRES || "postgresql://schema_validator:unused@127.0.0.1:5432/easynet?schema=public",
  },
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
