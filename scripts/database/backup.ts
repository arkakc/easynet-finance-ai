import { createDatabaseBackup, pruneDatabaseBackups } from "../../lib/system/database-backup";
import { prisma } from "../../src/lib/prisma";

async function main() {
  const backup = await createDatabaseBackup({
    createdBy: process.env.USERNAME || "local-operator",
    reason: "Command-line verified backup",
  });
  console.log(`Verified backup created: ${backup.fileName}`);
  console.log(`SHA-256: ${backup.sha256}`);
  console.log(`Size: ${backup.sizeBytes} bytes`);
  const requestedRetention = Number(process.env.BACKUP_RETENTION_COUNT || 30);
  const retention = Number.isInteger(requestedRetention) && requestedRetention >= 7 && requestedRetention <= 365 ? requestedRetention : 30;
  const pruned = await pruneDatabaseBackups(retention);
  console.log(`Retention: newest ${retention} backups (${pruned.length} expired backup(s) removed)`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
