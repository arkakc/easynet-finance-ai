import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const datasourceUrlOverride = process.env.EASYNET_PRISMA_DATASOURCE_URL?.trim();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(datasourceUrlOverride ? { datasourceUrl: datasourceUrlOverride } : {}),
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
