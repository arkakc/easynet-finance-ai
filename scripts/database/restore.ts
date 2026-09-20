import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import {
  createDatabaseBackup,
  databasePath,
  resolveBackupPath,
  verifyDatabaseBackup,
} from "../../lib/system/database-backup";
import { prisma } from "../../src/lib/prisma";

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const fileName = argument("file");
  const confirmation = argument("confirm");
  if (!fileName || confirmation !== "RESTORE") {
    throw new Error("Usage: npm run db:restore -- --file=<backup-file.sqlite> --confirm=RESTORE");
  }

  const sourcePath = resolveBackupPath(fileName);
  await verifyDatabaseBackup(fileName);
  const safetyBackup = await createDatabaseBackup({
    createdBy: process.env.USERNAME || "local-operator",
    reason: `Automatic pre-restore snapshot before ${fileName}`,
  });

  await prisma.$executeRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)").catch(() => undefined);
  await prisma.$disconnect();

  const walPath = `${databasePath}-wal`;
  const shmPath = `${databasePath}-shm`;
  const openSidecars = await Promise.all([walPath, shmPath].map((candidate) => fs.stat(candidate).then(() => candidate).catch(() => null)));
  if (openSidecars.some(Boolean)) {
    throw new Error("SQLite WAL files are still present. Stop every ERP/dev server process, then retry the restore.");
  }

  const nonce = randomUUID().slice(0, 8);
  const stagedPath = `${databasePath}.restore-${nonce}.tmp`;
  const previousPath = `${databasePath}.previous-${nonce}.tmp`;
  await fs.copyFile(sourcePath, stagedPath, fs.constants.COPYFILE_EXCL);
  try {
    await fs.rename(databasePath, previousPath);
    try {
      await fs.rename(stagedPath, databasePath);
    } catch (error) {
      await fs.rename(previousPath, databasePath);
      throw error;
    }
    await fs.rm(previousPath, { force: true });
  } catch (error) {
    await fs.rm(stagedPath, { force: true });
    throw error;
  }

  console.log(`Database restored from: ${fileName}`);
  console.log(`Pre-restore safety backup: ${safetyBackup.fileName}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
