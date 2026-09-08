import Link from "next/link";
import { notFound } from "next/navigation";
import { findRecords, listTable } from "@/lib/backend/apps-script";
import { requirePermission, type Permission } from "@/lib/auth";
import PrintButton from "@/app/components/print-button";
import DocumentConversionActions from "@/app/components/document-conversion-actions";
import DocumentWorkflowActions from "@/app/components/document-workflow-actions";
import PaymentFinalSave from "@/app/components/payment-final-save";
import SupplierQuoteItemReadiness from "@/app/components/supplier-quote-item-readiness";
import SupplierAdvanceFromPo from "@/app/components/supplier-advance-from-po";
import SupplierInvoiceAdvanceAdjustment from "@/app/components/supplier-invoice-advance-adjustment";
import SupplierAdvanceChainSummary from "@/app/components/supplier-advance-chain-summary";
import PoPartialSupplyClose from "@/app/components/po-partial-supply-close";
import SalesQuoteCycle from "@/app/components/sales-quote-cycle";
import SalesInvoiceCycle from "@/app/components/sales-invoice-cycle";
import LazyDocumentSection from "@/app/components/lazy-document-section";

const CONFIG: Record<string,{table:string;idField:string;numberField:string;lineTable?:string;lineIdField?:string;permission:Permission;title:string}>={
  quote:{table:"Quotes",idField:"quoteId",numberField:"quoteNumber",lineTable:"QuoteLines",lineIdField:"quoteId",permission:"sales.read",title:"Sales Quotation"},
  invoice:{table:"Invoices",idField:"invoiceId",numberField:"invoiceNumber",lineTable:"InvoiceLines",lineIdField:"invoiceId",permission:"sales.read",title:"Sales Invoice"},
  purchaseOrder:{table:"PurchaseOrders",idField:"poId",numberField:"poNumber",lineTable:"POLines",lineIdField:"poId",permission:"purchase.read",title:"Purchase Order"},
  supplierBill:{table:"SupplierBills",idField:"billId",numberField:"billNumber",lineTable:"SupplierBillLines",lineIdField:"billId",permission:"purchase.read",title:"Supplier Invoice"},
  payment:{table:"Payments",idField:"paymentId",numberField:"paymentNumber",permission:"dashboard.read",title:"Payment / Receipt"},
  expense:{table:"Expenses",idField:"expenseId",numberField:"expenseNumber",permission:"purchase.read",title:"Expense"},
};

const labels:Record<string,string>={customerId:"Customer",supplierId:"Supplier",partyId:"Customer / Supplier",projectId:"Project",quoteDate:"Date",invoiceDate:"Date",poDate:"Date",billDate:"Date",paymentDate:"Date",expenseDate:"Date",dueDate:"Due Date",expiryDate:"Valid Till",netAmount:"Net Amount",gstAmount:"GST",totalAmount:"Total",paidAmount:"Paid / Settled",outstandingAmount:"Outstanding",status:"Status",reference:"Reference",paymentMethod:"Payment Method",description:"Description",journalId:"Journal",cashBankAccountId:"Cash / Bank Account",expenseAccountId:"Expense Account"};
const moneyFields=new Set(["netAmount","gstAmount","totalAmount","paidAmount","outstandingAmount","amount"]);
const VALID_MODULES=new Set(["sales","purchase","expense"]);
const VALID_TABS=new Set(["salesQuote","salesInvoice","salesPayment","supplierQuote","purchaseOrder","supplierInvoice","purchasePayment","expense"]);
const VALID_MODES=new Set(["menu","create","list"]);
const SECTION_LABELS:Record<string,string>={salesQuote:"Sales Quotation",salesInvoice:"Sales Invoice",salesPayment:"Sales Payment Entry / Receipt",supplierQuote:"Supplier Quotation",purchaseOrder:"Purchase Order",supplierInvoice:"Supplier Invoice",purchasePayment:"Purchase Payment Entry / Receipt",expense:"Expense"};
const APPROVED_PO_LIFECYCLE=new Set(["APPROVED","PART_RECEIVED","RECEIVED","PART_BILLED","CONVERTED","BILL_CREATED","BILLED","CLOSED_PARTIAL"]);
const QUOTE_ACTION_LIFECYCLE=new Set(["APPROVED","PART_INVOICED","CONVERTED","CLOSED_PARTIAL"]);

function display(key:string,value:unknown){if(moneyFields.has(key))return `K${Number(value||0).toFixed(2)}`;return String(value??"")}
function href(type:string,id:string){return `/transactions/${type==="supplierQuote"?"purchaseOrder":type}/${encodeURIComponent(id)}`;}
type RefLink={label:string;type:string;id:string;number:string};

function named(id: unknown, map: Map<string,string>) {
  const key=String(id||"").trim();
  if(!key)return "—";
  const name=map.get(key);
  return name&&name!==key?`${name} (${key})`:key;
}

function sourceMarkerFromPayment(record:any,prefix:"PO"|"SQ"){
  const reference=String(record.reference||"");
  const match=reference.match(new RegExp(`^${prefix}:([^|]+)\\|`));
  return match?.[1]||"";
}

function previousLink(type:string,record:any):RefLink|null{
  if(type==="invoice"&&record.sourceDocumentId){
    const id=String(record.sourceDocumentId);
    const credit=String(record.invoiceNumber||"").toUpperCase().startsWith("CN-");
    return credit
      ?{label:"Original Sales Invoice",type:"invoice",id,number:id}
      :{label:"Source Sales Quotation",type:"quote",id,number:id};
  }
  if(type==="supplierBill"&&record.sourceDocumentId){const id=String(record.sourceDocumentId);return{label:"Source Purchase Order",type:"purchaseOrder",id,number:id};}
  if(type==="purchaseOrder"&&record.sourceDocumentId){const id=String(record.sourceDocumentId);return{label:"Source Supplier Quotation",type:"supplierQuote",id,number:id};}
  if(type==="payment"&&record.againstDocumentId){
    const id=String(record.againstDocumentId);
    const against=String(record.againstDocumentType||"").toLowerCase();
    if(against.includes("sales invoice")||against.includes("sales credit note")||String(record.partyType||"")==="Customer")return{label:"Against Sales Document",type:"invoice",id,number:id};
    if(against.includes("supplier bill")||against.includes("supplier invoice"))return{label:"Against Supplier Invoice",type:"supplierBill",id,number:id};
    return{label:"Previous Document",type:"purchaseOrder",id,number:id};
  }
  if(type==="payment"){
    const sourceId=String(record.sourceDocumentId||"").trim();
    if(String(record.partyType||"")==="Supplier"){
      const poId=sourceMarkerFromPayment(record,"PO")||sourceId;
      if(poId)return{label:"Advance Against Purchase Order",type:"purchaseOrder",id:poId,number:poId};
    }
    if(String(record.partyType||"")==="Customer"){
      const quoteId=sourceMarkerFromPayment(record,"SQ")||sourceId;
      if(quoteId)return{label:"Advance Against Sales Quotation",type:"quote",id:quoteId,number:quoteId};
    }
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

  const [result,lineResult]=await Promise.all([
    findRecords<any>(config.table,{[config.idField]:id},1),
    config.lineTable&&config.lineIdField?findRecords<any>(config.lineTable,{[config.lineIdField]:id},500):Promise.resolve({rows:[] as any[]}),
  ]);
  const record=result.rows[0];
  if(!record)notFound();

  if(type==="payment"){
    if(String(record.partyType)==="Customer")await requirePermission("sales.read");
    else if(String(record.partyType)==="Supplier")await requirePermission("purchase.read");
    else await requirePermission("accounts.read");
  }

  const needsCustomers=type==="quote"||type==="invoice"||(type==="payment"&&String(record.partyType)==="Customer");
  const needsSuppliers=type==="purchaseOrder"||type==="supplierBill"||type==="expense"||(type==="payment"&&String(record.partyType)==="Supplier");
  const needsProjects=Boolean(String(record.projectId||"").trim());
  const needsAccounts=Boolean(String(record.cashBankAccountId||record.expenseAccountId||"").trim());
  const [itemResult,customerResult,supplierResult,projectResult,accountResult]=await Promise.all([
    config.lineTable?listTable<any>("Items",500,0):Promise.resolve({rows:[] as any[]}),
    needsCustomers?listTable<any>("Customers",500,0):Promise.resolve({rows:[] as any[]}),
    needsSuppliers?listTable<any>("Suppliers",500,0):Promise.resolve({rows:[] as any[]}),
    needsProjects?listTable<any>("Projects",500,0):Promise.resolve({rows:[] as any[]}),
    needsAccounts?listTable<any>("Accounts",500,0):Promise.resolve({rows:[] as any[]}),
  ]);

  const customerMap=new Map((customerResult.rows||[]).map((row:any)=>[String(row.customerId||""),String(row.customerName||row.customerId||"")]));
  const supplierMap=new Map((supplierResult.rows||[]).map((row:any)=>[String(row.supplierId||""),String(row.supplierName||row.supplierId||"")]));
  const projectMap=new Map((projectResult.rows||[]).map((row:any)=>[String(row.projectId||""),String(row.projectName||row.projectId||"")]));
  const accountMap=new Map((accountResult.rows||[]).map((row:any)=>[String(row.accountId||""),`${String(row.accountName||row.accountId||"")} · ${String(row.accountCode||"")}`]));

  const lines=lineResult.rows||[];
  const number=String(record[config.numberField]||id);
  const isSupplierQuotation=type==="purchaseOrder"&&number.startsWith("SUPQ-");
  const isCreditNote=type==="invoice"&&number.toUpperCase().startsWith("CN-");
  const itemMap=new Map((itemResult.rows||[]).map((item:any)=>[String(item.itemId||item.itemCode||""),item]));
  const rowStatus=String(record.status||"DRAFT").toUpperCase();
  const publicStatus=type==="invoice"&&!isCreditNote&&["POSTED","PARTLY_PAID"].includes(rowStatus)?"APPROVED":rowStatus;
  let title=config.title;
  if(isSupplierQuotation)title="Supplier Quotation";
  if(isCreditNote)title="Sales Credit Note / Return";
  if(type==="payment"){
    if(String(record.partyType)==="Customer")title=String(record.paymentType||"").toUpperCase()==="PAY"?"Customer Refund Payment":"Sales Payment Entry / Receipt";
    else if(String(record.partyType)==="Supplier")title="Purchase Payment Entry / Receipt";
  }

  const previous=previousLink(type,record);
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
    if(key==="status"&&type==="invoice"&&!isCreditNote)return publicStatus;
    if(key==="customerId")return named(value,customerMap);
    if(key==="supplierId")return named(value,supplierMap);
    if(key==="partyId")return String(record.partyType)==="Customer"?named(value,customerMap):String(record.partyType)==="Supplier"?named(value,supplierMap):String(value||"");
    if(key==="projectId")return named(value,projectMap);
    if(key==="cashBankAccountId"||key==="expenseAccountId")return named(value,accountMap);
    return display(key,value);
  };

  const editType=type==="invoice"?"invoice":type;
  const canEdit=rowStatus==="DRAFT"&&!String(record.journalId||"").trim()&&!isCreditNote;
  const realPo=type==="purchaseOrder"&&!isSupplierQuotation;
  const realApprovedPo=realPo&&APPROVED_PO_LIFECYCLE.has(rowStatus);
  const supplierName=String(supplierMap.get(String(record.supplierId||""))||record.supplierId||"");
  const projectName=String(projectMap.get(String(record.projectId||""))||record.projectId||"");
  const supplierBillPoId=type==="supplierBill"?String(record.poId||record.sourceDocumentId||""):"";
  const paymentPoId=type==="payment"&&String(record.partyType||"")==="Supplier"?(sourceMarkerFromPayment(record,"PO")||String(record.sourceDocumentId||"")):"";
  const salesInvoiceOutstanding=Number(record.outstandingAmount??record.totalAmount??0);
  const salesInvoiceSettlementReady=type==="invoice"&&!isCreditNote&&["POSTED","PARTLY_PAID"].includes(rowStatus)&&salesInvoiceOutstanding>0.001;
  const salesInvoicePaid=type==="invoice"&&!isCreditNote&&rowStatus==="PAID";
  const paymentFinalizationReady=type==="payment"&&(rowStatus==="APPROVED"||Boolean(String(record.journalId||"").trim()));

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
        <div className={`status-pill status-${publicStatus.toLowerCase()}`}>{publicStatus}</div>
      </header>
      {previous&&<div className="document-meta" style={{marginBottom:20}}>
        <div><span>{previous.label}</span><strong><Link prefetch={false} href={href(previous.type,previous.id)}>{previous.number}</Link></strong></div>
      </div>}
      <div className="document-meta">{fields.map(([key,value])=><div key={key}><span>{labels[key]||key.replace(/([A-Z])/g," $1")}</span><strong>{key==="journalId"?<Link prefetch={false} href={`/journals/${encodeURIComponent(String(value))}`}>{String(value)}</Link>:fieldDisplay(key,value)}</strong></div>)}</div>
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

    <DocumentWorkflowActions recordType={type as "quote"|"invoice"|"purchaseOrder"|"supplierBill"|"payment"|"expense"} recordId={id} status={rowStatus}/>

    {type==="quote"&&QUOTE_ACTION_LIFECYCLE.has(rowStatus)&&<LazyDocumentSection
      title="Sales Quotation Fulfilment"
      description="Stock readiness, linked invoices, backorders, procurement and customer advances are loaded only when you request them."
      buttonLabel={rowStatus==="APPROVED"?"Check Fulfilment / Convert to Sales Invoice":"Open Sales Fulfilment Actions"}
    ><SalesQuoteCycle quoteId={id}/></LazyDocumentSection>}

    {salesInvoiceSettlementReady&&<section className="conversion-box no-print" style={{marginTop:16}}>
      <div className="form-title-row"><div><strong>Sales Invoice Settlement</strong><p className="small">Invoice is approved and accounting-posted. Create or receive the customer payment when needed.</p></div><span className="auto-badge">APPROVED</span></div>
      <div className="button-row" style={{marginTop:12}}><Link prefetch={false} className="button-link" href={`/transactions?module=sales&tab=salesPayment&mode=create&sourceInvoice=${encodeURIComponent(id)}`}>Create / Receive Customer Payment</Link></div>
    </section>}

    {salesInvoicePaid&&<div className="status-banner no-print" style={{marginTop:16}}>Sales Invoice is fully paid.</div>}

    {type==="invoice"&&<LazyDocumentSection
      title={isCreditNote?"Credit Note / Refund Actions":"More Sales Invoice Actions"}
      description={isCreditNote?"Refundable credit controls are loaded only when requested.":"Customer advances and sales return controls are loaded only when requested."}
      buttonLabel={isCreditNote?"Open Refund / Credit Actions":"Open Advance / Return Actions"}
    ><SalesInvoiceCycle invoiceId={id} record={record}/></LazyDocumentSection>}

    {isSupplierQuotation&&["APPROVED","CONVERTED"].includes(rowStatus)&&<LazyDocumentSection
      title="Supplier Quotation Conversion"
      description="Item readiness and linked Purchase Order data are loaded only when needed."
      buttonLabel="Prepare Items / Convert to Purchase Order"
    ><SupplierQuoteItemReadiness supplierQuoteId={id}/></LazyDocumentSection>}

    {realPo&&<LazyDocumentSection
      title="Purchase Order Follow-up"
      description="Linked advances, receipts, partial-close controls and downstream document data are loaded only when requested."
      buttonLabel="Open PO Follow-up Actions"
    >
      {String(record.supplierId||"")&&<SupplierAdvanceChainSummary context="po" poId={id} supplierId={String(record.supplierId||"")} poTotal={Number(record.totalAmount||0)}/>} 
      {realApprovedPo&&<SupplierAdvanceFromPo poId={id} poNumber={number} supplierId={String(record.supplierId||"")} supplierName={supplierName} projectId={String(record.projectId||"")} projectName={projectName} totalAmount={Number(record.totalAmount||0)}/>} 
      <PoPartialSupplyClose poId={id} poNumber={number}/>
      <DocumentConversionActions type={type} id={id} status={rowStatus} documentNumber={number}/>
    </LazyDocumentSection>}

    {type==="supplierBill"&&<LazyDocumentSection
      title="Supplier Invoice Settlement"
      description="Advance chain, allocations and downstream payment data are loaded on demand."
      buttonLabel="Open Supplier Invoice Settlement Actions"
    >
      {supplierBillPoId&&<SupplierAdvanceChainSummary context="invoice" poId={supplierBillPoId} supplierId={String(record.supplierId||"")} billId={id} billNumber={number} billTotal={Number(record.totalAmount||0)} billOutstanding={Number(record.outstandingAmount??record.totalAmount??0)}/>} 
      {supplierBillPoId&&<SupplierInvoiceAdvanceAdjustment billId={id} billNumber={number} poId={supplierBillPoId} supplierId={String(record.supplierId||"")} outstandingAmount={Number(record.outstandingAmount??record.totalAmount??0)} status={rowStatus}/>} 
      <DocumentConversionActions type={type} id={id} status={rowStatus} documentNumber={number}/>
    </LazyDocumentSection>}

    {paymentFinalizationReady&&<PaymentFinalSave record={record}/>} 

    {type==="payment"&&Boolean(String(record.journalId||"").trim())&&<LazyDocumentSection
      title="Payment / Receipt Follow-up"
      description="Linked advance history and downstream references are loaded only when requested."
      buttonLabel="Open Payment / Receipt Follow-up"
    >
      {paymentPoId&&<SupplierAdvanceChainSummary context="payment" poId={paymentPoId} supplierId={String(record.partyId||"")} paymentId={id}/>} 
      <DocumentConversionActions type={type} id={id} status={rowStatus} documentNumber={number}/>
    </LazyDocumentSection>}

    {type==="expense"&&<DocumentConversionActions type={type} id={id} status={rowStatus} documentNumber={number}/>} 
  </div>;
}
