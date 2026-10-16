import { PrismaClient } from "@prisma/client";

// Easynet Finance supports PostgreSQL as its only application datasource.
export type DatabaseProvider = "postgresql";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

if (process.env.DATABASE_PROVIDER && process.env.DATABASE_PROVIDER.trim().toLowerCase() !== "postgresql") {
  throw new Error("SQLite has been removed. DATABASE_PROVIDER must be postgresql.");
}

const postgresUrl = process.env.DATABASE_URL_POSTGRES?.trim();
if (!postgresUrl) throw new Error("DATABASE_URL_POSTGRES is required for the PostgreSQL runtime");
const parsedUrl = new URL(postgresUrl);
if (!["postgresql:", "postgres:"].includes(parsedUrl.protocol)) {
  throw new Error("DATABASE_URL_POSTGRES must be a PostgreSQL connection URL");
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  datasourceUrl: postgresUrl,
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export function databaseRuntimeInfo() {
  return { provider: "postgresql" as const, productionLike: process.env.APP_ENV === "production" || process.env.VERCEL_ENV === "production", postgresConfigured: true, sqliteOverrideConfigured: false };
}

export default prisma;
