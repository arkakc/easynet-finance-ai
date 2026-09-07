import Link from "next/link";
import { notFound } from "next/navigation";
import { findRecords, listTable } from "@/lib/backend/apps-script";
import { requirePermission, type Permission } from "@/lib/auth";
import PrintButton from "@/app/components/print-button";
import DocumentConversionActions from "@/app/components/document-conversion-actions";
import DocumentWorkflowActions from "@/app/components/document-workflow-actions";
import PaymentFinalSave from "@/app/components/payment-final-save";
import SupplierQuoteItemReadiness from "@/app/components/supplier-quote-item-readiness";

const CONFIG: Record<string,{table:string;idField:string;numberField:string;lineTable?:string;lineIdField?:string;permission:Permission;title:string}>={
  quote:{table:"Quotes",idField:"quoteId",numberField:"quoteNumber",lineTable:"QuoteLines",lineIdField:"quoteId",permission:"sales.read",title:"Sales Quotation"},
  invoice:{table:"Invoices",idField:"invoiceId",numberField:"invoiceNumber",lineTable:"InvoiceLines",lineIdField:"invoiceId",permission:"sales.read",title:"Sales Invoice"},
  purchaseOrder:{table:"PurchaseOrders",idField:"poId",numberField:"poNumber",lineTable:"POLines",lineIdField:"poId",permission:"purchase.read",title:"Purchase Order"},
  supplierBill:{table:"SupplierBills",idField:"billId",numberField:"billNumber",lineTable:"SupplierBillLines",lineIdField:"billId",permission:"purchase.read",title:"Supplier Invoice"},
  payment:{table:"Payments",idField:"paymentId",numberField:"paymentNumber",permission:"dashboard.read",title:"Payment / Receipt"},
  expense:{table:"Expenses",idField:"expenseId",numberField:"expenseNumber",permission:"purchase.read",title:"Expense"},
};

const labels:Record<string,string>={customerId:"Customer",supplierId:"Supplier",partyId:"Customer / Supplier",projectId:"Project",quoteDate:"Date",invoiceDate:"Date",poDate:"Date",billDate:"Date",paymentDate:"Date",expenseDate:"Date",dueDate:"Due Date",expiryDate:"Valid Till",netAmount:"Net Amount",gstAmount:"GST",totalAmount:"Total",paidAmount:"Paid",outstandingAmount:"Outstanding",status:"Status",reference:"Reference",paymentMethod:"Payment Method",description:"Description",journalId:"Journal",cashBankAccountId:"Cash / Bank Account",expenseAccountId:"Expense Account"};
const moneyFields=new Set(["netAmount","gstAmount","totalAmount","paidAmount","outstandingAmount","amount"]);
const VALID_MODULES=new Set(["sales","purchase","expense"]);
const VALID_TABS=new Set(["salesQuote","salesInvoice","salesPayment","supplierQuote","purchaseOrder","supplierInvoice","purchasePayment","expense"]);
const VALID_MODES=new Set(["menu","create","list"]);
const SECTION_LABELS:Record<string,string>={salesQuote:"Sales Quotation",salesInvoice:"Sales Invoice",salesPayment:"Sales Payment Entry / Receipt",supplierQuote:"Supplier Quotation",purchaseOrder:"Purchase Order",supplierInvoice:"Supplier Invoice",purchasePayment:"Purchase Payment Entry / Receipt",expense:"Expense"};

function display(key:string,value:unknown){if(moneyFields.has(key))return `K${Number(value||0).toFixed(2)}`;return String(value??"")}
function href(type:string,id:string){return `/transactions/${type==="supplierQuote"?"purchaseOrder":type}/${encodeURIComponent(id)}`;}
type RefLink={label:string;type:string;id:string;number:string};

function named(id: unknown, map: Map<string,string>) {
  const key=String(id||"").trim();
  if(!key)return "—";
  const name=map.get(key);
  return name&&name!==key?`${name} (${key})`:key;
}

function previousLink(type:string,record:any):RefLink|null{
  if(type==="invoice"&&record.sourceDocumentId){const id=String(record.sourceDocumentId);return{label:"Previous Document",type:"quote",id,number:id};}
  if(type==="supplierBill"&&record.sourceDocumentId){const id=String(record.sourceDocumentId);return{label:"Previous Document",type:"purchaseOrder",id,number:id};}
  if(type==="purchaseOrder"&&record.sourceDocumentId){const id=String(record.sourceDocumentId);return{label:"Previous Document",type:"supplierQuote",id,number:id};}
  if(type==="payment"&&record.againstDocumentId){
    const id=String(record.againstDocumentId);
    const against=String(record.againstDocumentType||"").toLowerCase();
    if(against.includes("sales invoice")||String(record.partyType||"")==="Customer")return{label:"Previous Document",type:"invoice",id,number:id};
    if(against.includes("supplier bill")||against.includes("supplier invoice"))return{label:"Previous Document",type:"supplierBill",id,number:id};
    return{label:"Previous Document",type:"purchaseOrder",id,number:id};
  }
  return null;
}

async function resolveConverted(type:string,id:string,number:string):Promise<RefLink|null>{
  if(type==="quote"){
    const r=(await findRecords<any>("Invoices",{sourceDocumentId:id},1)).rows[0];
    if(r)return{label:"Converted To",type:"invoice",id:r.invoiceId,number:r.invoiceNumber||r.invoiceId};
  }
  if(type==="invoice"){
    const r=(await findRecords<any>("Payments",{againstDocumentId:id},1)).rows[0];
    if(r)return{label:"Converted To",type:"payment",id:r.paymentId,number:r.paymentNumber||r.paymentId};
  }
  if(type==="purchaseOrder"&&number.startsWith("SUPQ-")){
    const rows=(await findRecords<any>("PurchaseOrders",{sourceDocumentId:id},10)).rows;
    const r=rows.find((x:any)=>!String(x.poNumber||"").startsWith("SUPQ-"));
    if(r)return{label:"Converted To",type:"purchaseOrder",id:r.poId,number:r.poNumber||r.poId};
  }
  if(type==="purchaseOrder"){
    const bill=(await findRecords<any>("SupplierBills",{sourceDocumentId:id},1)).rows[0];
    if(bill)return{label:"Converted To",type:"supplierBill",id:bill.billId,number:bill.billNumber||bill.billId};
    const pay=(await findRecords<any>("Payments",{againstDocumentId:id},1)).rows[0];
    if(pay)return{label:"Converted To",type:"payment",id:pay.paymentId,number:pay.paymentNumber||pay.paymentId};
  }
  if(type==="supplierBill"){
    const pay=(await findRecords<any>("Payments",{againstDocumentId:id},1)).rows[0];
    if(pay)return{label:"Converted To",type:"payment",id:pay.paymentId,number:pay.paymentNumber||pay.paymentId};
  }
  return null;
}

function inferredSection(type:string,number:string,record:any){
  if(type==="quote")return{module:"sales",tab:"salesQuote"};
  if(type==="invoice")return{module:"sales",tab:"salesInvoice"};
  if(type==="purchaseOrder"&&number.startsWith("SUPQ-"))return{module:"purchase",tab:"supplierQuote"};
  if(type==="purchaseOrder")return{module:"purchase",tab:"purchaseOrder"};
  if(type==="supplierBill")return{module:"purchase",tab:"supplierInvoice"};
  if(type==="payment"&&String(record.partyType||"")==="Customer")return{module:"sales",tab:"salesPayment"};
  if(type==="payment")return{module:"purchase",tab:"purchasePayment"};
  if(type==="expense")return{module:"expense",tab:"expense"};
  return{module:"sales",tab:"salesQuote"};
}

export default async function TransactionDocumentPage({params,searchParams}:{params:Promise<{type:string;id:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const{type,id}=await params;
  const config=CONFIG[type];
  if(!config)notFound();
  await requirePermission(config.permission);

  const [result,lineResult,itemResult,customerResult,supplierResult,projectResult,accountResult]=await Promise.all([
    findRecords<any>(config.table,{[config.idField]:id},1),
    config.lineTable&&config.lineIdField?findRecords<any>(config.lineTable,{[config.lineIdField]:id},500):Promise.resolve({rows:[] as any[]}),
    config.lineTable?listTable<any>("Items",500,0):Promise.resolve({rows:[] as any[]}),
    listTable<any>("Customers",500,0),
    listTable<any>("Suppliers",500,0),
    listTable<any>("Projects",500,0),
    listTable<any>("Accounts",500,0),
  ]);
  const record=result.rows[0];
  if(!record)notFound();

  if(type==="payment"){
    if(String(record.partyType)==="Customer")await requirePermission("sales.read");
    else if(String(record.partyType)==="Supplier")await requirePermission("purchase.read");
    else await requirePermission("accounts.read");
  }

  const customerMap=new Map((customerResult.rows||[]).map((row:any)=>[String(row.customerId||""),String(row.customerName||row.customerId||"")]));
  const supplierMap=new Map((supplierResult.rows||[]).map((row:any)=>[String(row.supplierId||""),String(row.supplierName||row.supplierId||"")]));
  const projectMap=new Map((projectResult.rows||[]).map((row:any)=>[String(row.projectId||""),String(row.projectName||row.projectId||"")]));
  const accountMap=new Map((accountResult.rows||[]).map((row:any)=>[String(row.accountId||""),`${String(row.accountName||row.accountId||"")} · ${String(row.accountCode||"")}`]));

  const lines=lineResult.rows||[];
  const number=String(record[config.numberField]||id);
  const isSupplierQuotation=type==="purchaseOrder"&&number.startsWith("SUPQ-");
  const itemMap=new Map((itemResult.rows||[]).map((item:any)=>[String(item.itemId||item.itemCode||""),item]));
  const rowStatus=String(record.status||"DRAFT").toUpperCase();
  let title=config.title;
  if(isSupplierQuotation)title="Supplier Quotation";
  if(type==="payment"){
    if(String(record.partyType)==="Customer")title="Sales Payment Entry / Receipt";
    else if(String(record.partyType)==="Supplier")title="Purchase Payment Entry / Receipt";
  }

  const previous=previousLink(type,record);
  const shouldResolveConverted=["CONVERTED","BILL_CREATED","BILLED","PAID"].includes(rowStatus)||isSupplierQuotation;
  const converted=shouldResolveConverted?await resolveConverted(type,id,number):null;

  const query=await searchParams;
  const inferred=inferredSection(type,number,record);
  const requestedModule=Array.isArray(query.returnModule)?query.returnModule[0]:query.returnModule;
  const requestedTab=Array.isArray(query.returnTab)?query.returnTab[0]:query.returnTab;
  const requestedMode=Array.isArray(query.returnMode)?query.returnMode[0]:query.returnMode;
  const backModule=requestedModule&&VALID_MODULES.has(requestedModule)?requestedModule:inferred.module;
  const backTab=requestedTab&&VALID_TABS.has(requestedTab)?requestedTab:inferred.tab;
  const backMode=requestedMode&&VALID_MODES.has(requestedMode)?requestedMode:"menu";
  const backHref=`/transactions?module=${encodeURIComponent(backModule)}&tab=${encodeURIComponent(backTab)}&mode=${encodeURIComponent(backMode)}`;
  const backLabel=SECTION_LABELS[backTab]||"Transactions";

  const hidden=new Set([config.idField,config.numberField,"createdAt","updatedAt","sourceDocumentId","againstDocumentId","againstDocumentType"]);
  const fields=Object.entries(record).filter(([key,value])=>!hidden.has(key)&&value!==""&&value!==null&&value!==undefined);
  const fieldDisplay=(key:string,value:unknown)=>{
    if(key==="customerId")return named(value,customerMap);
    if(key==="supplierId")return named(value,supplierMap);
    if(key==="partyId")return String(record.partyType)==="Customer"?named(value,customerMap):String(record.partyType)==="Supplier"?named(value,supplierMap):String(value||"");
    if(key==="projectId")return named(value,projectMap);
    if(key==="cashBankAccountId"||key==="expenseAccountId")return named(value,accountMap);
    return display(key,value);
  };

  const editType=type==="invoice"?"invoice":type;
  const canEdit=rowStatus==="DRAFT"&&!String(record.journalId||"").trim();

  return <div className="document-page">
    <div className="document-toolbar no-print">
      <Link prefetch={false} href={backHref}>← Back to {backLabel}</Link>
      <div className="row-actions">
        {canEdit&&<Link prefetch={false} className="button-link" href={type==="invoice"?`/transactions/invoice/${encodeURIComponent(id)}/edit`:`/transactions/${encodeURIComponent(editType)}/${encodeURIComponent(id)}/edit`}>Edit Draft</Link>}
        <PrintButton/>
      </div>
    </div>
    <section className="document-sheet">
      <header className="document-header">
        <div><div className="eyebrow">EASYNET IT SOLUTIONS LIMITED</div><h1>{title}</h1><div className="document-number">{number}</div></div>
        <div className={`status-pill status-${String(record.status||"draft").toLowerCase()}`}>{record.status||"DRAFT"}</div>
      </header>
      {(previous||converted)&&<div className="document-meta" style={{marginBottom:20}}>
        {previous&&<div><span>{previous.label}</span><strong><Link prefetch={false} href={href(previous.type,previous.id)}>{previous.number}</Link></strong></div>}
        {converted&&<div><span>{converted.label}</span><strong><Link prefetch={false} href={href(converted.type,converted.id)}>{converted.number}</Link></strong></div>}
      </div>}
      <div className="document-meta">{fields.map(([key,value])=><div key={key}><span>{labels[key]||key.replace(/([A-Z])/g," $1")}</span><strong>{key==="journalId"?<Link href={`/journals/${encodeURIComponent(String(value))}`}>{String(value)}</Link>:fieldDisplay(key,value)}</strong></div>)}</div>
      {lines.length>0&&<div className="document-lines"><table className="data-table"><thead><tr><th>#</th><th>Item Code</th><th>Item Name</th><th>UOM</th><th>Moving Avg Cost</th><th>Qty</th><th>Rate</th><th>Net</th><th>GST</th><th>Total</th></tr></thead><tbody>{lines.map((line:any,index:number)=>{
        const itemId=String(line.itemId||"");
        const item=itemId?itemMap.get(itemId):null;
        const itemCode=String(item?.itemCode||item?.itemId||itemId||"");
        const itemName=String(item?.itemName||line.description||"");
        const originalTemp=String(line.description||"");
        const uom=String(line.uom||item?.uom||"Each");
        const movingAverage=item?`K${Number(item.defaultRate||0).toFixed(2)}`:"—";
        const lineKey=line.invoiceLineId||line.quoteLineId||line.poLineId||line.billLineId||index;
        return <tr key={lineKey}>
          <td>{line.lineNo||index+1}</td>
          <td>{item?<Link prefetch={false} href={`/stock/item/${encodeURIComponent(item.itemId||item.itemCode)}`}><strong>{itemCode}</strong></Link>:isSupplierQuotation?<span className="small">TEMP</span>:<span>{itemCode||"UNLINKED"}</span>}</td>
          <td>{item?<><Link prefetch={false} href={`/stock/item/${encodeURIComponent(item.itemId||item.itemCode)}`}>{itemName}</Link>{isSupplierQuotation&&originalTemp&&originalTemp!==itemName?<><br/><span className="small">Original TEMP: {originalTemp}</span></>:null}</>:itemName}</td>
          <td>{uom}</td>
          <td>{movingAverage}</td>
          <td>{line.qty}</td>
          <td>K{Number(line.rate||0).toFixed(2)}</td>
          <td>K{Number(line.netAmount||0).toFixed(2)}</td>
          <td>K{Number(line.gstAmount||0).toFixed(2)}</td>
          <td><strong>K{Number(line.totalAmount||0).toFixed(2)}</strong></td>
        </tr>;
      })}</tbody></table></div>}
      <div className="document-footer"><span>System generated document</span><span>Record ID: {id}</span></div>
    </section>
    <DocumentWorkflowActions recordType={type as "quote"|"invoice"|"purchaseOrder"|"supplierBill"|"payment"|"expense"} recordId={id} status={String(record.status||"DRAFT")}/>
    {type==="payment"&&<PaymentFinalSave record={record}/>}
    {isSupplierQuotation?<SupplierQuoteItemReadiness supplierQuoteId={id}/>:<DocumentConversionActions type={type} id={id} status={String(record.status||"")} documentNumber={number}/>} 
  </div>;
}
