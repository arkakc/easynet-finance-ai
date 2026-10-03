import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";

type PlannedAdvance={paymentId:string;amount:number};
const round2=(value:number)=>Math.round((Number(value)+Number.EPSILON)*100)/100;

function normalizePlan(value:unknown):PlannedAdvance[]{
  let parsed:unknown=value;
  if(typeof value==="string"){try{parsed=JSON.parse(value);}catch{parsed=[];}}
  if(!Array.isArray(parsed))return[];
  return parsed.map((row:any)=>({paymentId:String(row?.paymentId||"").trim(),amount:round2(Number(row?.amount||0))})).filter(row=>row.paymentId&&row.amount>0);
}

async function resolveSourceQuoteId(invoice:any){
  const sourceRef=String(invoice.sourceDocId||"").trim();
  if(!sourceRef)return"";
  const source=await prisma.quote.findFirst({where:{OR:[{id:sourceRef},{code:sourceRef}]},select:{id:true,code:true,sourceDocId:true}});
  if(!source)return sourceRef;
  return String(source.sourceDocId||source.id||sourceRef);
}

async function loadWorkspace(invoiceRef:string){
  const invoice=await prisma.invoice.findFirst({where:{OR:[{id:invoiceRef},{code:invoiceRef}]}});
  if(!invoice)throw new Error("Sales Invoice not found");
  const sourceQuoteId=await resolveSourceQuoteId(invoice);
  const payments=sourceQuoteId?await prisma.payment.findMany({
    where:{
      customerId:invoice.customerId,
      type:"CUSTOMER_RECEIPT",
      status:"CLEARED",
      journalId:{not:null},
      sourceDocId:sourceQuoteId,
    },
    include:{allocations:{where:{status:"POSTED"},select:{amount:true}}},
    orderBy:{createdAt:"asc"},
  }):[];
  const plan=normalizePlan(invoice.plannedAdvanceAllocations);
  const availableAdvances=payments.map(payment=>{
    const allocated=round2(payment.allocations.reduce((sum,row)=>sum+Number(row.amount||0),0));
    const available=round2(Math.max(0,Number(payment.amount||0)-allocated));
    const planned=plan.find(row=>row.paymentId===payment.id)?.amount||0;
    return{
      paymentId:payment.id,paymentNumber:payment.code,amount:Number(payment.amount||0),allocated,available,planned,
      status:payment.status,journalId:payment.journalId||"",createdAt:payment.createdAt.toISOString(),
    };
  }).filter(row=>row.available>0.001||row.planned>0.001);
  const plannedTotal=round2(plan.reduce((sum,row)=>sum+row.amount,0));
  const total=Number(invoice.total||0);
  const postedPaid=Number(invoice.amountPaid||0);
  const projectedOutstanding=round2(Math.max(0,total-postedPaid-plannedTotal));
  return{invoice,sourceQuoteId,plan,availableAdvances,plannedTotal,projectedOutstanding};
}

export async function GET(request:NextRequest){
  try{
    await requirePermission("sales.read");
    const invoiceId=String(request.nextUrl.searchParams.get("invoiceId")||"").trim();
    if(!invoiceId)return NextResponse.json({ok:false,error:"Sales Invoice is required"},{status:400});
    const workspace=await loadWorkspace(invoiceId);
    return NextResponse.json({ok:true,status:workspace.invoice.status,sourceQuoteId:workspace.sourceQuoteId,plan:workspace.plan,plannedTotal:workspace.plannedTotal,projectedOutstanding:workspace.projectedOutstanding,availableAdvances:workspace.availableAdvances});
  }catch(error){
    const message=error instanceof Error?error.message:"Customer Advance plan load failed";
    return NextResponse.json({ok:false,error:message},{status:message==="Unauthorized"?401:message==="Forbidden"?403:400});
  }
}

export async function POST(request:NextRequest){
  try{
    await requirePermission("sales.write");
    const body=await request.json() as {invoiceId?:string;allocations?:PlannedAdvance[]};
    const invoiceId=String(body.invoiceId||"").trim();
    if(!invoiceId)throw new Error("Sales Invoice is required");
    const workspace=await loadWorkspace(invoiceId);
    if(workspace.invoice.status!=="DRAFT")throw new Error("Customer Advance can only be planned while the Sales Invoice is DRAFT");
    const requested=normalizePlan(body.allocations);
    const availableByPayment=new Map(workspace.availableAdvances.map(row=>[row.paymentId,row]));
    let total=0;
    for(const row of requested){
      const advance=availableByPayment.get(row.paymentId);
      if(!advance)throw new Error("Selected Customer Advance is not finalized, linked to this Sales Quotation, or no longer available");
      if(row.amount>advance.available+0.001)throw new Error(`Planned allocation for ${advance.paymentNumber} exceeds available advance K${advance.available.toFixed(2)}`);
      total=round2(total+row.amount);
    }
    const invoiceAvailable=round2(Math.max(0,Number(workspace.invoice.total||0)-Number(workspace.invoice.amountPaid||0)));
    if(total>invoiceAvailable+0.001)throw new Error(`Planned Customer Advance K${total.toFixed(2)} exceeds Sales Invoice outstanding K${invoiceAvailable.toFixed(2)}`);
    await prisma.invoice.update({where:{id:workspace.invoice.id},data:{plannedAdvanceAllocations:JSON.stringify(requested),updatedBy:"sales-invoice-advance-plan"}});
    return NextResponse.json({ok:true,plan:requested,plannedTotal:total,projectedOutstanding:round2(invoiceAvailable-total)});
  }catch(error){
    const message=error instanceof Error?error.message:"Customer Advance plan save failed";
    return NextResponse.json({ok:false,error:message},{status:message==="Unauthorized"?401:message==="Forbidden"?403:400});
  }
}
