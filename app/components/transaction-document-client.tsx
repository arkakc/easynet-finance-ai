"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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

const CONFIG:Record<string,{numberField:string;title:string}>={
  quote:{numberField:"quoteNumber",title:"Sales Quotation"},
  invoice:{numberField:"invoiceNumber",title:"Sales Invoice"},
  purchaseOrder:{numberField:"poNumber",title:"Purchase Order"},
  supplierBill:{numberField:"billNumber",title:"Supplier Invoice"},
  payment:{numberField:"paymentNumber",title:"Payment / Receipt"},
  expense:{numberField:"expenseNumber",title:"Expense"},
};
const labels:Record<string,string>={customerId:"Customer",supplierId:"Supplier",partyId:"Customer / Supplier",projectId:"Project",quoteDate:"Date",invoiceDate:"Date",poDate:"Date",billDate:"Date",paymentDate:"Date",expenseDate:"Date",dueDate:"Due Date",expiryDate:"Valid Till",netAmount:"Net Amount",gstAmount:"GST",totalAmount:"Total",paidAmount:"Paid / Settled",outstandingAmount:"Outstanding",status:"Status",reference:"Reference",paymentMethod:"Payment Method",description:"Description",journalId:"Journal",cashBankAccountId:"Cash / Bank Account",expenseAccountId:"Expense Account"};
const moneyFields=new Set(["netAmount","gstAmount","totalAmount","paidAmount","outstandingAmount","amount"]);
const VALID_MODULES=new Set(["sales","purchase","expense"]);
const VALID_TABS=new Set(["salesQuote","salesInvoice","salesPayment","supplierQuote","purchaseOrder","supplierInvoice","purchasePayment","expense"]);
const VALID_MODES=new Set(["menu","create","list"]);
const SECTION_LABELS:Record<string,string>={salesQuote:"Sales Quotation",salesInvoice:"Sales Invoice",salesPayment:"Sales Payment Entry / Receipt",supplierQuote:"Supplier Quotation",purchaseOrder:"Purchase Order",supplierInvoice:"Supplier Invoice",purchasePayment:"Purchase Payment Entry / Receipt",expense:"Expense"};
const APPROVED_PO_LIFECYCLE=new Set(["APPROVED","PART_RECEIVED","RECEIVED","PART_BILLED","CONVERTED","BILL_CREATED","BILLED","CLOSED_PARTIAL"]);
const QUOTE_ACTION_LIFECYCLE=new Set(["APPROVED","PART_INVOICED","CONVERTED","CLOSED_PARTIAL"]);

const n=(value:unknown)=>{const parsed=Number(value??0);return Number.isFinite(parsed)?parsed:0;};
function display(key:string,value:unknown){if(moneyFields.has(key))return `K${n(value).toFixed(2)}`;return String(value??"");}
function href(type:string,id:string){return `/transactions/${type==="supplierQuote"?"purchaseOrder":type}/${encodeURIComponent(id)}`;}
type RefLink={label:string;type:string;id:string;number:string};
type ReturnContext={returnModule?:string;returnTab?:string;returnMode?:string};

function named(id:unknown,map:Map<string,string>){const key=String(id||"").trim();if(!key)return"—";const name=map.get(key);return name&&name!==key?`${name} (${key})`:key;}
function sourceMarkerFromPayment(record:any,prefix:"PO"|"SQ"){const match=String(record.reference||"").match(new RegExp(`^${prefix}:([^|]+)\\|`));return match?.[1]||"";}
function previousLink(type:string,record:any):RefLink|null{
  if(type==="invoice"&&record.sourceDocumentId){const id=String(record.sourceDocumentId);const credit=String(record.invoiceNumber||"").toUpperCase().startsWith("CN-");return credit?{label:"Original Sales Invoice",type:"invoice",id,number:id}:{label:"Source Sales Quotation",type:"quote",id,number:id};}
  if(type==="supplierBill"&&record.sourceDocumentId){const id=String(record.sourceDocumentId);return{label:"Source Purchase Order",type:"purchaseOrder",id,number:id};}
  if(type==="purchaseOrder"&&record.sourceDocumentId){const id=String(record.sourceDocumentId);return{label:"Source Supplier Quotation",type:"supplierQuote",id,number:id};}
  if(type==="payment"&&record.againstDocumentId){const id=String(record.againstDocumentId);const against=String(record.againstDocumentType||"").toLowerCase();if(against.includes("sales invoice")||against.includes("sales credit note")||String(record.partyType||"")==="Customer")return{label:"Against Sales Document",type:"invoice",id,number:id};if(against.includes("supplier bill")||against.includes("supplier invoice"))return{label:"Against Supplier Invoice",type:"supplierBill",id,number:id};return{label:"Previous Document",type:"purchaseOrder",id,number:id};}
  if(type==="payment"){const sourceId=String(record.sourceDocumentId||"").trim();if(String(record.partyType||"")==="Supplier"){const poId=sourceMarkerFromPayment(record,"PO")||sourceId;if(poId)return{label:"Advance Against Purchase Order",type:"purchaseOrder",id:poId,number:poId};}if(String(record.partyType||"")==="Customer"){const quoteId=sourceMarkerFromPayment(record,"SQ")||sourceId;if(quoteId)return{label:"Advance Against Sales Quotation",type:"quote",id:quoteId,number:quoteId};}}
  return null;
}
function inferredSection(type:string,number:string,record:any){if(type==="quote")return{module:"sales",tab:"salesQuote"};if(type==="invoice")return{module:"sales",tab:"salesInvoice"};if(type==="purchaseOrder"&&number.startsWith("SUPQ-"))return{module:"purchase",tab:"supplierQuote"};if(type==="purchaseOrder")return{module:"purchase",tab:"purchaseOrder"};if(type==="supplierBill")return{module:"purchase",tab:"supplierInvoice"};if(type==="payment"&&String(record.partyType||"")==="Customer")return{module:"sales",tab:"salesPayment"};if(type==="payment")return{module:"purchase",tab:"purchasePayment"};if(type==="expense")return{module:"expense",tab:"expense"};return{module:"sales",tab:"salesQuote"};}

export default function TransactionDocumentClient({type,id}:{type:string;id:string}){
  const config=CONFIG[type];
  const[record,setRecord]=useState<any|null>(null);
  const[lines,setLines]=useState<any[]>([]);
  const[references,setReferences]=useState<any>({customers:[],suppliers:[],projects:[],accounts:[],items:[]});
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState("");
  const[returnContext,setReturnContext]=useState<ReturnContext>({});
  const[deleteBusy,setDeleteBusy]=useState(false);

  async function handleDeleteDocument(){
    if(deleteBusy)return;
    const confirmed=window.confirm(`Are you sure you want to delete ${number}? This action cannot be undone.`);
    if(!confirmed)return;
    setDeleteBusy(true);
    try{
      const response=await fetch("/api/erp/transactions",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"deleteDocument",payload:{type,id}})
      });
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Delete failed");
      alert(`Document ${number} has been deleted successfully.`);
      window.location.href=backHref;
    }catch(err){
      alert(`Cannot delete ${number}:\n\n${err instanceof Error?err.message:"Delete failed"}`);
    }finally{
      setDeleteBusy(false);
    }
  }

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    setReturnContext({returnModule:params.get("returnModule")||undefined,returnTab:params.get("returnTab")||undefined,returnMode:params.get("returnMode")||undefined});
    const controller=new AbortController();
    const frame=window.requestAnimationFrame(()=>{void(async()=>{
      try{
        const response=await fetch(`/api/erp/transaction-document?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`,{cache:"no-store",signal:controller.signal});
        const body=await response.json();
        if(!response.ok||!body.ok)throw new Error(body.error||"Document load failed");
        setRecord(body.record||null);setLines(body.lines||[]);setReferences(body.references||{});
      }catch(err){if(!controller.signal.aborted)setError(err instanceof Error?err.message:"Document load failed");}
      finally{if(!controller.signal.aborted)setLoading(false);}
    })();});
    return()=>{controller.abort();window.cancelAnimationFrame(frame);};
  },[type,id]);

  const customerMap=useMemo(()=>new Map<string, string>((references.customers||[]).map((row:any)=>[String(row.customerId||""),String(row.customerName||row.customerId||"")])),[references.customers]);
  const supplierMap=useMemo(()=>new Map<string, string>((references.suppliers||[]).map((row:any)=>[String(row.supplierId||""),String(row.supplierName||row.supplierId||"")])),[references.suppliers]);
  const projectMap=useMemo(()=>new Map<string, string>((references.projects||[]).map((row:any)=>[String(row.projectId||""),String(row.projectName||row.projectId||"")])),[references.projects]);
  const accountMap=useMemo(()=>new Map<string, string>((references.accounts||[]).map((row:any)=>[String(row.accountId||""),`${String(row.accountName||row.accountId||"")} · ${String(row.accountCode||"")}`])),[references.accounts]);
  const itemMap=useMemo(()=>new Map<string, any>((references.items||[]).map((item:any)=>[String(item.itemId||item.itemCode||""),item])),[references.items]);

  const number=record?String(record[config?.numberField||""]||id):id;
  const isSupplierQuotation=type==="purchaseOrder"&&number.startsWith("SUPQ-");
  const isCreditNote=type==="invoice"&&number.toUpperCase().startsWith("CN-");
  const rowStatus=String(record?.status||"DRAFT").toUpperCase();
  const publicStatus=type==="invoice"&&!isCreditNote&&["POSTED","PARTLY_PAID"].includes(rowStatus)?"APPROVED":rowStatus;
  let title=config?.title||"Transaction Document";
  if(isSupplierQuotation)title="Supplier Quotation";
  if(isCreditNote)title="Sales Credit Note / Return";
  if(type==="payment"&&record){if(String(record.partyType)==="Customer")title=String(record.paymentType||"").toUpperCase()==="PAY"?"Customer Refund Payment":"Sales Payment Entry / Receipt";else if(String(record.partyType)==="Supplier")title="Purchase Payment Entry / Receipt";}

  const inferred=record?inferredSection(type,number,record):{module:"sales",tab:"salesQuote"};
  const backModule=returnContext.returnModule&&VALID_MODULES.has(returnContext.returnModule)?returnContext.returnModule:inferred.module;
  const backTab=returnContext.returnTab&&VALID_TABS.has(returnContext.returnTab)?returnContext.returnTab:inferred.tab;
  const backMode=returnContext.returnMode&&VALID_MODES.has(returnContext.returnMode)?returnContext.returnMode:"menu";
  const backHref=`/transactions?module=${encodeURIComponent(backModule)}&tab=${encodeURIComponent(backTab)}&mode=${encodeURIComponent(backMode)}`;
  const backLabel=SECTION_LABELS[backTab]||"Transactions";

  if(!config)return <section className="panel warning-panel"><strong>Unsupported transaction document type.</strong></section>;

  const previous=record?previousLink(type,record):null;
  const hidden=new Set([type==="quote"?"quoteId":type==="invoice"?"invoiceId":type==="purchaseOrder"?"poId":type==="supplierBill"?"billId":type==="payment"?"paymentId":"expenseId",config.numberField,"createdAt","updatedAt","sourceDocumentId","againstDocumentId","againstDocumentType"]);
  const fields=record?Object.entries(record).filter(([key,value])=>!hidden.has(key)&&value!==""&&value!==null&&value!==undefined):[];
  const fieldDisplay=(key:string,value:unknown)=>{if(key==="status"&&type==="invoice"&&!isCreditNote)return publicStatus;if(key==="customerId")return named(value,customerMap);if(key==="supplierId")return named(value,supplierMap);if(key==="partyId")return String(record?.partyType)==="Customer"?named(value,customerMap):String(record?.partyType)==="Supplier"?named(value,supplierMap):String(value||"");if(key==="projectId")return named(value,projectMap);if(key==="cashBankAccountId"||key==="expenseAccountId")return named(value,accountMap);return display(key,value);};

  const canEdit=Boolean(record)&&rowStatus==="DRAFT"&&!String(record.journalId||"").trim()&&!isCreditNote;
  const realPo=Boolean(record)&&type==="purchaseOrder"&&!isSupplierQuotation;
  const realApprovedPo=realPo&&APPROVED_PO_LIFECYCLE.has(rowStatus);
  const supplierName=record?String(supplierMap.get(String(record.supplierId||""))||record.supplierId||""):"";
  const projectName=record?String(projectMap.get(String(record.projectId||""))||record.projectId||""):"";
  const supplierBillPoId=record&&type==="supplierBill"?String(record.poId||record.sourceDocumentId||""):"";
  const paymentPoId=record&&type==="payment"&&String(record.partyType||"")==="Supplier"?(sourceMarkerFromPayment(record,"PO")||String(record.sourceDocumentId||"")):"";
  const salesInvoiceOutstanding=record?n(record.outstandingAmount??record.totalAmount??0):0;
  const salesInvoiceSettlementReady=Boolean(record)&&type==="invoice"&&!isCreditNote&&["POSTED","PARTLY_PAID"].includes(rowStatus)&&salesInvoiceOutstanding>0.001;
  const salesInvoicePaid=Boolean(record)&&type==="invoice"&&!isCreditNote&&rowStatus==="PAID";
  const paymentFinalizationReady=Boolean(record)&&type==="payment"&&(rowStatus==="APPROVED"||Boolean(String(record.journalId||"").trim()));

  return <div className="document-page">
    <div className="document-toolbar no-print">
      <Link prefetch={false} href={backHref}>← Back to {backLabel}</Link>
      <div className="row-actions">
        {error && (
          <details className="system-notice-tab">
            <summary>
              <span>ℹ️ System Notice</span>
              <span className="notice-arrow">▾</span>
            </summary>
            <div className="system-notice-dropdown">
              <strong>Document unavailable:</strong> {error}
            </div>
          </details>
        )}
        {canEdit && (
          <Link prefetch={false} className="button-link" href={type === "invoice" ? `/transactions/invoice/${encodeURIComponent(id)}/edit` : `/transactions/${encodeURIComponent(type)}/${encodeURIComponent(id)}/edit`}>
            Edit Draft
          </Link>
        )}
        <button
          type="button"
          disabled={deleteBusy}
          className="danger-button"
          style={{
            color: "#dc2626",
            borderColor: "#fca5a5",
            background: "#fef2f2",
            cursor: deleteBusy ? "not-allowed" : "pointer"
          }}
          onClick={() => void handleDeleteDocument()}
        >
          {deleteBusy ? "Deleting…" : "Delete"}
        </button>
        <PrintButton />
      </div>
    </div>
    <section className="document-sheet">
      <header className="document-header"><div><div className="eyebrow">EASYNET IT SOLUTIONS LIMITED</div><h1>{title}</h1><div className="document-number">{number}</div></div><div className={`status-pill status-${String(loading?"loading":publicStatus).toLowerCase()}`}>{loading?"LOADING":publicStatus}</div></header>
      {loading?<section className="panel"><strong>Loading live document values…</strong></section>:record?<>
        {previous&&<div className="document-meta" style={{marginBottom:20}}><div><span>{previous.label}</span><strong><Link prefetch={false} href={href(previous.type,previous.id)}>{previous.number}</Link></strong></div></div>}
        <div className="document-meta">{fields.map(([key,value])=><div key={key}><span>{labels[key]||key.replace(/([A-Z])/g," $1")}</span><strong>{key==="journalId"?<Link prefetch={false} href={`/journals/${encodeURIComponent(String(value))}`}>{String(value)}</Link>:fieldDisplay(key,value)}</strong></div>)}</div>
        {lines.length>0&&<div className="document-lines"><table className="data-table"><thead><tr><th>#</th><th>Item Code</th><th>Item Name</th><th>UOM</th><th>Moving Avg Cost</th><th>Qty</th><th>Rate</th><th>Net</th><th>GST</th><th>Total</th></tr></thead><tbody>{lines.map((line:any,index:number)=>{const itemId=String(line.itemId||"");const item=itemId?itemMap.get(itemId):null;const itemCode=String(item?.itemCode||item?.itemId||itemId||"");const itemName=String(item?.itemName||line.description||"");const originalTemp=String(line.description||"");const uom=String(line.uom||item?.uom||"Each");const movingAverage=item?`K${n(item.defaultRate).toFixed(2)}`:"—";const lineKey=line.invoiceLineId||line.quoteLineId||line.poLineId||line.billLineId||index;return <tr key={lineKey}><td>{line.lineNo||index+1}</td><td>{item?<Link prefetch={false} href={`/stock/item/${encodeURIComponent(item.itemId||item.itemCode)}`}><strong>{itemCode}</strong></Link>:isSupplierQuotation?<span className="small">TEMP</span>:<span>{itemCode||"UNLINKED"}</span>}</td><td>{item?<><Link prefetch={false} href={`/stock/item/${encodeURIComponent(item.itemId||item.itemCode)}`}>{itemName}</Link>{isSupplierQuotation&&originalTemp&&originalTemp!==itemName?<><br/><span className="small">Original TEMP: {originalTemp}</span></>:null}</>:itemName}</td><td>{uom}</td><td>{movingAverage}</td><td>{line.qty}</td><td>K{n(line.rate).toFixed(2)}</td><td>K{n(line.netAmount).toFixed(2)}</td><td>K{n(line.gstAmount).toFixed(2)}</td><td><strong>K{n(line.totalAmount).toFixed(2)}</strong></td></tr>;})}</tbody></table></div>}
        {lines.length>0&&(()=>{
          const lineNetTotal = lines.reduce((sum: number, l: any) => sum + n(l.netAmount || (n(l.qty) * n(l.rate))), 0);
          const lineGstTotal = lines.reduce((sum: number, l: any) => sum + n(l.gstAmount), 0);
          const lineGrandTotal = lines.reduce((sum: number, l: any) => sum + n(l.totalAmount || (n(l.netAmount) + n(l.gstAmount))), 0);
          const docNet = n(record.netAmount ?? record.subtotal ?? lineNetTotal);
          const docGst = n(record.gstAmount ?? record.taxTotal ?? lineGstTotal);
          const docTotal = n(record.totalAmount ?? record.total ?? lineGrandTotal);
          return (
            <div style={{ display: "flex", justifyContent: "flex-end", margin: "18px 0 24px" }}>
              <div style={{ width: "min(380px, 100%)", border: "1px solid #cbd5e1", borderRadius: 8, background: "#f8fafc", padding: "14px 18px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", color: "#475569", fontSize: "0.95rem" }}>
                  <span>Net Total</span>
                  <strong>K{docNet.toFixed(2)}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", color: "#475569", fontSize: "0.95rem" }}>
                  <span>GST</span>
                  <strong>K{docGst.toFixed(2)}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 4px", borderTop: "2px solid #cbd5e1", marginTop: 6, fontSize: "1.15rem", color: "#0f172a" }}>
                  <strong>Total</strong>
                  <strong style={{ color: "#0f172a" }}>K{docTotal.toFixed(2)}</strong>
                </div>
              </div>
            </div>
          );
        })()}
        <div className="document-footer"><span>System generated document</span><span>Record ID: {id}</span></div>
      </>:null}
    </section>

    {record&&<>
      <DocumentWorkflowActions recordType={type as "quote"|"invoice"|"purchaseOrder"|"supplierBill"|"payment"|"expense"} recordId={id} status={rowStatus}/>
      {type==="quote"&&QUOTE_ACTION_LIFECYCLE.has(rowStatus)&&<LazyDocumentSection title="Sales Quotation Fulfilment" description="Stock readiness, linked invoices, backorders, procurement and customer advances are loaded only when you request them." buttonLabel={rowStatus==="APPROVED"?"Check Fulfilment / Convert to Sales Invoice":"Open Sales Fulfilment Actions"}><SalesQuoteCycle quoteId={id}/></LazyDocumentSection>}
      {salesInvoiceSettlementReady&&<section className="conversion-box no-print" style={{marginTop:16}}><div className="form-title-row"><div><strong>Sales Invoice Settlement</strong><p className="small">Invoice is approved and accounting-posted. Create or receive the customer payment when needed.</p></div><span className="auto-badge">APPROVED</span></div><div className="button-row" style={{marginTop:12}}><Link prefetch={false} className="button-link" href={`/transactions?module=sales&tab=salesPayment&mode=create&sourceInvoice=${encodeURIComponent(id)}`}>Create / Receive Customer Payment</Link></div></section>}
      {salesInvoicePaid&&<div className="status-banner no-print" style={{marginTop:16}}>Sales Invoice is fully paid.</div>}
      {type==="invoice"&&<LazyDocumentSection title={isCreditNote?"Credit Note / Refund Actions":"More Sales Invoice Actions"} description={isCreditNote?"Refundable credit controls are loaded only when requested.":"Customer advances and sales return controls are loaded only when requested."} buttonLabel={isCreditNote?"Open Refund / Credit Actions":"Open Advance / Return Actions"}><SalesInvoiceCycle invoiceId={id} record={record}/></LazyDocumentSection>}
      {isSupplierQuotation&&["APPROVED","CONVERTED"].includes(rowStatus)&&<LazyDocumentSection title="Supplier Quotation Conversion" description="Item readiness and linked Purchase Order data are loaded only when needed." buttonLabel="Prepare Items / Convert to Purchase Order"><SupplierQuoteItemReadiness supplierQuoteId={id}/></LazyDocumentSection>}
      {realPo&&<LazyDocumentSection title="Purchase Order Follow-up" description="Linked advances, receipts, partial-close controls and downstream document data are loaded only when requested." buttonLabel="Open PO Follow-up Actions">{String(record.supplierId||"")&&<SupplierAdvanceChainSummary context="po" poId={id} supplierId={String(record.supplierId||"")} poTotal={n(record.totalAmount)}/>} {realApprovedPo&&<SupplierAdvanceFromPo poId={id} poNumber={number} supplierId={String(record.supplierId||"")} supplierName={supplierName} projectId={String(record.projectId||"")} projectName={projectName} totalAmount={n(record.totalAmount)}/>} <PoPartialSupplyClose poId={id} poNumber={number}/><DocumentConversionActions type={type} id={id} status={rowStatus} documentNumber={number}/></LazyDocumentSection>}
      {type==="supplierBill"&&<LazyDocumentSection title="Supplier Invoice Settlement" description="Advance chain, allocations and downstream payment data are loaded on demand." buttonLabel="Open Supplier Invoice Settlement Actions">{supplierBillPoId&&<SupplierAdvanceChainSummary context="invoice" poId={supplierBillPoId} supplierId={String(record.supplierId||"")} billId={id} billNumber={number} billTotal={n(record.totalAmount)} billOutstanding={n(record.outstandingAmount??record.totalAmount??0)}/>} {supplierBillPoId&&<SupplierInvoiceAdvanceAdjustment billId={id} billNumber={number} poId={supplierBillPoId} supplierId={String(record.supplierId||"")} outstandingAmount={n(record.outstandingAmount??record.totalAmount??0)} status={rowStatus}/>} <DocumentConversionActions type={type} id={id} status={rowStatus} documentNumber={number}/></LazyDocumentSection>}
      {paymentFinalizationReady&&<PaymentFinalSave record={record}/>} 
      {type==="payment"&&Boolean(String(record.journalId||"").trim())&&<LazyDocumentSection title="Payment / Receipt Follow-up" description="Linked advance history and downstream references are loaded only when requested." buttonLabel="Open Payment / Receipt Follow-up">{paymentPoId&&<SupplierAdvanceChainSummary context="payment" poId={paymentPoId} supplierId={String(record.partyId||"")} paymentId={id}/>} <DocumentConversionActions type={type} id={id} status={rowStatus} documentNumber={number}/></LazyDocumentSection>}
      {type==="expense"&&<DocumentConversionActions type={type} id={id} status={rowStatus} documentNumber={number}/>} 
    </>}
  </div>;
}
