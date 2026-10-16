import { buildGoLiveReadiness } from "../../lib/system/go-live-readiness";
import { databaseRuntimeInfo, prisma } from "../../src/lib/prisma";

async function main() {
  console.log("EASYNET FINANCE AI: PRODUCTION GO-LIVE PRE-FLIGHT");
  console.log("This command is read-only and does not post accounting transactions.");
  const runtime=databaseRuntimeInfo();
  console.log("Database provider:",runtime.provider);
  if(runtime.provider!=="postgresql" || !runtime.postgresConfigured){
    console.error("BLOCKED: Production requires an active, configured PostgreSQL runtime.");
    process.exitCode=1;
  }
  const result=await buildGoLiveReadiness();
  for(const check of result.checks){
    console.log((check.passed?"PASS   ":"BLOCKED") + " | " + check.key + " | " + check.label);
    console.log("         " + check.detail);
  }
  const failed=result.checks.filter(c=>c.blocking&&!c.passed);
  if(failed.length || process.exitCode){
    console.error("NO-GO: "+failed.length+" application readiness control(s) failed. Do not enable real-money production posting.");
    process.exitCode=1;
  }else{
    console.log("AUTOMATED PRE-FLIGHT PASSED. This is not a production launch authorization.");
    console.log("Require human-reviewed transaction UAT, restored backup evidence, independent finance sign-off and deployment smoke test.");
  }
}
main().catch(err=>{console.error("NO-GO: Readiness check failed:",err instanceof Error?err.message:String(err));process.exitCode=1;}).finally(async()=>{await prisma.$disconnect();});
