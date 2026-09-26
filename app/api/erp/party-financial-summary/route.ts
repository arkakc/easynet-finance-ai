import { NextRequest, NextResponse } from "next/server";
import { listTable } from "@/lib/backend/apps-script";
import { requirePermission } from "@/lib/auth";

const clean=(value:unknown)=>String(value||"").trim();
const n=(value:unknown)=>{const v=Number(value||0);return Number.isFinite(v)?v:0;};
const activeStatus=(value:unknown)=>!["CANCELLED","REVERSED"].includes(clean(value).toUpperCase());
const postedPayment=(row:any)=>clean(row.status).toUpperCase()==="POSTED"&&Boolean(clean(row.journalId));
const recognizedDocument=(row:any)=>["POSTED","PARTLY_PAID","PAID"].includes(clean(row.status).toUpperCase());
const movementDoc=(row:any)=>clean(row.movementId).replace(/-\d{3}$/,"")||clean(row.movementId);

function txHref(type:string,id:string){
  return `/transactions/${type}/${encodeURIComponent(id)}`;
}

export async function GET(request:NextRequest){
  try{
    const type=clean(request.nextUrl.searchParams.get("type"));
    const partyId=clean(request.nextUrl.searchParams.get("partyId"));
    if(!partyId||!["customer","supplier"].includes(type))throw new Error("Valid party type and partyId are required");
    await requirePermission(type==="customer"?"sales.read":"purchase.read");

    if(type==="customer"){
      const[quotesResult,invoicesResult,paymentsResult,movementsResult]=await Promise.all([
        listTable<any>("Quotes",500,0),
        listTable<any>("Invoices",500,0),
        listTable<any>("Payments",500,0),
        listTable<any>("StockMovements",500,0),
      ]);
      const quotes=(quotesResult.rows||[]).filter((row:any)=>clean(row.customerId)===partyId&&activeStatus(row.status));
      const invoices=(invoicesResult.rows||[]).filter((row:any)=>clean(row.customerId)===partyId&&activeStatus(row.status));
      const payments=(paymentsResult.rows||[]).filter((row:any)=>clean(row.partyType)==="Customer"&&clean(row.partyId)===partyId&&activeStatus(row.status));
      const quoteIds=new Set(quotes.map((row:any)=>clean(row.quoteId)).filter(Boolean));
      const salesOrders=quotes.filter((row:any)=>clean(row.quoteNumber).toUpperCase().startsWith("SO-"));
      const salesQuotes=quotes.filter((row:any)=>!clean(row.quoteNumber).toUpperCase().startsWith("SO-"));
      const orderIds=new Set(salesOrders.map((row:any)=>clean(row.quoteId)).filter(Boolean));
      const deliveryNumbers=new Set<string>();
      for(const row of movementsResult.rows||[]){
        if(clean(row.movementType)!=="SALES_DELIVERY")continue;
        if(!quoteIds.has(clean(row.sourceDocumentId))&&!orderIds.has(clean(row.sourceDocumentId)))continue;
        const num=movementDoc(row);if(num)deliveryNumbers.add(num);
      }
      const recognizedInvoices=invoices.filter(recognizedDocument);
      const outstanding=recognizedInvoices.reduce((sum:number,row:any)=>sum+Math.max(0,n(row.outstandingAmount??row.totalAmount)),0);
      const advancePayments=payments.filter((row:any)=>postedPayment(row)&&!clean(row.againstDocumentId));
      const advanceBalance=advancePayments.reduce((sum:number,row:any)=>sum+Math.max(0,n(row.unallocatedAmount??row.amount)),0);

      const documents:any[]=[];
      for(const row of salesQuotes)documents.push({kind:"Sales Quotation",number:clean(row.quoteNumber)||clean(row.quoteId),status:clean(row.status),amount:n(row.totalAmount),href:txHref("quote",clean(row.quoteId))});
      for(const row of salesOrders)documents.push({kind:"Sales Order",number:clean(row.quoteNumber)||clean(row.quoteId),status:clean(row.status),amount:n(row.totalAmount),href:txHref("quote",clean(row.quoteId))});
      for(const num of deliveryNumbers)documents.push({kind:"Delivery Note / Stock Out",number:num,status:"POSTED",amount:null,href:"/stock?mode=register"});
      for(const row of invoices)documents.push({kind:clean(row.invoiceNumber).toUpperCase().startsWith("CN-")?"Sales Credit Note":"Sales Invoice",number:clean(row.invoiceNumber)||clean(row.invoiceId),status:clean(row.status),amount:n(row.totalAmount),outstanding:n(row.outstandingAmount??row.totalAmount),href:txHref("invoice",clean(row.invoiceId))});
      for(const row of payments)documents.push({kind:clean(row.againstDocumentId)?"Sales Payment / Receipt":"Customer Advance / Receipt",number:clean(row.paymentNumber)||clean(row.paymentId),status:clean(row.status),amount:n(row.amount),href:txHref("payment",clean(row.paymentId))});

      return NextResponse.json({ok:true,type,partyId,summary:{
        outstanding,
        advanceBalance,
        netExposure:outstanding-advanceBalance,
        recognizedInvoiceCount:recognizedInvoices.length,
        salesQuotes:salesQuotes.length,
        salesOrders:salesOrders.length,
        deliveries:deliveryNumbers.size,
        invoices:invoices.length,
        payments:payments.length,
      },documents});
    }

    const[ordersResult,billsResult,paymentsResult,movementsResult]=await Promise.all([
      listTable<any>("PurchaseOrders",500,0),
      listTable<any>("SupplierBills",500,0),
      listTable<any>("Payments",500,0),
      listTable<any>("StockMovements",500,0),
    ]);
    const orders=(ordersResult.rows||[]).filter((row:any)=>clean(row.supplierId)===partyId&&activeStatus(row.status));
    const bills=(billsResult.rows||[]).filter((row:any)=>clean(row.supplierId)===partyId&&activeStatus(row.status));
    const payments=(paymentsResult.rows||[]).filter((row:any)=>clean(row.partyType)==="Supplier"&&clean(row.partyId)===partyId&&activeStatus(row.status));
    const supplierQuotes=orders.filter((row:any)=>clean(row.poNumber).toUpperCase().startsWith("SUPQ-"));
    const purchaseOrders=orders.filter((row:any)=>!clean(row.poNumber).toUpperCase().startsWith("SUPQ-"));
    const poIds=new Set(purchaseOrders.map((row:any)=>clean(row.poId)).filter(Boolean));
    const receiptNumbers=new Set<string>();
    for(const row of movementsResult.rows||[]){
      if(clean(row.movementType)!=="PURCHASE_RECEIPT"||!poIds.has(clean(row.sourceDocumentId)))continue;
      const num=movementDoc(row);if(num)receiptNumbers.add(num);
    }
    const recognizedBills=bills.filter(recognizedDocument);
    const outstanding=recognizedBills.reduce((sum:number,row:any)=>sum+Math.max(0,n(row.outstandingAmount??row.totalAmount)),0);
    const advancePayments=payments.filter((row:any)=>postedPayment(row)&&!clean(row.againstDocumentId));
    const advanceBalance=advancePayments.reduce((sum:number,row:any)=>sum+Math.max(0,n(row.unallocatedAmount??row.amount)),0);

    const documents:any[]=[];
    for(const row of supplierQuotes)documents.push({kind:"Supplier Quotation",number:clean(row.poNumber)||clean(row.poId),status:clean(row.status),amount:n(row.totalAmount),href:txHref("purchaseOrder",clean(row.poId))});
    for(const row of purchaseOrders)documents.push({kind:"Purchase Order",number:clean(row.poNumber)||clean(row.poId),status:clean(row.status),amount:n(row.totalAmount),href:txHref("purchaseOrder",clean(row.poId))});
    for(const num of receiptNumbers)documents.push({kind:"Purchase Receipt / GRN",number:num,status:"POSTED",amount:null,href:"/stock?mode=register"});
    for(const row of bills)documents.push({kind:"Supplier Invoice",number:clean(row.billNumber)||clean(row.billId),status:clean(row.status),amount:n(row.totalAmount),outstanding:n(row.outstandingAmount??row.totalAmount),href:txHref("supplierBill",clean(row.billId))});
    for(const row of payments)documents.push({kind:clean(row.againstDocumentId)?"Purchase Payment":"Supplier Advance / Payment",number:clean(row.paymentNumber)||clean(row.paymentId),status:clean(row.status),amount:n(row.amount),href:txHref("payment",clean(row.paymentId))});

    return NextResponse.json({ok:true,type,partyId,summary:{
      outstanding,
      advanceBalance,
      netExposure:outstanding-advanceBalance,
      recognizedInvoiceCount:recognizedBills.length,
      supplierQuotes:supplierQuotes.length,
      purchaseOrders:purchaseOrders.length,
      receipts:receiptNumbers.size,
      invoices:bills.length,
      payments:payments.length,
    },documents});
  }catch(error){
    const message=error instanceof Error?error.message:"Party financial summary failed";
    return NextResponse.json({ok:false,error:message},{status:message==="Unauthorized"?401:message==="Forbidden"?403:400});
  }
}
