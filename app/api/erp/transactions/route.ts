import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requirePermission, hasPermission, type Permission } from "@/lib/auth";
import { findRecords, listTable, updateRecord } from "@/lib/backend/apps-script";
import { postJournal, supplierPaymentPosting } from "@/lib/accounting/posting";
import { GET as legacyGet, POST as legacyPost } from "@/app/api/transactions/route";

const ACTION_PERMISSION: Record<string, Permission> = {
  createQuote: "sales.write",
  createInvoice: "sales.write",
  createSupplierQuote: "purchase.write",
  createPurchaseOrder: "purchase.write",
  createSupplierBill: "purchase.write",
  createExpense: "purchase.write",
};

const SERIES: Record<string,{table:string;field:string;prefix:string;payloadField:string}> = {
  createQuote:{table:"Quotes",field:"quoteNumber",prefix:"SQ",payloadField:"documentNumber"},
  createInvoice:{table:"Invoices",field:"invoiceNumber",prefix:"SI",payloadField:"documentNumber"},
  createSupplierQuote:{table:"PurchaseOrders",field:"poNumber",prefix:"SUPQ",payloadField:"documentNumber"},
  createPurchaseOrder:{table:"PurchaseOrders",field:"poNumber",prefix:"PO",payloadField:"documentNumber"},
  createSupplierBill:{table:"SupplierBills",field:"billNumber",prefix:"PB",payloadField:"documentNumber"},
  createPayment:{table:"Payments",field:"paymentNumber",prefix:"PE",payloadField:"paymentNumber"},
  createExpense:{table:"Expenses",field:"expenseNumber",prefix:"EXP",payloadField:"expenseNumber"},
};

function pngYear(){return new Intl.DateTimeFormat("en",{timeZone:"Pacific/Port_Moresby",year:"numeric"}).format(new Date());}
async function nextNumber(action:string){const config=SERIES[action];if(!config)return "";const prefix=`${config.prefix}-${pngYear()}-`;const rows=await listTable<any>(config.table,500,0);const max=rows.rows.reduce((current,row)=>{const value=String(row[config.field]||"");if(!value.startsWith(prefix))return current;const sequence=Number(value.slice(prefix.length));return Number.isInteger(sequence)&&sequence>current?sequence:current;},0);return `${prefix}${String(max+1).padStart(5,"0")}`;}
function permissionForAction(action:string,partyType?:string):Permission|undefined{
  if(action==="createPayment"||action==="finalizePayment")return partyType==="Supplier"?"purchase.write":"sales.write";
  return ACTION_PERMISSION[action];
}

export async function GET(request:Request){
  try{
    const url=new URL(request.url);
    const nextAction=url.searchParams.get("nextNumberFor")||"";
    if(nextAction){
      const partyType=url.searchParams.get("partyType")||undefined;
      const permission=permissionForAction(nextAction,partyType);
      if(!permission||!SERIES[nextAction])return NextResponse.json({ok:false,error:"Unsupported document type"},{status:400});
      await requirePermission(permission);
      return NextResponse.json({ok:true,action:nextAction,nextNumber:await nextNumber(nextAction)});
    }
    const user=await requirePermission("dashboard.read");
    const response=await legacyGet();
    const body=await response.json();
    if(!body.ok)return NextResponse.json(body,{status:response.status});
    const canSales=hasPermission(user,"sales.read"),canPurchase=hasPermission(user,"purchase.read"),canAccounts=hasPermission(user,"accounts.read");
    const allPurchaseOrders=Array.isArray(body.purchaseOrders)?body.purchaseOrders:[];
    const supplierQuotes=canPurchase?allPurchaseOrders.filter((row:any)=>String(row.poNumber||"").startsWith("SUPQ-")):[];
    const purchaseOrders=canPurchase?allPurchaseOrders.filter((row:any)=>!String(row.poNumber||"").startsWith("SUPQ-")):[];
    const payments=Array.isArray(body.payments)?body.payments.filter((row:any)=>{if(canAccounts)return true;if(String(row.partyType||"")==="Customer")return canSales;if(String(row.partyType||"")==="Supplier")return canPurchase;return false;}):[];
    return NextResponse.json({...body,quotes:canSales?body.quotes||[]:[],invoices:canSales?body.invoices||[]:[],supplierQuotes,purchaseOrders,supplierBills:canPurchase?body.supplierBills||[]:[],expenses:canPurchase?body.expenses||[]:[],payments});
  }catch(error){const message=error instanceof Error?error.message:"Unauthorized";return NextResponse.json({ok:false,error:message},{status:message==="Forbidden"?403:401});}
}

async function finalizePayment(payload:Record<string,unknown>){
  const paymentId=String(payload.paymentId||"").trim();
  if(!paymentId)throw new Error("Payment Entry is required");
  const found=await findRecords<any>("Payments",{paymentId},1);
  const row=found.rows[0];
  if(!row)throw new Error("Payment Entry not found");
  const partyType=String(row.partyType||"");
  await requirePermission(partyType==="Supplier"?"purchase.write":"sales.write");
  if(String(row.status||"").toUpperCase()!=="APPROVED")throw new Error("Payment Entry must be APPROVED before Final Save");
  if(String(row.journalId||"").trim())return {recordId:paymentId,status:"APPROVED",journalId:row.journalId,alreadyFinalized:true};

  const amount=Number(payload.amount??row.amount??0);
  if(!(amount>0))throw new Error("Payment amount must be greater than zero");
  const patch={
    paymentDate:String(payload.paymentDate??row.paymentDate??""),
    amount,
    paymentMethod:String(payload.paymentMethod??row.paymentMethod??""),
    cashBankAccountId:String(payload.cashBankAccountId??row.cashBankAccountId??""),
    reference:String(payload.reference??row.reference??""),
  };
  if(!patch.paymentDate)throw new Error("Payment Date is required");
  if(!patch.paymentMethod)throw new Error("Payment Method is required");
  if(!patch.cashBankAccountId)throw new Error("Cash / Bank Account is required");
  await updateRecord("Payments","paymentId",paymentId,patch,"payment-final-save");

  const sourceId=String(row.againstDocumentId||"").trim();
  const customerPayment=partyType==="Customer";
  const againstType=String(row.againstDocumentType||"").toLowerCase();
  let sourceTable="",sourceIdField="",sourcePreviousStatus="";
  let sourceRow:any=null;
  if(sourceId){
    if(customerPayment){
      sourceTable="Invoices";sourceIdField="invoiceId";
      sourceRow=(await findRecords<any>(sourceTable,{[sourceIdField]:sourceId},1)).rows[0];
      if(!sourceRow)throw new Error("Referenced Sales Invoice not found");
      sourcePreviousStatus=String(sourceRow.status||"");
      await updateRecord(sourceTable,sourceIdField,sourceId,{status:"POSTED"},"payment-final-save:temporary-posting-state");
    }else{
      sourceTable=againstType.includes("bill")?"SupplierBills":"PurchaseOrders";
      sourceIdField=sourceTable==="SupplierBills"?"billId":"poId";
      sourceRow=(await findRecords<any>(sourceTable,{[sourceIdField]:sourceId},1)).rows[0];
      if(!sourceRow)throw new Error(sourceTable==="PurchaseOrders"?"Referenced Purchase Order not found":"Referenced Supplier Bill not found");
      if(String(sourceRow.supplierId||"")!==String(row.partyId||""))throw new Error("Payment supplier does not match the source purchase document");
      const sourceTotal=Number(sourceRow.outstandingAmount??sourceRow.totalAmount??0);
      if(amount>sourceTotal+0.001)throw new Error("Supplier payment exceeds the source purchase document amount");
      sourcePreviousStatus=String(sourceRow.status||"");
      await updateRecord(sourceTable,sourceIdField,sourceId,{status:"POSTED"},"payment-final-save:temporary-posting-state");
    }
  }

  try{
    let journalId="";
    if(!customerPayment&&sourceTable==="PurchaseOrders"){
      const journal=await postJournal({
        postingDate:patch.paymentDate,
        documentType:"SUPPLIER_PAYMENT",
        documentId:row.paymentId,
        documentNumber:row.paymentNumber,
        reference:patch.reference||row.paymentNumber,
        projectId:row.projectId,
        lines:supplierPaymentPosting({
          amount,
          supplierId:row.partyId,
          projectId:row.projectId,
          cashBankAccountId:patch.cashBankAccountId,
        }),
      });
      journalId=journal.journalId;
      await updateRecord("Payments","paymentId",paymentId,{status:"APPROVED",journalId},"payment-final-save:purchase-order-payment");
    }else{
      const internal=new Request("http://internal/api/transactions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"post",payload:{recordType:"payment",recordId:paymentId},secret:env.APP_SECRET})});
      const response=await legacyPost(internal);
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Payment accounting failed");
      const posted=(await findRecords<any>("Payments",{paymentId},1)).rows[0];
      journalId=posted?.journalId||body?.result?.journalId||"";
      await updateRecord("Payments","paymentId",paymentId,{status:"APPROVED"},"payment-final-save:approved-final-state");
    }

    if(sourceId&&sourceTable){
      if(customerPayment){
        const all=(await findRecords<any>("Payments",{againstDocumentId:sourceId},500)).rows;
        const allocated=all.filter((p:any)=>String(p.partyType||"")==="Customer"&&String(p.journalId||"").trim()).reduce((sum:number,p:any)=>sum+Number(p.amount||0),0);
        const invoice=(await findRecords<any>("Invoices",{invoiceId:sourceId},1)).rows[0];
        if(invoice){const total=Number(invoice.totalAmount||0);await updateRecord("Invoices","invoiceId",sourceId,{paidAmount:Math.min(total,allocated),outstandingAmount:Math.max(0,total-allocated),status:"CONVERTED"},"payment-final-save:allocation");}
      }else{
        await updateRecord(sourceTable,sourceIdField,sourceId,{status:"CONVERTED"},"payment-final-save:restore-source-state");
      }
    }
    return {recordId:paymentId,status:"APPROVED",journalId,finalized:true};
  }catch(error){
    if(sourceId&&sourceTable&&sourcePreviousStatus)await updateRecord(sourceTable,sourceIdField,sourceId,{status:sourcePreviousStatus},"payment-final-save:rollback-source-state");
    await updateRecord("Payments","paymentId",paymentId,{status:"APPROVED"},"payment-final-save:rollback-payment-state");
    throw error;
  }
}

export async function POST(request:Request){
  try{
    const body=await request.json() as{action?:string;payload?:Record<string,unknown>};
    if(body.action==="post")return NextResponse.json({ok:false,error:"POSTED step has been removed. Approve is the final document status."},{status:400});
    if(body.action==="finalizePayment"){
      if(!env.APP_SECRET)throw new Error("Server compatibility credential is not configured");
      return NextResponse.json({ok:true,result:await finalizePayment(body.payload||{})});
    }
    const permission=body.action?permissionForAction(body.action,String(body.payload?.partyType||"")):undefined;
    if(!permission)return NextResponse.json({ok:false,error:"Unsupported transaction action"},{status:400});
    await requirePermission(permission);
    if(!env.APP_SECRET)throw new Error("Server compatibility credential is not configured");
    let payload=body.payload||{};
    const series=body.action?SERIES[body.action]:undefined;
    if(body.action&&series&&!String(payload[series.payloadField]||"").trim())payload={...payload,[series.payloadField]:await nextNumber(body.action)};
    const legacyAction=body.action==="createSupplierQuote"?"createPurchaseOrder":body.action;
    const internal=new Request(request.url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:legacyAction,payload,secret:env.APP_SECRET})});
    const response=await legacyPost(internal);
    const result=await response.json();
    if(body.action==="createSupplierQuote"&&result?.ok&&result?.result)result.result.type="supplierQuote";
    if(response.ok&&result?.ok&&body.action==="createPayment"&&result?.result?.recordId){
      const sourceId=String(payload.againstDocumentId||"").trim();
      const sourceType=String(payload.againstDocumentType||"").toLowerCase();
      if(sourceId){
        if(sourceType.includes("sales invoice")||String(payload.partyType||"")==="Customer"){
          const source=(await findRecords<any>("Invoices",{invoiceId:sourceId},1)).rows[0];
          if(source)await updateRecord("Invoices","invoiceId",sourceId,{status:"CONVERTED"},"conversion-tracking");
        }else if(sourceType.includes("supplier bill")){
          const source=(await findRecords<any>("SupplierBills",{billId:sourceId},1)).rows[0];
          if(source)await updateRecord("SupplierBills","billId",sourceId,{status:"CONVERTED"},"conversion-tracking");
        }else{
          const source=(await findRecords<any>("PurchaseOrders",{poId:sourceId},1)).rows[0];
          if(source)await updateRecord("PurchaseOrders","poId",sourceId,{status:"CONVERTED"},"conversion-tracking");
        }
      }
    }
    return NextResponse.json(result,{status:response.status});
  }catch(error){const message=error instanceof Error?error.message:"Transaction failed";const status=message==="Forbidden"?403:message==="Unauthorized"?401:400;return NextResponse.json({ok:false,error:message},{status});}
}
