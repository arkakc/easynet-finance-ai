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

type DocumentLink = {
  direction:"previous"|"next";
  label:string;
  id:string;
  number:string;
  href:string;
  type:string;
};

function clean(value:unknown){return String(value||"").trim();}
function isSalesOrder(row:any){return clean(row?.quoteNumber).toUpperCase().startsWith("SO-");}
function isSupplierQuote(row:any){return clean(row?.poNumber).toUpperCase().startsWith("SUPQ-");}
function paymentSourceMarker(row:any,prefix:"SQ"|"PO"){
  const match=clean(row?.reference).match(new RegExp(`^${prefix}:([^|]+)\\|`));
  return match?.[1]||"";
}
function transactionHref(type:string,id:string){
  return `/transactions/${type}/${encodeURIComponent(id)}`;
}
function movementDocumentNumber(row:any){
  const movementId=clean(row?.movementId);
  return movementId.replace(/-\\d{3}$/,"")||movementId;
}
function uniqueLinks(links:DocumentLink[]){
  const seen=new Set<string>();
  return links.filter(link=>{
    const key=`${link.direction}|${link.type}|${link.id}|${link.number}`;
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
}

async function buildDocumentLinks(type:string,record:any):Promise<DocumentLink[]>{
  const links:DocumentLink[]=[];
  const id=clean(
    type==="quote"?record.quoteId:
    type==="invoice"?record.invoiceId:
    type==="purchaseOrder"?record.poId:
    type==="supplierBill"?record.billId:
    type==="payment"?record.paymentId:
    record.expenseId
  );

  if(type==="quote"){
    const order=isSalesOrder(record);
    if(order){
      const sourceId=clean(record.sourceDocumentId||record.sourceQuoteId||record.salesQuoteId);
      if(sourceId){
        const source=(await findRecords<any>("Quotes",{quoteId:sourceId},1)).rows[0];
        links.push({direction:"previous",label:"Sales Quotation",id:sourceId,number:clean(source?.quoteNumber)||sourceId,type:"quote",href:transactionHref("quote",sourceId)});
      }
      const[movements,invoices]=await Promise.all([
        listTable<any>("StockMovements",500,0),
        listTable<any>("Invoices",500,0),
      ]);
      const deliveryNumbers=new Set<string>();
      for(const movement of movements.rows||[]){
        if(clean(movement.movementType)!=="SALES_DELIVERY"||clean(movement.sourceDocumentId)!==id)continue;
        const number=movementDocumentNumber(movement);
        if(!number||deliveryNumbers.has(number))continue;
        deliveryNumbers.add(number);
        links.push({direction:"next",label:"Delivery Note / Stock Out",id:number,number,type:"deliveryNote",href:`/stock?mode=register&sourceDocumentId=${encodeURIComponent(id)}`});
      }
      for(const invoice of invoices.rows||[]){
        if(![invoice.sourceDocumentId,invoice.sourceSalesOrderId,invoice.salesOrderId].some(value=>clean(value)===id))continue;
        const invoiceId=clean(invoice.invoiceId);
        links.push({direction:"next",label:clean(invoice.invoiceNumber).toUpperCase().startsWith("CN-")?"Sales Credit Note":"Sales Invoice",id:invoiceId,number:clean(invoice.invoiceNumber)||invoiceId,type:"invoice",href:transactionHref("invoice",invoiceId)});
      }
    }else{
      const[quotes,invoices,payments]=await Promise.all([
        listTable<any>("Quotes",500,0),
        listTable<any>("Invoices",500,0),
        listTable<any>("Payments",500,0),
      ]);
      for(const next of quotes.rows||[]){
        if(!isSalesOrder(next)||clean(next.sourceDocumentId||next.sourceQuoteId||next.salesQuoteId)!==id)continue;
        const nextId=clean(next.quoteId);
        links.push({direction:"next",label:"Sales Order",id:nextId,number:clean(next.quoteNumber)||nextId,type:"quote",href:transactionHref("quote",nextId)});
      }
      for(const invoice of invoices.rows||[]){
        if(clean(invoice.sourceDocumentId)!==id)continue;
        const invoiceId=clean(invoice.invoiceId);
        links.push({direction:"next",label:"Sales Invoice (legacy/direct source)",id:invoiceId,number:clean(invoice.invoiceNumber)||invoiceId,type:"invoice",href:transactionHref("invoice",invoiceId)});
      }
      for(const payment of payments.rows||[]){
        if(clean(payment.partyType)!=="Customer")continue;
        const source=clean(payment.sourceDocumentId)||paymentSourceMarker(payment,"SQ");
        if(source!==id)continue;
        const paymentId=clean(payment.paymentId);
        links.push({direction:"next",label:"Customer Advance / Receipt",id:paymentId,number:clean(payment.paymentNumber)||paymentId,type:"payment",href:transactionHref("payment",paymentId)});
      }
    }
  }

  if(type==="invoice"){
    const sourceId=clean(record.sourceDocumentId||record.sourceSalesOrderId||record.salesOrderId||record.sourceQuoteId);
    if(sourceId){
      const source=(await findRecords<any>("Quotes",{quoteId:sourceId},1)).rows[0];
      links.push({direction:"previous",label:isSalesOrder(source)?"Sales Order":"Sales Quotation",id:sourceId,number:clean(source?.quoteNumber)||sourceId,type:"quote",href:transactionHref("quote",sourceId)});
    }
    const[invoices,payments]=await Promise.all([listTable<any>("Invoices",500,0),listTable<any>("Payments",500,0)]);
    for(const credit of invoices.rows||[]){
      if(clean(credit.sourceDocumentId)!==id||!clean(credit.invoiceNumber).toUpperCase().startsWith("CN-"))continue;
      const creditId=clean(credit.invoiceId);
      links.push({direction:"next",label:"Sales Credit Note / Return",id:creditId,number:clean(credit.invoiceNumber)||creditId,type:"invoice",href:transactionHref("invoice",creditId)});
    }
    for(const payment of payments.rows||[]){
      if(clean(payment.partyType)!=="Customer")continue;
      if(clean(payment.againstDocumentId)!==id&&clean(payment.sourceDocumentId)!==id)continue;
      const paymentId=clean(payment.paymentId);
      links.push({direction:"next",label:clean(payment.paymentType).toUpperCase()==="PAY"?"Customer Refund":"Sales Payment / Receipt",id:paymentId,number:clean(payment.paymentNumber)||paymentId,type:"payment",href:transactionHref("payment",paymentId)});
    }
  }

  if(type==="purchaseOrder"){
    const supplierQuote=isSupplierQuote(record);
    if(supplierQuote){
      const purchaseOrders=await listTable<any>("PurchaseOrders",500,0);
      for(const po of purchaseOrders.rows||[]){
        if(isSupplierQuote(po)||clean(po.sourceDocumentId||po.sourceSupplierQuoteId||po.supplierQuoteId)!==id)continue;
        const poId=clean(po.poId);
        links.push({direction:"next",label:"Purchase Order",id:poId,number:clean(po.poNumber)||poId,type:"purchaseOrder",href:transactionHref("purchaseOrder",poId)});
      }
    }else{
      const sourceId=clean(record.sourceDocumentId||record.sourceSupplierQuoteId||record.supplierQuoteId);
      if(sourceId){
        const source=(await findRecords<any>("PurchaseOrders",{poId:sourceId},1)).rows[0];
        links.push({direction:"previous",label:"Supplier Quotation",id:sourceId,number:clean(source?.poNumber)||sourceId,type:"purchaseOrder",href:transactionHref("purchaseOrder",sourceId)});
      }
      const[movements,bills,payments]=await Promise.all([
        listTable<any>("StockMovements",500,0),
        listTable<any>("SupplierBills",500,0),
        listTable<any>("Payments",500,0),
      ]);
      const receiptNumbers=new Set<string>();
      for(const movement of movements.rows||[]){
        if(clean(movement.movementType)!=="PURCHASE_RECEIPT"||clean(movement.sourceDocumentId)!==id)continue;
        const number=movementDocumentNumber(movement);
        if(!number||receiptNumbers.has(number))continue;
        receiptNumbers.add(number);
        links.push({direction:"next",label:"Purchase Receipt / GRN",id:number,number,type:"purchaseReceipt",href:`/stock?mode=register&sourcePo=${encodeURIComponent(id)}`});
      }
      for(const bill of bills.rows||[]){
        if(![bill.sourceDocumentId,bill.sourcePurchaseOrderId,bill.poId].some(value=>clean(value)===id))continue;
        const billId=clean(bill.billId);
        links.push({direction:"next",label:"Supplier Invoice",id:billId,number:clean(bill.billNumber)||billId,type:"supplierBill",href:transactionHref("supplierBill",billId)});
      }
      for(const payment of payments.rows||[]){
        if(clean(payment.partyType)!=="Supplier")continue;
        const source=clean(payment.sourceDocumentId)||paymentSourceMarker(payment,"PO");
        if(source!==id)continue;
        const paymentId=clean(payment.paymentId);
        links.push({direction:"next",label:"Supplier Advance / Payment",id:paymentId,number:clean(payment.paymentNumber)||paymentId,type:"payment",href:transactionHref("payment",paymentId)});
      }
    }
  }

  if(type==="supplierBill"){
    const sourceId=clean(record.sourceDocumentId||record.sourcePurchaseOrderId||record.poId);
    if(sourceId){
      const source=(await findRecords<any>("PurchaseOrders",{poId:sourceId},1)).rows[0];
      links.push({direction:"previous",label:"Purchase Order",id:sourceId,number:clean(source?.poNumber)||sourceId,type:"purchaseOrder",href:transactionHref("purchaseOrder",sourceId)});
    }
    const payments=await listTable<any>("Payments",500,0);
    for(const payment of payments.rows||[]){
      if(clean(payment.partyType)!=="Supplier"||clean(payment.againstDocumentId)!==id)continue;
      const paymentId=clean(payment.paymentId);
      links.push({direction:"next",label:"Purchase Payment",id:paymentId,number:clean(payment.paymentNumber)||paymentId,type:"payment",href:transactionHref("payment",paymentId)});
    }
  }

  if(type==="payment"){
    const againstId=clean(record.againstDocumentId);
    const sourceId=clean(record.sourceDocumentId);
    if(againstId){
      const against=clean(record.againstDocumentType).toLowerCase();
      if(clean(record.partyType)==="Customer"){
        const invoice=(await findRecords<any>("Invoices",{invoiceId:againstId},1)).rows[0];
        links.push({direction:"previous",label:against.includes("credit")?"Sales Credit Note":"Sales Invoice",id:againstId,number:clean(invoice?.invoiceNumber)||againstId,type:"invoice",href:transactionHref("invoice",againstId)});
      }else if(clean(record.partyType)==="Supplier"){
        const bill=(await findRecords<any>("SupplierBills",{billId:againstId},1)).rows[0];
        links.push({direction:"previous",label:"Supplier Invoice",id:againstId,number:clean(bill?.billNumber)||againstId,type:"supplierBill",href:transactionHref("supplierBill",againstId)});
      }
    }else if(clean(record.partyType)==="Customer"){
      const quoteId=sourceId||paymentSourceMarker(record,"SQ");
      if(quoteId){
        const quote=(await findRecords<any>("Quotes",{quoteId},1)).rows[0];
        links.push({direction:"previous",label:isSalesOrder(quote)?"Sales Order":"Sales Quotation",id:quoteId,number:clean(quote?.quoteNumber)||quoteId,type:"quote",href:transactionHref("quote",quoteId)});
      }
    }else if(clean(record.partyType)==="Supplier"){
      const poId=sourceId||paymentSourceMarker(record,"PO");
      if(poId){
        const po=(await findRecords<any>("PurchaseOrders",{poId},1)).rows[0];
        links.push({direction:"previous",label:"Purchase Order",id:poId,number:clean(po?.poNumber)||poId,type:"purchaseOrder",href:transactionHref("purchaseOrder",poId)});
      }
    }
  }

  return uniqueLinks(links);
}

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

    const[itemResult,customerResult,supplierResult,projectResult,accountResult,settingsResult]=await Promise.all([
      config.lineTable?listTable<any>("Items",500,0):Promise.resolve({rows:[] as any[]}),
      customerId?findRecords<any>("Customers",{customerId},1):Promise.resolve({rows:[] as any[]}),
      supplierId?listTable<any>("Suppliers",500,0):Promise.resolve({rows:[] as any[]}),
      projectId?findRecords<any>("Projects",{projectId},1):Promise.resolve({rows:[] as any[]}),
      accountId?findRecords<any>("Accounts",{accountId},1):Promise.resolve({rows:[] as any[]}),
      listTable<any>("Settings",500,0),
    ]);
    const baseCurrency=String(
      (settingsResult.rows||[]).find((row:any)=>String(row.key||"")==="currency")?.value
      || (settingsResult.rows||[]).find((row:any)=>String(row.key||"")==="base_currency")?.value
      || "PGK"
    ).trim().toUpperCase();

    const lineItemIds=new Set(lines.map((line:any)=>String(line.itemId||"")).filter(Boolean));
    const items=(itemResult.rows||[]).filter((item:any)=>lineItemIds.has(String(item.itemId||item.itemCode||"")));

    const documentLinks=await buildDocumentLinks(type,record);

    return NextResponse.json({
      ok:true,
      type,
      id,
      number:String(record[config.numberField]||id),
      record,
      lines,
      documentLinks,
      references:{
        customers:customerResult.rows||[],
        suppliers:supplierResult.rows||[],
        projects:projectResult.rows||[],
        accounts:accountResult.rows||[],
        items,
        baseCurrency,
      },
    });
  }catch(error){
    const message=error instanceof Error?error.message:"Document read failed";
    return NextResponse.json({ok:false,error:message},{status:message==="Unauthorized"?401:message==="Forbidden"?403:500});
  }
}
