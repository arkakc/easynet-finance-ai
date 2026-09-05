import { NextRequest, NextResponse } from "next/server";
import { findRecords } from "@/lib/backend/apps-script";
import { requirePermission, type Permission } from "@/lib/auth";

const CONFIG: Record<string,{table:string;idField:string;numberField:string;lineTable?:string;lineIdField?:string;permission:Permission}>={
  quote:{table:"Quotes",idField:"quoteId",numberField:"quoteNumber",lineTable:"QuoteLines",lineIdField:"quoteId",permission:"sales.read"},
  invoice:{table:"Invoices",idField:"invoiceId",numberField:"invoiceNumber",lineTable:"InvoiceLines",lineIdField:"invoiceId",permission:"sales.read"},
  supplierQuote:{table:"PurchaseOrders",idField:"poId",numberField:"poNumber",lineTable:"POLines",lineIdField:"poId",permission:"purchase.read"},
  purchaseOrder:{table:"PurchaseOrders",idField:"poId",numberField:"poNumber",lineTable:"POLines",lineIdField:"poId",permission:"purchase.read"},
};

export async function GET(request:NextRequest){
  try{
    const type=request.nextUrl.searchParams.get("type")||"";
    const id=request.nextUrl.searchParams.get("id")||"";
    const config=CONFIG[type];
    if(!config||!id) return NextResponse.json({ok:false,error:"Invalid document request"},{status:400});
    await requirePermission(config.permission);
    const result=await findRecords<any>(config.table,{[config.idField]:id},1);
    const record=result.rows[0];
    if(!record) return NextResponse.json({ok:false,error:"Document not found"},{status:404});
    const lines=config.lineTable&&config.lineIdField?(await findRecords<any>(config.lineTable,{[config.lineIdField]:id},500)).rows:[];
    return NextResponse.json({ok:true,record,lines,number:record[config.numberField]||id});
  }catch(error){
    const message=error instanceof Error?error.message:"Preview failed";
    return NextResponse.json({ok:false,error:message},{status:message==="Forbidden"?403:message==="Unauthorized"?401:400});
  }
}
