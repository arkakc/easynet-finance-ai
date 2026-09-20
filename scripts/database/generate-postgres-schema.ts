import { promises as fs } from "node:fs";
import path from "node:path";

async function main() {
  const root = process.cwd();
  const sourcePath = path.resolve(root, "prisma", "schema.prisma");
  const outputDirectory = path.resolve(root, "prisma", "generated");
  const outputPath = path.resolve(outputDirectory, "schema.postgresql.prisma");
  const source = await fs.readFile(sourcePath, "utf8");
  const withDedicatedClient = source.replace(
    /generator\s+client\s*\{[\s\S]*?\}/,
    'generator client {\n  provider = "prisma-client-js"\n  output   = "./postgresql-client"\n}',
  );
  if (withDedicatedClient === source) throw new Error("Could not locate the Prisma client generator block");
  const converted = withDedicatedClient.replace(
    /datasource\s+db\s*\{[\s\S]*?\}/,
    'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL_POSTGRES")\n}',
  );
  if (converted === source) throw new Error("Could not locate the Prisma datasource block");
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(outputPath, `// Generated from prisma/schema.prisma. Do not edit manually.\n${converted}`, "utf8");
  console.log(`Generated PostgreSQL schema: ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
