import { PrismaClient } from "@prisma/client";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { listDatabaseBackups, resolveBackupPath, verifyDatabaseBackup } from "../../lib/system/database-backup";

// Isolated restore drill: never replaces the live database.
async function main() {
 const supplied = process.argv.find(a=>a.startsWith("--file="))?.slice(7);
 const file = supplied || (await listDatabaseBackups())[0]?.fileName;
 if(!file)throw new Error("No backup found. Run npm run db:backup or specify --file=<existing-backup.sqlite>");
 console.log(supplied ? "Verifying specified SQLite backup:" : "Verifying latest SQLite backup:", file);
 const verified=await verifyDatabaseBackup(file);
 const dir=path.resolve(process.cwd(),"backups","restore-drills");
 await fs.mkdir(dir,{recursive:true});
 const isolated=path.join(dir,"restore-drill-"+randomUUID()+".sqlite");
 await fs.copyFile(resolveBackupPath(file),isolated,fs.constants.COPYFILE_EXCL);
 const db=new PrismaClient({datasourceUrl:"file:"+isolated.replace(/\\/g,"/")});
 try {
  const integrity=await db.$queryRawUnsafe<Array<{integrity_check:string}>>("PRAGMA integrity_check");
  if(integrity.length!==1||integrity[0].integrity_check!=="ok")throw new Error("Restored database integrity failure");
  const [journals,lines,claims]=await Promise.all([
   db.journalHeader.count({where:{status:"POSTED"}}),
   db.journalLine.count({where:{journal:{status:"POSTED"}}}),
   db.approvalRequest.count({where:{type:"ERP_CONVERSION_IDEMPOTENCY",status:{in:["PENDING","IN_REVIEW"]}}}),
  ]);
  console.log(JSON.stringify({status:"PASS",source:file,sourceChecksum:verified.manifest.sha256,restoredTo:"isolated-temporary-copy",postedJournals:journals,postedLines:lines,unresolvedConversionClaims:claims},null,2));
 }finally{await db.$disconnect();await fs.rm(isolated,{force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
