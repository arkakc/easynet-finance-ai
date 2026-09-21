import { promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

type Provider = "sqlite" | "postgresql";

function resolveProvider(): Provider {
  const configured = String(process.env.DATABASE_PROVIDER || "").trim().toLowerCase();
  if (configured && configured !== "sqlite" && configured !== "postgresql") {
    throw new Error("DATABASE_PROVIDER must be either sqlite or postgresql");
  }

  const productionLike = process.env.APP_ENV === "production" || process.env.VERCEL_ENV === "production";
  return (configured || (productionLike ? "postgresql" : "sqlite")) as Provider;
}

function runPrismaGenerate(schemaPath: string) {
  const prismaCliPath = path.resolve(process.cwd(), "node_modules", "prisma", "build", "index.js");
  const result = spawnSync(process.execPath, [prismaCliPath, "generate", "--schema", schemaPath], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Prisma client generation failed for ${schemaPath}`);
}

async function postgresRuntimeSchema() {
  const root = process.cwd();
  const sourcePath = path.resolve(root, "prisma", "schema.prisma");
  const outputDirectory = path.resolve(root, "prisma", "generated");
  const outputPath = path.resolve(outputDirectory, "schema.runtime.postgresql.prisma");
  const source = await fs.readFile(sourcePath, "utf8");

  const converted = source.replace(
    /datasource\s+db\s*\{[\s\S]*?\}/,
    'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL_POSTGRES")\n}',
  );
  if (converted === source) throw new Error("Could not locate the Prisma datasource block");

  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(
    outputPath,
    `// Generated from prisma/schema.prisma for PostgreSQL runtime. Do not edit manually.\n${converted}`,
    "utf8",
  );
  return outputPath;
}

async function main() {
  const provider = resolveProvider();
  if (provider === "sqlite") {
    runPrismaGenerate(path.resolve(process.cwd(), "prisma", "schema.prisma"));
    console.log("Runtime Prisma client generated for SQLite.");
    return;
  }

  if (!process.env.DATABASE_URL_POSTGRES?.trim()) {
    throw new Error("DATABASE_URL_POSTGRES is required when DATABASE_PROVIDER=postgresql");
  }

  const schemaPath = await postgresRuntimeSchema();
  runPrismaGenerate(schemaPath);
  console.log("Runtime Prisma client generated for PostgreSQL.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
