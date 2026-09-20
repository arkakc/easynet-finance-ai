import { NextRequest, NextResponse } from "next/server";
import { findRecords, listTable } from "@/lib/backend/apps-script";
import { requirePermission, type Permission } from "@/lib/auth";

const CONFIG: Record<string,{table:string;idField:string;numberField:string;lineTable?:string;lineIdField?:string;permission:Permission}>={
  quote:{table:"Quotes",idField:"quoteId",numberField:"quoteNumber",lineTable:"QuoteLines",lineIdField:"quoteId",permission:"sales.read"},
  invoice:{table:"Invoices",idField:"invoiceId",numberField:"invoiceNumber",lineTable:"InvoiceLines",lineIdField:"invoiceId",permission:"sales.read"},
  purchaseOrder:{table:"PurchaseOrders",idField:"poId",numberField:"poNumber",lineTable:"POLines",lineIdField:"poId",permission:"purchase.read"},
  supplierBill:{table:"SupplierBills",idField:"billId",numberField:"billNumber",lineTable:"SupplierBillLines",lineIdField:"billId",permission:"purchase.read"},
  payment:{table:"Payments",idField:"paymentId",numberField:"paymentNumber",permission:"dashboard.read"},
  expense:{table:"Expenses",idField:"expenseId",numberField:"expenseNumber",permission:"purchase.read"},
};

export async function GET(request:NextRequest){
  try{
    const type=String(request.nextUrl.searchParams.get("type")||"");
    const id=String(request.nextUrl.searchParams.get("id")||"").trim();
    const config=CONFIG[type];
    if(!config||!id)return NextResponse.json({ok:false,error:"Invalid document request"},{status:400});
    await requirePermission(config.permission);

    const[result,lineResult]=await Promise.all([
      findRecords<any>(config.table,{[config.idField]:id},1),
      config.lineTable&&config.lineIdField?findRecords<any>(config.lineTable,{[config.lineIdField]:id},500):Promise.resolve({rows:[] as any[]}),
    ]);
    const record=result.rows[0];
    if(!record)return NextResponse.json({ok:false,error:"Document not found"},{status:404});

    if(type==="payment"){
      if(String(record.partyType)==="Customer")await requirePermission("sales.read");
      else if(String(record.partyType)==="Supplier")await requirePermission("purchase.read");
      else await requirePermission("accounts.read");
    }

    const lines=lineResult.rows||[];
    const customerId=type==="quote"||type==="invoice"?String(record.customerId||""):type==="payment"&&String(record.partyType)==="Customer"?String(record.partyId||""):"";
    const supplierId=type==="purchaseOrder"||type==="supplierBill"||type==="expense"?String(record.supplierId||""):type==="payment"&&String(record.partyType)==="Supplier"?String(record.partyId||""):"";
    const projectId=String(record.projectId||"");
    const accountId=String(record.cashBankAccountId||record.expenseAccountId||"");

    const[itemResult,customerResult,supplierResult,projectResult,accountResult]=await Promise.all([
      config.lineTable?listTable<any>("Items",500,0):Promise.resolve({rows:[] as any[]}),
      customerId?findRecords<any>("Customers",{customerId},1):Promise.resolve({rows:[] as any[]}),
      supplierId?listTable<any>("Suppliers",500,0):Promise.resolve({rows:[] as any[]}),
      projectId?findRecords<any>("Projects",{projectId},1):Promise.resolve({rows:[] as any[]}),
      accountId?findRecords<any>("Accounts",{accountId},1):Promise.resolve({rows:[] as any[]}),
    ]);

    const lineItemIds=new Set(lines.map((line:any)=>String(line.itemId||"")).filter(Boolean));
    const items=(itemResult.rows||[]).filter((item:any)=>lineItemIds.has(String(item.itemId||item.itemCode||"")));

    return NextResponse.json({
      ok:true,
      type,
      id,
      number:String(record[config.numberField]||id),
      record,
      lines,
      references:{
        customers:customerResult.rows||[],
        suppliers:supplierResult.rows||[],
        projects:projectResult.rows||[],
        accounts:accountResult.rows||[],
        items,
      },
    });
  }catch(error){
    const message=error instanceof Error?error.message:"Document read failed";
    return NextResponse.json({ok:false,error:message},{status:message==="Unauthorized"?401:message==="Forbidden"?403:500});
  }
}
