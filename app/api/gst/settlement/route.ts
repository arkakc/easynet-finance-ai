import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/lib/prisma";
import { requirePermission, requireValidatedRequestPermission } from "@/lib/auth";
import { nextDocumentSeriesId } from "@/lib/accounting/document-numbering";
import { gstPeriodBalances } from "@/lib/accounting/gst-settlement";
import { reversePostedJournal } from "@/lib/accounting/journal-reversal";
import { postJournalInTransaction } from "@/lib/accounting/atomic-posting";

const schema = z.object({
  action: z.enum(["SAVE", "SUBMIT", "APPROVE", "REJECT", "CANCEL", "REVERSE"]),
  id: z.string().optional(),
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  bankAccountId: z.string().optional(),
  paymentReference: z.string().trim().max(100).optional(),
  reason: z.string().trim().max(500).optional(),
  reversalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  eligibilityConfirmed: z.boolean().optional(),
});
const businessDate=(date:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Pacific/Port_Moresby",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
const dateObj=(date:string)=>new Date(date+"T00:00:00+10:00");

async function preview(date:string, period:string) {
  return prisma.$transaction(async tx => {
    const balances=await gstPeriodBalances(tx,period,date);
    const banks=await tx.bankAccount.findMany({where:{isActive:true,currency:"PGK",chartOfAccountsId:{not:null}},include:{chartOfAccounts:true}});
    return {balances,banks:banks.filter(b=>b.chartOfAccounts?.isActive).map(b=>({id:b.id,name:b.name,code:b.code,ledger:b.chartOfAccounts?.code}))};
  });
}
function responseError(err:unknown) {
  const message=err instanceof z.ZodError?err.errors.map(e=>e.message).join("; "):err instanceof Error?err.message:"GST document operation failed";
  return NextResponse.json({ok:false,error:message},{status:message==="Unauthorized"?401:message==="Forbidden"?403:400});
}
export async function GET(request:Request) {
  try {
    await requirePermission("accounts.read");
    const params=new URL(request.url).searchParams;
    if(params.get("date")) {
      const date=String(params.get("date"));
      const period=String(params.get("period")||"");
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Valid payment date required");
      return NextResponse.json({ok:true,...await preview(date,period)});
    }
    const records=await prisma.gstSettlement.findMany({orderBy:{createdAt:"desc"},take:100});
    return NextResponse.json({ok:true,records:records.map(record=>({...record,outputGst:Number(record.outputGst),inputGst:Number(record.inputGst),netPayable:Number(record.netPayable),paymentDate:businessDate(record.paymentDate)}))});
  }catch(err){return responseError(err);}
}
export async function POST(request:Request) {
  try {
    const raw=schema.parse(await request.json());
    const permission=["APPROVE","REJECT","REVERSE"].includes(raw.action)?"post.approve":"accounts.write";
    const user=await requireValidatedRequestPermission(request,permission);
    const actor=user.email.toLowerCase();
    if(raw.action==="SAVE" && !raw.id){
      if(!raw.paymentDate||!raw.period||!raw.bankAccountId||!raw.paymentReference?.trim())throw new Error("Date, period, bank and reference required");
      const code=await nextDocumentSeriesId("GSTSET",Number(raw.paymentDate.slice(0,4)));
      const record=await prisma.gstSettlement.create({data:{code,period:raw.period,paymentDate:dateObj(raw.paymentDate),bankAccountId:raw.bankAccountId,paymentReference:raw.paymentReference,status:"DRAFT",createdBy:actor}});
      return NextResponse.json({ok:true,record:{id:record.id,code:record.code,status:record.status}});
    }
    if(raw.action==="REVERSE"){
      if(!raw.id||!raw.reason?.trim()||!raw.reversalDate)throw new Error("Reversal date and reason required");
      const doc=await prisma.gstSettlement.findUnique({where:{id:raw.id}});
      if(!doc||doc.status!=="POSTED"||!doc.journalId)throw new Error("Only POSTED GST Settlement may be reversed");
      if(doc.createdBy.toLowerCase()===actor&&!user.roles.includes("System Manager"))throw new Error("Independent checker is required for GST reversal");
      const reversal=await reversePostedJournal({journalId:doc.journalId,reversalDate:raw.reversalDate,reason:"GST Settlement "+doc.code+": "+raw.reason,createdBy:actor,approvedBy:actor});
      await prisma.gstSettlement.update({where:{id:doc.id},data:{status:"CANCELLED",reversalJournalId:reversal.reversalDatabaseId,cancelledBy:actor,cancelledAt:new Date(),cancelReason:"Reversed by "+reversal.reversalJournalId+": "+raw.reason}});
      return NextResponse.json({ok:true,record:{id:doc.id,code:doc.code,status:"CANCELLED",journalId:doc.journalId,reversalJournalId:reversal.reversalJournalId}});
    }
    if(!raw.id)throw new Error("GST settlement document ID is required");
    const result=await prisma.$transaction(async tx=>{
      const document=await tx.gstSettlement.findUnique({where:{id:raw.id}});
      if(!document)throw new Error("GST settlement not found");
      const maker=String(document.createdBy).toLowerCase();
      if(raw.action==="SAVE"){
        if(!["DRAFT","REJECTED"].includes(document.status))throw new Error("Only DRAFT/REJECTED documents can be modified");
        if(maker!==actor&&!user.roles.includes("System Manager"))throw new Error("Only document creator may modify draft");
        const paymentDate=raw.paymentDate||businessDate(document.paymentDate);
        const updated=await tx.gstSettlement.update({where:{id:document.id},data:{period:raw.period||document.period,paymentDate:dateObj(paymentDate),bankAccountId:raw.bankAccountId||document.bankAccountId,paymentReference:raw.paymentReference||document.paymentReference,status:"DRAFT",updatedBy:actor,rejectionReason:null}});
        return {id:updated.id,code:updated.code,status:updated.status};
      }
      if(raw.action==="CANCEL"){
        if(!["DRAFT","REJECTED","PENDING"].includes(document.status))throw new Error("POSTED settlement requires a controlled reversal; direct cancellation blocked");
        if(maker!==actor&&!user.roles.includes("System Manager"))throw new Error("Only creator or System Manager can cancel before posting");
        if(!raw.reason?.trim())throw new Error("Cancellation reason required");
        const updated=await tx.gstSettlement.update({where:{id:document.id},data:{status:"CANCELLED",cancelledBy:actor,cancelledAt:new Date(),cancelReason:raw.reason}});
        return {id:updated.id,code:updated.code,status:updated.status};
      }
      if(raw.action==="REJECT"){
        if(document.status!=="PENDING")throw new Error("Only pending documents can be rejected");
        if(maker===actor&&!user.roles.includes("System Manager"))throw new Error("Maker cannot check own document");
        if(!raw.reason?.trim())throw new Error("Rejection reason is required");
        const updated=await tx.gstSettlement.update({where:{id:document.id},data:{status:"REJECTED",rejectedBy:actor,rejectedAt:new Date(),rejectionReason:raw.reason}});
        return {id:updated.id,code:updated.code,status:updated.status};
      }
      if(raw.action==="SUBMIT"){
        if(!["DRAFT","REJECTED"].includes(document.status))throw new Error("Document must be draft or rejected");
        if(maker!==actor&&!user.roles.includes("System Manager"))throw new Error("Only maker may submit");
        const other=await tx.gstSettlement.findFirst({where:{id:{not:document.id},status:"PENDING"},select:{code:true}});
        if(other)throw new Error("Resolve pending GST settlement first: "+other.code);
        const paymentDate=businessDate(document.paymentDate);
        const gst=await gstPeriodBalances(tx,document.period,paymentDate);
        if(!raw.eligibilityConfirmed)throw new Error("Confirm GST supporting documents, input eligibility and reporting period before submission");
        const prior=await tx.gstSettlement.findFirst({where:{id:{not:document.id},period:document.period,status:"POSTED"},select:{code:true}});
        if(prior)throw new Error("GST period already settled: "+prior.code);
        if(gst.net<=0)throw new Error("No GST payable; submission blocked");
        const bank=await tx.bankAccount.findUnique({where:{id:document.bankAccountId},include:{chartOfAccounts:true}});
        if(!bank?.isActive||bank.currency!=="PGK"||!bank.chartOfAccounts?.isActive)throw new Error("Choose active linked PGK Bank");
        const updated=await tx.gstSettlement.update({where:{id:document.id},data:{outputGst:gst.outputDue,inputGst:gst.inputCredit,netPayable:gst.net,status:"PENDING",submittedBy:actor,submittedAt:new Date()}});
        return {id:updated.id,code:updated.code,status:updated.status};
      }
      if(document.status!=="PENDING")throw new Error("Only PENDING documents may be approved");
      if(maker===actor&&!user.roles.includes("System Manager"))throw new Error("Maker cannot approve own document");
      const paymentDate=businessDate(document.paymentDate);
      const gst=await gstSettlementBalances(tx,paymentDate);
      if(gst.net<=0||Math.abs(gst.net-Number(document.netPayable))>0.001||Math.abs(gst.outputDue-Number(document.outputGst))>0.001||Math.abs(gst.inputCredit-Number(document.inputGst))>0.001)throw new Error("GST changed since submission. Reject, recalculate and resubmit.");
      const bank=await tx.bankAccount.findUnique({where:{id:document.bankAccountId},include:{chartOfAccounts:true}});
      if(!bank?.isActive||bank.currency!=="PGK"||!bank.chartOfAccounts?.isActive||!bank.chartOfAccountsId)throw new Error("Bank mapping invalid");
      const journal=await postJournalInTransaction(tx,{
        postingDate:paymentDate,documentType:"GST_SETTLEMENT",documentId:document.id,documentNumber:document.code,
        reference:"GST payment "+document.code+" "+document.period+" IRC "+document.paymentReference,
        createdBy:maker,approvedBy:actor,currency:"PGK",baseCurrency:"PGK",
        lines:[{accountId:"2120",debit:gst.outputDue,description:"Settle output GST"},
          ...(gst.inputCredit>0?[{accountId:"1140",credit:gst.inputCredit,description:"Apply input GST credit"}]:[]),
          {accountId:bank.chartOfAccounts.code,credit:gst.net,description:"Payment to IRC "+document.paymentReference}],
      });
      const updated=await tx.gstSettlement.update({where:{id:document.id},data:{status:"POSTED",journalId:journal.id,approvedBy:actor,approvedAt:new Date()}});
      return {id:updated.id,code:updated.code,status:updated.status,journalId:journal.journalId};
    });
    return NextResponse.json({ok:true,record:result});
  }catch(err){return responseError(err);}
}
