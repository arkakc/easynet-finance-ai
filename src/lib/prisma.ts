import { PrismaClient } from "@prisma/client";

export type DatabaseProvider = "sqlite" | "postgresql";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaProvider: DatabaseProvider | undefined;
};

function productionLike() {
  return process.env.APP_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function resolveProvider(): DatabaseProvider {
  const configured = String(process.env.DATABASE_PROVIDER || "").trim().toLowerCase();
  if (configured && configured !== "sqlite" && configured !== "postgresql") {
    throw new Error("DATABASE_PROVIDER must be either sqlite or postgresql");
  }

  const provider = (configured || (productionLike() ? "postgresql" : "sqlite")) as DatabaseProvider;
  if (productionLike() && provider !== "postgresql") {
    throw new Error("Production runtime requires DATABASE_PROVIDER=postgresql");
  }
  return provider;
}

const provider = resolveProvider();
const postgresUrl = process.env.DATABASE_URL_POSTGRES?.trim();
const sqliteOverride = process.env.EASYNET_PRISMA_DATASOURCE_URL?.trim();

if (provider === "postgresql" && !postgresUrl) {
  throw new Error("DATABASE_URL_POSTGRES is required when DATABASE_PROVIDER=postgresql");
}

if (globalForPrisma.prisma && globalForPrisma.prismaProvider && globalForPrisma.prismaProvider !== provider) {
  throw new Error("Database provider changed inside a running process; restart the application");
}

const datasourceUrl = provider === "postgresql" ? postgresUrl : sqliteOverride;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(datasourceUrl ? { datasourceUrl } : {}),
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaProvider = provider;
}

export function databaseRuntimeInfo() {
  return {
    provider,
    productionLike: productionLike(),
    postgresConfigured: Boolean(postgresUrl),
    sqliteOverrideConfigured: Boolean(sqliteOverride),
  };
}

export default prisma;
