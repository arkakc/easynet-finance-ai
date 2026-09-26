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
  stage:number;
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
  return movementId.replace(/-\d{3}$/,"")||movementId;
}
function uniqueLinks(links:DocumentLink[]){
  const seen=new Set<string>();
  return links.filter(link=>{
    const key=`${link.direction}|${link.type}|${link.id}|${link.number}`;
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  }).sort((a,b)=>a.stage-b.stage||a.number.localeCompare(b.number));
}

async function buildDocumentLinks(type:string,record:any):Promise<DocumentLink[]>{
  const links:DocumentLink[]=[];
  const currentId=clean(
    type==="quote"?record.quoteId:
    type==="invoice"?record.invoiceId:
    type==="purchaseOrder"?record.poId:
    type==="supplierBill"?record.billId:
    type==="payment"?record.paymentId:
    record.expenseId
  );

  const add=(stage:number,currentStage:number,label:string,id:string,number:string,linkType:string,href:string)=>{
    if(!id||id===currentId)return;
    links.push({
      direction:stage<currentStage?"previous":"next",
      label,
      id,
      number:number||id,
      type:linkType,
      href,
      stage,
    });
  };

  const salesSide =
    type==="quote" ||
    type==="invoice" ||
    (type==="payment"&&clean(record.partyType)==="Customer");

  if(salesSide){
    const[quotesResult,invoicesResult,paymentsResult,movementsResult]=await Promise.all([
      listTable<any>("Quotes",500,0),
      listTable<any>("Invoices",500,0),
      listTable<any>("Payments",500,0),
      listTable<any>("StockMovements",500,0),
    ]);
    const quotes=quotesResult.rows||[];
    const invoices=invoicesResult.rows||[];
    const payments=paymentsResult.rows||[];
    const movements=movementsResult.rows||[];
    const quoteById=new Map(quotes.map((row:any)=>[clean(row.quoteId),row]));
    const invoiceById=new Map(invoices.map((row:any)=>[clean(row.invoiceId),row]));

    let rootQuoteId="";
    let currentStage=10;

    if(type==="quote"){
      if(isSalesOrder(record)){
        currentStage=20;
        rootQuoteId=clean(record.sourceDocumentId||record.sourceQuoteId||record.salesQuoteId);
      }else{
        currentStage=10;
        rootQuoteId=currentId;
      }
    }else if(type==="invoice"){
      currentStage=40;
      const sourceId=clean(record.sourceDocumentId||record.sourceSalesOrderId||record.salesOrderId||record.sourceQuoteId);
      const sourceQuote=quoteById.get(sourceId);
      rootQuoteId=sourceQuote&&isSalesOrder(sourceQuote)
        ? clean(sourceQuote.sourceDocumentId||sourceQuote.sourceQuoteId||sourceQuote.salesQuoteId)
        : sourceId;
    }else if(type==="payment"){
      const againstId=clean(record.againstDocumentId);
      if(againstId){
        currentStage=50;
        const invoice=invoiceById.get(againstId);
        const invoiceSource=clean(invoice?.sourceDocumentId||invoice?.sourceSalesOrderId||invoice?.salesOrderId||invoice?.sourceQuoteId);
        const sourceQuote=quoteById.get(invoiceSource);
        rootQuoteId=sourceQuote&&isSalesOrder(sourceQuote)
          ? clean(sourceQuote.sourceDocumentId||sourceQuote.sourceQuoteId||sourceQuote.salesQuoteId)
          : invoiceSource;
      }else{
        currentStage=15;
        rootQuoteId=clean(record.sourceDocumentId)||paymentSourceMarker(record,"SQ");
        const sourceQuote=quoteById.get(rootQuoteId);
        if(sourceQuote&&isSalesOrder(sourceQuote)){
          rootQuoteId=clean(sourceQuote.sourceDocumentId||sourceQuote.sourceQuoteId||sourceQuote.salesQuoteId);
        }
      }
    }

    if(rootQuoteId){
      const rootQuote=quoteById.get(rootQuoteId);
      if(rootQuote) add(10,currentStage,"Sales Quotation",rootQuoteId,clean(rootQuote.quoteNumber)||rootQuoteId,"quote",transactionHref("quote",rootQuoteId));

      const salesOrders=quotes.filter((row:any)=>
        isSalesOrder(row)&&clean(row.sourceDocumentId||row.sourceQuoteId||row.salesQuoteId)===rootQuoteId
      );
      const orderIds=new Set(salesOrders.map((row:any)=>clean(row.quoteId)).filter(Boolean));
      for(const order of salesOrders){
        const orderId=clean(order.quoteId);
        add(20,currentStage,"Sales Order",orderId,clean(order.quoteNumber)||orderId,"quote",transactionHref("quote",orderId));
      }

      const deliverySources=new Set<string>([rootQuoteId,...orderIds]);
      const deliveryNumbers=new Set<string>();
      for(const movement of movements){
        if(clean(movement.movementType)!=="SALES_DELIVERY")continue;
        if(!deliverySources.has(clean(movement.sourceDocumentId)))continue;
        const number=movementDocumentNumber(movement);
        if(!number||deliveryNumbers.has(number))continue;
        deliveryNumbers.add(number);
        const sourceId=clean(movement.sourceDocumentId);
        add(30,currentStage,"Delivery Note / Stock Out",number,number,"deliveryNote",`/stock?mode=register&sourceDocumentId=${encodeURIComponent(sourceId)}`);
      }

      const chainInvoices=invoices.filter((invoice:any)=>{
        const sourceIds=[invoice.sourceDocumentId,invoice.sourceSalesOrderId,invoice.salesOrderId,invoice.sourceQuoteId].map(clean);
        return sourceIds.some((sourceId:string)=>sourceId===rootQuoteId||orderIds.has(sourceId));
      });
      const invoiceIds=new Set(chainInvoices.map((row:any)=>clean(row.invoiceId)).filter(Boolean));
      for(const invoice of chainInvoices){
        const invoiceId=clean(invoice.invoiceId);
        const credit=clean(invoice.invoiceNumber).toUpperCase().startsWith("CN-");
        add(credit?45:40,currentStage,credit?"Sales Credit Note / Return":"Sales Invoice",invoiceId,clean(invoice.invoiceNumber)||invoiceId,"invoice",transactionHref("invoice",invoiceId));
      }

      for(const payment of payments){
        if(clean(payment.partyType)!=="Customer")continue;
        const paymentId=clean(payment.paymentId);
        if(!paymentId)continue;
        const sourceId=clean(payment.sourceDocumentId);
        const markerQuoteId=paymentSourceMarker(payment,"SQ");
        const againstId=clean(payment.againstDocumentId);
        const isAdvance=sourceId===rootQuoteId||markerQuoteId===rootQuoteId||orderIds.has(sourceId);
        const isSettlement=invoiceIds.has(againstId)||invoiceIds.has(sourceId);
        if(!isAdvance&&!isSettlement)continue;
        const refund=clean(payment.paymentType).toUpperCase()==="PAY";
        add(isSettlement?50:15,currentStage,refund?"Customer Refund Payment":isSettlement?"Sales Payment / Receipt":"Customer Advance / Receipt",paymentId,clean(payment.paymentNumber)||paymentId,"payment",transactionHref("payment",paymentId));
      }
    }
  }

  const purchaseSide =
    type==="purchaseOrder" ||
    type==="supplierBill" ||
    (type==="payment"&&clean(record.partyType)==="Supplier");

  if(purchaseSide){
    const[ordersResult,billsResult,paymentsResult,movementsResult]=await Promise.all([
      listTable<any>("PurchaseOrders",500,0),
      listTable<any>("SupplierBills",500,0),
      listTable<any>("Payments",500,0),
      listTable<any>("StockMovements",500,0),
    ]);
    const orders=ordersResult.rows||[];
    const bills=billsResult.rows||[];
    const payments=paymentsResult.rows||[];
    const movements=movementsResult.rows||[];
    const orderById=new Map(orders.map((row:any)=>[clean(row.poId),row]));
    const billById=new Map(bills.map((row:any)=>[clean(row.billId),row]));

    let supplierQuoteId="";
    let poIds=new Set<string>();
    let currentStage=10;

    if(type==="purchaseOrder"){
      if(isSupplierQuote(record)){
        currentStage=10;
        supplierQuoteId=currentId;
        poIds=new Set(
          orders
            .filter((row:any)=>!isSupplierQuote(row)&&clean(row.sourceDocumentId||row.sourceSupplierQuoteId||row.supplierQuoteId)===supplierQuoteId)
            .map((row:any)=>clean(row.poId))
            .filter(Boolean)
        );
      }else{
        currentStage=20;
        poIds=new Set([currentId]);
        supplierQuoteId=clean(record.sourceDocumentId||record.sourceSupplierQuoteId||record.supplierQuoteId);
      }
    }else if(type==="supplierBill"){
      currentStage=40;
      const poId=clean(record.sourceDocumentId||record.sourcePurchaseOrderId||record.poId);
      if(poId)poIds=new Set([poId]);
      const po=orderById.get(poId);
      supplierQuoteId=clean(po?.sourceDocumentId||po?.sourceSupplierQuoteId||po?.supplierQuoteId);
    }else if(type==="payment"){
      const againstId=clean(record.againstDocumentId);
      if(againstId){
        currentStage=50;
        const bill=billById.get(againstId);
        const poId=clean(bill?.sourceDocumentId||bill?.sourcePurchaseOrderId||bill?.poId);
        if(poId)poIds=new Set([poId]);
        const po=orderById.get(poId);
        supplierQuoteId=clean(po?.sourceDocumentId||po?.sourceSupplierQuoteId||po?.supplierQuoteId);
      }else{
        currentStage=25;
        const poId=clean(record.sourceDocumentId)||paymentSourceMarker(record,"PO");
        if(poId)poIds=new Set([poId]);
        const po=orderById.get(poId);
        if(po&&isSupplierQuote(po)){
          supplierQuoteId=poId;
          poIds=new Set(
            orders
              .filter((row:any)=>!isSupplierQuote(row)&&clean(row.sourceDocumentId||row.sourceSupplierQuoteId||row.supplierQuoteId)===supplierQuoteId)
              .map((row:any)=>clean(row.poId))
              .filter(Boolean)
          );
        }else{
          supplierQuoteId=clean(po?.sourceDocumentId||po?.sourceSupplierQuoteId||po?.supplierQuoteId);
        }
      }
    }

    if(supplierQuoteId){
      const supplierQuote=orderById.get(supplierQuoteId);
      if(supplierQuote)add(10,currentStage,"Supplier Quotation",supplierQuoteId,clean(supplierQuote.poNumber)||supplierQuoteId,"purchaseOrder",transactionHref("purchaseOrder",supplierQuoteId));
      if(poIds.size===0){
        poIds=new Set(
          orders
            .filter((row:any)=>!isSupplierQuote(row)&&clean(row.sourceDocumentId||row.sourceSupplierQuoteId||row.supplierQuoteId)===supplierQuoteId)
            .map((row:any)=>clean(row.poId))
            .filter(Boolean)
        );
      }
    }

    for(const poId of poIds){
      const po=orderById.get(poId);
      if(po)add(20,currentStage,"Purchase Order",poId,clean(po.poNumber)||poId,"purchaseOrder",transactionHref("purchaseOrder",poId));
    }

    const receiptNumbers=new Set<string>();
    for(const movement of movements){
      if(clean(movement.movementType)!=="PURCHASE_RECEIPT")continue;
      const sourcePo=clean(movement.sourceDocumentId);
      if(!poIds.has(sourcePo))continue;
      const number=movementDocumentNumber(movement);
      if(!number||receiptNumbers.has(number))continue;
      receiptNumbers.add(number);
      add(30,currentStage,"Purchase Receipt / GRN",number,number,"purchaseReceipt",`/stock?mode=register&sourcePo=${encodeURIComponent(sourcePo)}`);
    }

    const chainBills=bills.filter((bill:any)=>
      [bill.sourceDocumentId,bill.sourcePurchaseOrderId,bill.poId].map(clean).some((poId:string)=>poIds.has(poId))
    );
    const billIds=new Set(chainBills.map((row:any)=>clean(row.billId)).filter(Boolean));
    for(const bill of chainBills){
      const billId=clean(bill.billId);
      add(40,currentStage,"Supplier Invoice",billId,clean(bill.billNumber)||billId,"supplierBill",transactionHref("supplierBill",billId));
    }

    for(const payment of payments){
      if(clean(payment.partyType)!=="Supplier")continue;
      const paymentId=clean(payment.paymentId);
      if(!paymentId)continue;
      const sourceId=clean(payment.sourceDocumentId);
      const markerPoId=paymentSourceMarker(payment,"PO");
      const againstId=clean(payment.againstDocumentId);
      const isAdvance=poIds.has(sourceId)||poIds.has(markerPoId);
      const isSettlement=billIds.has(againstId)||billIds.has(sourceId);
      if(!isAdvance&&!isSettlement)continue;
      add(isSettlement?50:25,currentStage,isSettlement?"Purchase Payment":"Supplier Advance / Payment",paymentId,clean(payment.paymentNumber)||paymentId,"payment",transactionHref("payment",paymentId));
    }
  }

  return uniqueLinks(links);
}
export async function GET(request:NextRequest){
  try{
    let type=String(request.nextUrl.searchParams.get("type")||"");
    const id=String(request.nextUrl.searchParams.get("id")||"").trim();
    if(!id)return NextResponse.json({ok:false,error:"Document number / ID is required"},{status:400});

    let config=type?CONFIG[type]:undefined;
    let result:{rows:any[]}={rows:[]};

    if(config){
      await requirePermission(config.permission);
      result=await findRecords<any>(config.table,{[config.idField]:id},1);
      if(!result.rows[0])result=await findRecords<any>(config.table,{[config.numberField]:id},1);
    }else{
      await requirePermission("dashboard.read");
      const matches:Array<{type:string;config:(typeof CONFIG)[string];record:any}>=[];
      for(const [candidateType,candidateConfig] of Object.entries(CONFIG)){
        let candidate=await findRecords<any>(candidateConfig.table,{[candidateConfig.idField]:id},1);
        if(!candidate.rows[0])candidate=await findRecords<any>(candidateConfig.table,{[candidateConfig.numberField]:id},1);
        if(candidate.rows[0])matches.push({type:candidateType,config:candidateConfig,record:candidate.rows[0]});
      }
      if(matches.length===0)return NextResponse.json({ok:false,error:"Document not found"},{status:404});
      if(matches.length>1){
        return NextResponse.json({
          ok:false,
          error:"More than one document matched this ID / number. Use the exact document number.",
          matches:matches.map(match=>({
            type:match.type,
            id:String(match.record[match.config.idField]||""),
            number:String(match.record[match.config.numberField]||""),
          })),
        },{status:409});
      }
      type=matches[0].type;
      config=matches[0].config;
      result={rows:[matches[0].record]};
      await requirePermission(config.permission);
    }

    if(!config)return NextResponse.json({ok:false,error:"Unsupported document type"},{status:400});
    const record=result.rows[0];
    if(!record)return NextResponse.json({ok:false,error:"Document not found"},{status:404});
    const resolvedId=String(record[config.idField]||id);
    const lineResult=config.lineTable&&config.lineIdField
      ? await findRecords<any>(config.lineTable,{[config.lineIdField]:resolvedId},500)
      : {rows:[] as any[]};

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
      id:resolvedId,
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
