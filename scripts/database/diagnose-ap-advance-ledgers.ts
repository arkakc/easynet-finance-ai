import { prisma } from "../../src/lib/prisma";
import { buildFinancialStatements } from "../../lib/accounting/financial-statements";

const money=(x:unknown)=>Number(x||0).toFixed(2);
const asOf=process.argv.find(x=>x.startsWith("--as-of="))?.slice(8)||"2026-10-10";
const end=new Date(`${asOf}T23:59:59.999+10:00`);

async function main(){
  if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(asOf)||Number.isNaN(end.getTime()))throw Error("Invalid --as-of date");
  console.log(`READ ONLY AP / advance ledger diagnosis as of ${asOf}`);
  const statements=await buildFinancialStatements({asOf});
  const ap=statements.controls.payables;
  console.log(`AP control ${ap.accountCode}: GL K${money(ap.glBalance)}, subledger K${money(ap.subledgerBalance)}, difference K${money(ap.difference)}`);
  const [bills,payments,allocations,journals]=await Promise.all([
    prisma.supplierBill.findMany({where:{billDate:{lte:end}},orderBy:{code:"asc"},select:{id:true,code:true,total:true,amountPaid:true,outstanding:true,status:true,journalId:true,glPosted:true,supplierId:true}}),
    prisma.payment.findMany({where:{date:{lte:end},supplierId:{not:null}},orderBy:{code:"asc"},select:{id:true,code:true,amount:true,type:true,status:true,journalId:true,sourceDocId:true,supplierId:true}}),
    prisma.paymentAllocation.findMany({where:{status:"POSTED",payment:{supplierId:{not:null}}},include:{payment:{select:{code:true,journalId:true}},bill:{select:{code:true}}},orderBy:{allocationDate:"asc"}}),
    prisma.journalHeader.findMany({where:{status:"POSTED",date:{lte:end}},include:{lines:{include:{account:{select:{code:true,name:true}}}}},orderBy:{date:"asc"}})
  ]);
  console.log("\nSupplier bills (subledger source):");
  for(const b of bills)console.log(`${b.code} ${b.status} total K${money(b.total)} paid K${money(b.amountPaid)} outstanding K${money(b.outstanding)} journal=${b.journalId||"NONE"} supplier=${b.supplierId}`);
  console.log("\nSupplier payments:");
  for(const p of payments)console.log(`${p.code} ${p.type}/${p.status} K${money(p.amount)} journal=${p.journalId||"NONE"} PO/source=${p.sourceDocId||"NONE"} supplier=${p.supplierId}`);
  console.log("\nPOSTED Supplier Allocations:");
  for(const a of allocations)console.log(`${a.payment.code} -> ${a.bill?.code||"NONE"} type=${a.allocationType} K${money(a.amount)} journal=${a.journalId||"NONE"} paymentJournal=${a.payment.journalId||"NONE"}`);
  console.log("\nJournal lines touching AP (211x), Supplier Advances (116x), or linked supplier payment/allocations:");
  const linked=new Set([...payments.map(p=>p.journalId).filter(Boolean),...allocations.map(a=>a.journalId).filter(Boolean)]);
  for(const j of journals){
    const lines=j.lines.filter(l=>/^(211|116)/.test(l.account.code));
    if(!lines.length&&!linked.has(j.id)&&!linked.has(j.code))continue;
    console.log(`JOURNAL ${j.code} ${j.documentType} date=${j.date.toISOString().slice(0,10)} source=${j.sourceDocId}`);
    for(const l of j.lines)console.log(`  GL ${l.account.code} ${l.account.name}: DR K${money(l.debit)} CR K${money(l.credit)} | ${l.description}`);
  }
  console.log("\nNo data modified. Do NOT execute control-apply based on this report alone.");
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>prisma.$disconnect());
