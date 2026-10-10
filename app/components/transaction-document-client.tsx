"use client";

import Link from "next/link";
import LinkedDocumentReference from "@/app/components/linked-document-reference";
import { useCallback, useEffect, useMemo, useState } from "react";
import PrintButton from "@/app/components/print-button";
import DocumentConversionActions from "@/app/components/document-conversion-actions";
import DocumentWorkflowActions from "@/app/components/document-workflow-actions";
import PaymentFinalSave from "@/app/components/payment-final-save";
import SupplierQuoteItemReadiness from "@/app/components/supplier-quote-item-readiness";
import SupplierAdvanceFromPo from "@/app/components/supplier-advance-from-po";
import SupplierInvoiceAdvanceAdjustment from "@/app/components/supplier-invoice-advance-adjustment";
import SupplierAdvanceChainSummary from "@/app/components/supplier-advance-chain-summary";
import SupplierPaymentSettlementSummary from "@/app/components/supplier-payment-settlement-summary";
import CustomerAdvanceChainSummary from "@/app/components/customer-advance-chain-summary";
import CustomerReceiptSettlementSummary from "@/app/components/customer-receipt-settlement-summary";
import CustomerInvoiceAdvancePlan from "@/app/components/customer-invoice-advance-plan";
import PoPartialSupplyClose from "@/app/components/po-partial-supply-close";
import SalesQuoteCycle from "@/app/components/sales-quote-cycle";
import SalesOrderCycle from "@/app/components/sales-order-cycle";
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
const labels:Record<string,string>={customerId:"Customer",supplierId:"Supplier",partyId:"Customer / Supplier",projectId:"Project",quoteDate:"Date",invoiceDate:"Date",poDate:"Date",billDate:"Date",paymentDate:"Date",expenseDate:"Date",dueDate:"Due Date",expiryDate:"Valid Till",currency:"Currency",exchangeRate:"Exchange Rate",baseNetAmount:"Base Net Amount",baseGstAmount:"Base GST",baseTotalAmount:"Base Total",basePaidAmount:"Base Paid / Settled",baseOutstandingAmount:"Base Outstanding",baseAmount:"Base Amount",netAmount:"Net Amount",gstAmount:"GST",totalAmount:"Total",paidAmount:"Paid / Settled",outstandingAmount:"Outstanding",plannedAdvanceAmount:"Supplier Advance Planned",projectedOutstandingAmount:"Projected Outstanding After Approval",customerAdvancePlanned:"Customer Advance Planned",customerProjectedOutstanding:"Projected Outstanding After Approval",status:"Status",reference:"Reference",paymentMethod:"Payment Method",description:"Description",journalId:"Journal",cashBankAccountId:"Cash / Bank Account",expenseAccountId:"Expense Account",allocatedAmount:"Allocated",unallocatedAmount:"Available Advance Balance",allocationCount:"Allocation Entries"};
const moneyFields=new Set(["netAmount","gstAmount","totalAmount","paidAmount","outstandingAmount","plannedAdvanceAmount","projectedOutstandingAmount","customerAdvancePlanned","customerProjectedOutstanding","amount","allocatedAmount","unallocatedAmount"]);
const baseMoneyFields=new Set(["baseNetAmount","baseGstAmount","baseTotalAmount","basePaidAmount","baseOutstandingAmount","baseAmount"]);
const VALID_MODULES=new Set(["sales","purchase","expense"]);
const VALID_TABS=new Set(["salesQuote","salesOrder","deliveryNote","salesInvoice","salesPayment","supplierQuote","purchaseOrder","purchaseReceipt","supplierInvoice","purchasePayment","expense"]);
const VALID_MODES=new Set(["menu","create","list"]);
const SECTION_LABELS:Record<string,string>={salesQuote:"Sales Quotation",salesOrder:"Sales Order",deliveryNote:"Delivery Note / Stock Out",salesInvoice:"Sales Invoice",salesPayment:"Sales Payment Entry / Receipt",supplierQuote:"Supplier Quotation",purchaseOrder:"Purchase Order",purchaseReceipt:"Purchase Receipt / GRN",supplierInvoice:"Supplier Invoice",purchasePayment:"Purchase Payment Entry / Receipt",expense:"Expense"};
const APPROVED_PO_LIFECYCLE=new Set(["APPROVED","PART_RECEIVED","RECEIVED","PART_BILLED","CONVERTED","BILL_CREATED","BILLED","CLOSED_PARTIAL"]);
const QUOTE_ACTION_LIFECYCLE=new Set(["APPROVED","PART_INVOICED","CONVERTED","CLOSED_PARTIAL"]);

const n=(value:unknown)=>{const parsed=Number(value??0);return Number.isFinite(parsed)?parsed:0;};
function display(key:string,value:unknown){if(moneyFields.has(key))return `K${n(value).toFixed(2)}`;return String(value??"");}
function href(type:string,id:string){return `/transactions/${type==="supplierQuote"?"purchaseOrder":type}/${encodeURIComponent(id)}`;}
type RefLink={label:string;type:string;id:string;number:string};
type ReturnContext={returnModule?:string;returnTab?:string;returnMode?:string};

function named(id:unknown,map:Map<string,string>){const key=String(id||"").trim();if(!key)return"—";return map.get(key)||key;}
function refId(value: unknown) {
  return String(value || "").trim();
}
function displayWithCode(name: unknown, code: unknown, fallback: unknown) {
  const label = refId(name) || refId(fallback);
  const displayCode = refId(code) || refId(fallback);
  return label && displayCode && label !== displayCode ? `${label} (${displayCode})` : label || displayCode;
}
function masterHref(type: "customer" | "supplier" | "project", id: unknown) {
  const key = refId(id);
  if (!key) return "";
  if (type === "customer") return `/customers/${encodeURIComponent(key)}`;
  if (type === "supplier") return `/suppliers/${encodeURIComponent(key)}`;
  return `/projects/master/${encodeURIComponent(key)}`;
}
function sourceMarkerFromPayment(record:any,prefix:"PO"|"SQ"){const match=String(record.reference||"").match(new RegExp(`^${prefix}:([^|]+)\\|`));return match?.[1]||"";}
function previousLink(type:string,record:any):RefLink|null{
  if(type==="invoice"&&record.sourceDocumentId){const id=String(record.sourceDocumentId);const credit=String(record.invoiceNumber||"").toUpperCase().startsWith("CN-");const salesOrder=id.toUpperCase().startsWith("SO-");return credit?{label:"Original Sales Invoice",type:"invoice",id,number:id}:{label:salesOrder?"Source Sales Order":"Source Sales Quotation",type:"quote",id,number:id};}
  if(type==="supplierBill"&&record.sourceDocumentId){const id=String(record.sourceDocumentId);return{label:"Source Purchase Order",type:"purchaseOrder",id,number:id};}
  if(type==="purchaseOrder"&&record.sourceDocumentId){const id=String(record.sourceDocumentId);return{label:"Source Supplier Quotation",type:"supplierQuote",id,number:id};}
  if(type==="payment"&&record.againstDocumentId){const id=String(record.againstDocumentId);const against=String(record.againstDocumentType||"").toLowerCase();if(against.includes("sales invoice")||against.includes("sales credit note")||String(record.partyType||"")==="Customer")return{label:"Against Sales Document",type:"invoice",id,number:id};if(against.includes("supplier bill")||against.includes("supplier invoice"))return{label:"Against Supplier Invoice",type:"supplierBill",id,number:id};return{label:"Previous Document",type:"purchaseOrder",id,number:id};}
  if(type==="payment"){const sourceId=String(record.sourceDocumentId||"").trim();if(String(record.partyType||"")==="Supplier"){const poId=sourceMarkerFromPayment(record,"PO")||sourceId;if(poId)return{label:"Advance Against Purchase Order",type:"purchaseOrder",id:poId,number:poId};}if(String(record.partyType||"")==="Customer"){const quoteId=sourceMarkerFromPayment(record,"SQ")||sourceId;if(quoteId)return{label:"Advance Against Sales Quotation",type:"quote",id:quoteId,number:quoteId};}}
  return null;
}
function inferredSection(type:string,number:string,record:any){if(type==="quote")return{module:"sales",tab:number.toUpperCase().startsWith("SO-")?"salesOrder":"salesQuote"};if(type==="invoice")return{module:"sales",tab:"salesInvoice"};if(type==="purchaseOrder"&&number.startsWith("SUPQ-"))return{module:"purchase",tab:"supplierQuote"};if(type==="purchaseOrder")return{module:"purchase",tab:"purchaseOrder"};if(type==="supplierBill")return{module:"purchase",tab:"supplierInvoice"};if(type==="payment"&&String(record.partyType||"")==="Customer")return{module:"sales",tab:"salesPayment"};if(type==="payment")return{module:"purchase",tab:"purchasePayment"};if(type==="expense")return{module:"expense",tab:"expense"};return{module:"sales",tab:"salesQuote"};}

export default function TransactionDocumentClient({type,id}:{type:string;id:string}){
  const config=CONFIG[type];
  const invalidDocumentId=!id||["undefined","null","nan"].includes(String(id).trim().toLowerCase());
  const[record,setRecord]=useState<any|null>(null);
  const[lines,setLines]=useState<any[]>([]);
  const[references,setReferences]=useState<any>({customers:[],suppliers:[],projects:[],accounts:[],items:[]});
  const[documentLinks,setDocumentLinks]=useState<any[]>([]);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState("");
  const[returnContext,setReturnContext]=useState<ReturnContext>({});
  const[deleteBusy,setDeleteBusy]=useState(false);
  const[supplierQuoteItemsOpen,setSupplierQuoteItemsOpen]=useState(false);
  const[salesQuoteFulfilmentOpen,setSalesQuoteFulfilmentOpen]=useState(false);
  const[salesOrderActionsOpen,setSalesOrderActionsOpen]=useState(false);
  const[salesInvoiceSettlementOpen,setSalesInvoiceSettlementOpen]=useState(false);
  const[salesQuoteReadiness,setSalesQuoteReadiness]=useState<any|null>(null);
  const[salesQuoteConvertBusy,setSalesQuoteConvertBusy]=useState(false);
  const[supplierQuoteReadiness,setSupplierQuoteReadiness]=useState<any|null>(null);
  const[supplierQuoteConvertBusy,setSupplierQuoteConvertBusy]=useState(false);
  const[poAdvanceOpen,setPoAdvanceOpen]=useState(false);
  const[poReceiptOpen,setPoReceiptOpen]=useState(false);
  const[supplierBillSettlementOpen,setSupplierBillSettlementOpen]=useState(false);
  const[supplierBillPlanSummary,setSupplierBillPlanSummary]=useState<{plannedTotal:number;projectedOutstanding:number}|null>(null);
  const[salesInvoicePlanSummary,setSalesInvoicePlanSummary]=useState<{plannedTotal:number;projectedOutstanding:number}|null>(null);

  const loadDocument = useCallback(async (signal?: AbortSignal, showLoading = false) => {
    if (showLoading) setLoading(true);
    setError("");
    const response = await fetch(`/api/erp/transaction-document?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`,{cache:"no-store",signal});
    const body = await response.json();
    if(!response.ok||!body.ok)throw new Error(body.error||"Document load failed");
    setRecord(body.record||null);
    setLines(body.lines||[]);
    setReferences(body.references||{});
    setDocumentLinks(Array.isArray(body.documentLinks)?body.documentLinks:[]);
    setLoading(false);
  }, [type, id]);

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
    const handleDocumentUpdated=()=>{void loadDocument(undefined,false);};
    window.addEventListener("easynet:transaction-document-updated",handleDocumentUpdated);
    return()=>window.removeEventListener("easynet:transaction-document-updated",handleDocumentUpdated);
  },[loadDocument]);

  useEffect(()=>{
    if(type!=="supplierBill"){setSupplierBillPlanSummary(null);return;}
    let active=true;
    void(async()=>{
      try{
        const response=await fetch(`/api/erp/supplier-invoice-advance-plan?billId=${encodeURIComponent(id)}`,{cache:"no-store"});
        const body=await response.json();
        if(active&&response.ok&&body.ok)setSupplierBillPlanSummary({plannedTotal:Number(body.plannedTotal||0),projectedOutstanding:Number(body.projectedOutstanding||0)});
      }catch{}
    })();
    return()=>{active=false;};
  },[type,id,record?.status,record?.outstandingAmount]);

  useEffect(()=>{
    if(type!=="invoice"||isCreditNote){setSalesInvoicePlanSummary(null);return;}
    let active=true;
    void(async()=>{
      try{
        const response=await fetch(`/api/erp/sales-invoice-advance-plan?invoiceId=${encodeURIComponent(id)}`,{cache:"no-store"});
        const body=await response.json();
        if(active&&response.ok&&body.ok)setSalesInvoicePlanSummary({plannedTotal:Number(body.plannedTotal||0),projectedOutstanding:Number(body.projectedOutstanding||0)});
      }catch{}
    })();
    return()=>{active=false;};
  },[type,id,record?.invoiceNumber,record?.status,record?.outstandingAmount]);

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    setReturnContext({returnModule:params.get("returnModule")||undefined,returnTab:params.get("returnTab")||undefined,returnMode:params.get("returnMode")||undefined});
    const controller=new AbortController();
    const frame=window.requestAnimationFrame(()=>{void(async()=>{
      try{await loadDocument(controller.signal);}
      catch(err){if(!controller.signal.aborted){setError(err instanceof Error?err.message:"Document load failed");setLoading(false);}}
    })();});
    return()=>{controller.abort();window.cancelAnimationFrame(frame);};
  },[type,id,loadDocument]);

  const customerMap=useMemo(()=>{const map=new Map<string,string>();for(const row of references.customers||[]){const label=displayWithCode(row.customerName||row.name,row.customerId||row.customerCode,row.customerId||row.id);for(const key of [row.customerId,row.internalCustomerId,row.customerCode,row.id].map(refId).filter(Boolean))map.set(key,label);}return map;},[references.customers]);
  const supplierMap=useMemo(()=>{const map=new Map<string,string>();for(const row of references.suppliers||[]){const label=displayWithCode(row.supplierName||row.name,row.supplierId||row.supplierCode,row.supplierId||row.id);for(const key of [row.supplierId,row.internalSupplierId,row.supplierCode,row.id].map(refId).filter(Boolean))map.set(key,label);}return map;},[references.suppliers]);
  const projectMap=useMemo(()=>{const map=new Map<string,string>();for(const row of references.projects||[]){const label=displayWithCode(row.projectName||row.name,row.projectId||row.projectCode,row.projectId||row.id);for(const key of [row.projectId,row.internalProjectId,row.projectCode,row.id].map(refId).filter(Boolean))map.set(key,label);}return map;},[references.projects]);
  const accountMap=useMemo(()=>new Map<string, string>((references.accounts||[]).map((row:any)=>[String(row.accountId||""),`${String(row.accountName||row.accountId||"")} · ${String(row.accountCode||"")}`])),[references.accounts]);
  const itemMap=useMemo(()=>new Map<string, any>((references.items||[]).map((item:any)=>[String(item.itemId||item.itemCode||""),item])),[references.items]);

  const number=record?String(record[config?.numberField||""]||id):id;
  const transactionCurrency=String(record?.currency||references.baseCurrency||"PGK").toUpperCase();
  const baseCurrency=String(references.baseCurrency||"PGK").toUpperCase();
  const transactionMoney=(value:unknown)=>`${transactionCurrency} ${n(value).toFixed(2)}`;
  const baseMoney=(value:unknown)=>`${baseCurrency} ${n(value).toFixed(2)}`;
  const isSalesOrder=type==="quote"&&number.toUpperCase().startsWith("SO-");
  const isSupplierQuotation=type==="purchaseOrder"&&number.startsWith("SUPQ-");
  const isCreditNote=type==="invoice"&&number.toUpperCase().startsWith("CN-");
  const rowStatus=String(record?.status||"DRAFT").toUpperCase();
  const publicStatus=type==="invoice"&&!isCreditNote&&["POSTED","PARTLY_PAID","PARTIAL"].includes(rowStatus)?"APPROVED":rowStatus;

  const loadSupplierQuoteReadiness=useCallback(async()=>{
    if(!isSupplierQuotation)return;
    try{
      const response=await fetch(`/api/erp/supplier-quote-readiness?supplierQuoteId=${encodeURIComponent(id)}`,{cache:"no-store"});
      const body=await response.json();
      if(response.ok&&body.ok)setSupplierQuoteReadiness(body.readiness||null);
    }catch{}
  },[isSupplierQuotation,id]);

  useEffect(()=>{if(isSupplierQuotation&&["APPROVED","CONVERTED"].includes(rowStatus))void loadSupplierQuoteReadiness();},[isSupplierQuotation,rowStatus,loadSupplierQuoteReadiness]);

  useEffect(()=>{
    if(type!=="quote"||isSalesOrder){setSalesQuoteReadiness(null);return;}
    let active=true;
    void(async()=>{
      try{
        const response=await fetch(`/api/erp/sales-quote-readiness?quoteId=${encodeURIComponent(id)}`,{cache:"no-store"});
        const body=await response.json();
        if(active&&response.ok&&body.ok)setSalesQuoteReadiness(body.readiness||null);
      }catch{}
    })();
    return()=>{active=false;};
  },[type,id,isSalesOrder,rowStatus]);

  async function handleCreateSalesOrder(){
    if(salesQuoteConvertBusy)return;
    setSalesQuoteConvertBusy(true);
    try{
      const response=await fetch("/api/erp/sales-order-conversion",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({quoteId:id,orderDate:new Intl.DateTimeFormat("en-CA",{timeZone:"Pacific/Port_Moresby"}).format(new Date())}),
      });
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Sales Quotation conversion failed");
      window.location.assign(`/transactions/quote/${encodeURIComponent(body.createdId)}?returnModule=sales&returnTab=salesOrder&returnMode=list`);
    }catch(error){
      window.alert(error instanceof Error?error.message:"Sales Quotation conversion failed");
    }finally{
      setSalesQuoteConvertBusy(false);
    }
  }

  async function handleCreatePurchaseOrder(){
    if(supplierQuoteConvertBusy)return;
    setSupplierQuoteConvertBusy(true);
    try{
      const response=await fetch("/api/erp/purchase-conversions",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({supplierQuoteId:id}),
      });
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Supplier Quotation conversion failed");
      window.location.assign(`/transactions/purchaseOrder/${encodeURIComponent(body.createdId)}?returnModule=purchase&returnTab=purchaseOrder&returnMode=list`);
    }catch(error){
      window.alert(error instanceof Error?error.message:"Supplier Quotation conversion failed");
    }finally{
      setSupplierQuoteConvertBusy(false);
    }
  }
  let title=config?.title||"Transaction Document";
  if(isSalesOrder)title="Sales Order";
  if(isSupplierQuotation)title="Supplier Quotation";
  if(isCreditNote)title="Sales Credit Note / Return";
  if(type==="payment"&&record){if(String(record.partyType)==="Customer")title=String(record.paymentType||"").toUpperCase()==="PAY"?"Customer Refund Payment":"Sales Payment Entry / Receipt";else if(String(record.partyType)==="Supplier")title="Purchase Payment Entry / Receipt";}

  const inferred=record?inferredSection(type,number,record):{module:"sales",tab:"salesQuote"};
  const backModule=returnContext.returnModule&&VALID_MODULES.has(returnContext.returnModule)?returnContext.returnModule:inferred.module;
  const backTab=returnContext.returnTab&&VALID_TABS.has(returnContext.returnTab)?returnContext.returnTab:inferred.tab;
  const backMode=returnContext.returnMode&&VALID_MODES.has(returnContext.returnMode)?returnContext.returnMode:"menu";
  const backHref=`/transactions?module=${encodeURIComponent(backModule)}&tab=${encodeURIComponent(backTab)}&mode=${encodeURIComponent(backMode)}`;
  const backLabel=SECTION_LABELS[backTab]||"Transactions";
  const paymentSourceBack=record&&type==="payment"&&String(record.sourceDocumentId||"").trim()
    ? String(record.partyType||"")==="Supplier"
      ? {href:`/transactions/purchaseOrder/${encodeURIComponent(String(record.sourceDocumentId))}`,label:"Purchase Order"}
      : {href:`/transactions/quote/${encodeURIComponent(String(record.sourceDocumentId))}`,label:"Sales Quotation"}
    : null;

  if(!config)return <section className="panel warning-panel"><strong>Unsupported transaction document type.</strong></section>;
  if(invalidDocumentId)return <section className="panel warning-panel"><strong>Invalid document link.</strong><p className="small">The created document ID was not supplied to this page. Return to the transaction list and open the saved record.</p><Link prefetch={false} href="/transactions">Back to Transactions</Link></section>;

  const previous=record?previousLink(type,record):null;
  const hidden=new Set([
    type==="quote"?"quoteId":type==="invoice"?"invoiceId":type==="purchaseOrder"?"poId":type==="supplierBill"?"billId":type==="payment"?"paymentId":"expenseId",
    config.numberField,
    "createdAt",
    "updatedAt",
    "sourceDocumentId",
    "againstDocumentId",
    "againstDocumentType",
    "internalCustomerId",
    "customerName",
    "customerCode",
    "internalSupplierId",
    "supplierName",
    "supplierCode",
    "internalProjectId",
    "projectName",
    "projectCode",
  ]);
  const compactHeaderHidden=new Set([
    "status",
    "currency",
    "netAmount",
    "gstAmount",
    "totalAmount",
    "baseNetAmount",
    "baseGstAmount",
    "baseTotalAmount",
  ]);
  const paymentPrimaryKeys=new Set(["partyId","projectId","paymentDate","amount","paymentMethod","cashBankAccountId","reference","journalId"]);
  const paymentAdvancedKeys=new Set(["currency","exchangeRate","baseAmount","allocationCount","allocatedAmount","baseAllocatedAmount","unallocatedAmount"]);
  const rawFields=record?Object.entries(record).filter(([key,value])=>!hidden.has(key)&&!compactHeaderHidden.has(key)&&value!==""&&value!==null&&value!==undefined):[];
  const fields=type==="payment"
    ? rawFields.filter(([key,value])=>{
        if(!paymentPrimaryKeys.has(key))return false;
        if(key==="journalId"&&!String(value||"").trim())return false;
        return true;
      })
    : [...rawFields];
  if(type==="supplierBill"&&String(record?.status||"").toUpperCase()==="DRAFT"&&Number(supplierBillPlanSummary?.plannedTotal||0)>0){
    fields.push(["plannedAdvanceAmount",supplierBillPlanSummary?.plannedTotal||0]);
    fields.push(["projectedOutstandingAmount",supplierBillPlanSummary?.projectedOutstanding||0]);
  }
  if(type==="invoice"&&!isCreditNote&&String(record?.status||"").toUpperCase()==="DRAFT"&&Number(salesInvoicePlanSummary?.plannedTotal||0)>0){
    fields.push(["customerAdvancePlanned",salesInvoicePlanSummary?.plannedTotal||0]);
    fields.push(["customerProjectedOutstanding",salesInvoicePlanSummary?.projectedOutstanding||0]);
  }
  const paymentAdvancedFields=type==="payment"
    ? rawFields.filter(([key,value])=>{
        if(!paymentAdvancedKeys.has(key))return false;
        if(key==="exchangeRate"&&transactionCurrency===baseCurrency)return false;
        if(key==="baseAmount"&&transactionCurrency===baseCurrency)return false;
        if((key==="allocationCount"||key==="allocatedAmount"||key==="baseAllocatedAmount")&&n(value)<=0)return false;
        if(key==="unallocatedAmount"&&n(value)<=0)return false;
        return true;
      })
    : [];
  const linkedValue=(hrefValue:string,label:string)=>hrefValue?<Link prefetch={false} href={hrefValue}>{label}</Link>:label;
  const fieldDisplay=(key:string,value:unknown)=>{
    if(key==="status"&&type==="invoice"&&!isCreditNote)return publicStatus;
    if(key==="customerId")return linkedValue(masterHref("customer",value),named(value,customerMap));
    if(key==="supplierId")return linkedValue(masterHref("supplier",value),named(value,supplierMap));
    if(key==="partyId"){
      if(String(record?.partyType)==="Customer")return linkedValue(masterHref("customer",value),named(value,customerMap));
      if(String(record?.partyType)==="Supplier")return linkedValue(masterHref("supplier",value),named(value,supplierMap));
      return String(value||"");
    }
    if(key==="projectId")return linkedValue(masterHref("project",value),named(value,projectMap));
    if(key==="cashBankAccountId"||key==="expenseAccountId")return named(value,accountMap);
    if(key==="journalId"){
      const journalId=String(value||"").trim();
      return <LinkedDocumentReference kind="journal" id={journalId} />;
    }
    if(key==="reference"&&type==="payment"){
      const text=String(value||"");
      return text.replace(/^(SQ|PO):[^|]+\|/,"")||"—";
    }
    if(key==="exchangeRate"){
      if(transactionCurrency===baseCurrency)return "1.00";
      const rate=n(value).toFixed(6).replace(/0+$/,"").replace(/\.$/,"");
      return `1 ${transactionCurrency} = ${rate} ${baseCurrency}`;
    }
    if(moneyFields.has(key))return transactionMoney(value);
    if(baseMoneyFields.has(key))return baseMoney(value);
    return display(key,value);
  };

  const canEdit=Boolean(record)&&rowStatus==="DRAFT"&&!String(record.journalId||"").trim()&&!isCreditNote;
  const realPo=Boolean(record)&&type==="purchaseOrder"&&!isSupplierQuotation;
  const realApprovedPo=realPo&&APPROVED_PO_LIFECYCLE.has(rowStatus);
  const supplierName=record?String(supplierMap.get(String(record.supplierId||""))||record.supplierId||""):"";
  const projectName=record?String(projectMap.get(String(record.projectId||""))||record.projectId||""):"";
  const supplierBillPoId=record&&type==="supplierBill"?String(record.poId||record.sourceDocumentId||""):"";
  const paymentPoId=record&&type==="payment"&&String(record.partyType||"")==="Supplier"?(sourceMarkerFromPayment(record,"PO")||String(record.sourceDocumentId||"")):"";
  const paymentSupplierBillRef=record&&type==="payment"&&String(record.partyType||"")==="Supplier"?String(record.againstDocumentId||"").trim():"";
  const paymentQuoteId=record&&type==="payment"&&String(record.partyType||"")==="Customer"?(sourceMarkerFromPayment(record,"SQ")||String(record.sourceDocumentId||"")):"";
  const paymentSalesInvoiceRef=record&&type==="payment"&&String(record.partyType||"")==="Customer"?String(record.againstDocumentId||"").trim():"";
  const salesOrderSourceQuoteId=record&&isSalesOrder?String(record.sourceDocumentId||""):"";
  const salesInvoiceSourceQuoteId=record&&type==="invoice"&&!isCreditNote?String(record.sourceQuoteId||""):"";
  const salesInvoicePaid=Boolean(record)&&type==="invoice"&&!isCreditNote&&rowStatus==="PAID";
  const paymentFinalizationReady=Boolean(record)&&type==="payment"&&(rowStatus==="APPROVED"||Boolean(String(record.journalId||"").trim()));
  const orderedDocumentLinks=[...documentLinks].sort((a:any,b:any)=>Number(a.stage||0)-Number(b.stage||0)||String(a.number||"").localeCompare(String(b.number||"")));
  const salesFlow=type==="quote"||type==="invoice"||(type==="payment"&&String(record?.partyType||"")==="Customer");
  const currentStage=
    type==="quote"?(isSalesOrder?20:10):
    type==="invoice"?(isCreditNote?45:40):
    type==="purchaseOrder"?(isSupplierQuotation?10:20):
    type==="supplierBill"?40:
    type==="payment"?(String(record?.againstDocumentId||"").trim()?50:(salesFlow?15:25)):
    0;
  const flowStages=salesFlow
    ? [
        {stage:10,label:"Sales Quotation"},
        {stage:15,label:"Customer Advance"},
        {stage:20,label:"Sales Order"},
        {stage:30,label:"Delivery Note"},
        {stage:40,label:"Sales Invoice"},
        {stage:45,label:"Credit Note"},
        {stage:50,label:"Final Receipt"},
      ]
    : [
        {stage:10,label:"Supplier Quotation"},
        {stage:20,label:"Purchase Order"},
        {stage:25,label:"Supplier Advance"},
        {stage:30,label:"Purchase Receipt / GRN"},
        {stage:40,label:"Supplier Invoice"},
        {stage:50,label:"Final Payment"},
      ];
  const linksByStage=new Map<number,any[]>();
  for(const link of orderedDocumentLinks){
    const stage=Number(link.stage||0);
    const list=linksByStage.get(stage)||[];
    list.push(link);
    linksByStage.set(stage,list);
  }
  const explorerHref=`/document-explorer?documentId=${encodeURIComponent(number)}`;
  const showLegacyPrevious=Boolean(previous)&&documentLinks.length===0;

  return <div className="document-page">
    <div className="document-toolbar no-print">
      <div className="document-toolbar-back">
        {paymentSourceBack
          ? <Link prefetch={false} href={paymentSourceBack.href}>← Back to {paymentSourceBack.label}</Link>
          : <Link prefetch={false} href={backHref}>← Back to {backLabel}</Link>}
        {paymentSourceBack&&<Link prefetch={false} className="document-toolbar-secondary-back" href={backHref}>Back to {backLabel} list</Link>}
      </div>
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
        {record && rowStatus === "DRAFT" && (
          <DocumentWorkflowActions
            recordType={type as "quote"|"invoice"|"purchaseOrder"|"supplierBill"|"payment"|"expense"}
            recordId={id}
            status={rowStatus}
            onApproved={() => loadDocument(undefined, true)}
            placement="toolbar"
          />
        )}
        {canEdit && (
          <Link prefetch={false} className="button-link" href={type === "invoice" ? `/transactions/invoice/${encodeURIComponent(id)}/edit` : `/transactions/${encodeURIComponent(type)}/${encodeURIComponent(id)}/edit`}>
            Edit Draft
          </Link>
        )}
        {isSupplierQuotation && ["APPROVED","CONVERTED"].includes(rowStatus) && !supplierQuoteReadiness?.existingPo && (
          supplierQuoteReadiness?.allItemsPermanent ? (
            <button
              type="button"
              disabled={supplierQuoteConvertBusy}
              onClick={() => void handleCreatePurchaseOrder()}
              title="Create Purchase Order from this approved Supplier Quotation"
            >
              {supplierQuoteConvertBusy ? "Creating Purchase Order…" : "Create Purchase Order"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSupplierQuoteItemsOpen(true)}
              title="Review and save temporary Supplier Quotation items"
            >
              Save Temp Items
            </button>
          )
        )}
        {type === "quote" && !isSalesOrder && QUOTE_ACTION_LIFECYCLE.has(rowStatus) && !documentLinks.some((link:any)=>Number(link.stage||0)===20) && (
          <>
            {salesQuoteReadiness?.temporaryLines?.length ? (
              <button
                type="button"
                onClick={() => setSalesQuoteFulfilmentOpen(true)}
                title="Save temporary Sales Quotation items to Item Master"
              >
                Save Temp Items
              </button>
            ) : (
              <button
                type="button"
                disabled={salesQuoteConvertBusy}
                onClick={() => void handleCreateSalesOrder()}
                title="Create Sales Order from this Sales Quotation"
              >
                {salesQuoteConvertBusy ? "Creating Sales Order…" : "Create Sales Order"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSalesQuoteFulfilmentOpen(true)}
              title="Create or review Customer Advance Receipt"
            >
              Customer Advance
            </button>
          </>
        )}
        {isSalesOrder && ["APPROVED","PART_DELIVERED","DELIVERED","PART_INVOICED","INVOICED"].includes(rowStatus) && (
          <button
            type="button"
            onClick={() => setSalesOrderActionsOpen(true)}
            title="Create or open Delivery Note / Stock Out"
          >
            Delivery Note
          </button>
        )}
        {type === "invoice" && !isCreditNote && (
          <button
            type="button"
            onClick={() => setSalesInvoiceSettlementOpen(true)}
            title="Open Customer Advance, receipt and Sales Invoice settlement actions"
          >
            Invoice Settlement
          </button>
        )}
        {realApprovedPo && (
          <>
            <button
              type="button"
              onClick={() => setPoAdvanceOpen(true)}
              title="Create or review Supplier Advance Payment against this Purchase Order"
            >
              Advance Payment
            </button>
            <button
              type="button"
              onClick={() => setPoReceiptOpen(true)}
              title="Create or complete Purchase Receipt / GRN"
            >
              GRN
            </button>
          </>
        )}
        {type === "supplierBill" && (
          <button
            type="button"
            onClick={() => setSupplierBillSettlementOpen(true)}
            title="Open Supplier Invoice settlement actions"
          >
            Invoice Settlement
          </button>
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
      <header className="document-header">
        <div className="document-header-main">
          <div className="eyebrow">EASYNET IT SOLUTIONS LIMITED</div>
          <h1>{title}</h1>
          <div className="document-header-subline">
            <span className="document-number">{number}</span>
            <span className="document-type-note">Finance document</span>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          {record&&String(record.journalId||"").trim()&&(
            <Link
              prefetch={false}
              className="button-link secondary-link no-print"
              href={`/journals/${encodeURIComponent(String(record.journalId))}`}
              title="Open corresponding Journal Entry"
            >
              Journal Entry · {String(record.journalId)}
            </Link>
          )}
          <div className={`status-pill status-${String(loading?"loading":publicStatus).toLowerCase()}`}>{loading?"LOADING":publicStatus}</div>
        </div>
      </header>
      {loading?<section className="panel"><strong>Loading live document values…</strong></section>:record?<>
        {type!=="expense"&&<section className="document-flow-tabs no-print">
          <div className="document-flow-tabs-head">
            <div><span className="document-section-kicker">Workflow</span><strong>Document Flow</strong></div>
            <Link prefetch={false} className="document-flow-explorer-link" href={explorerHref}>View Full Relationship</Link>
          </div>
          <div className="document-flow-tab-row">
            {flowStages.map((stageDef,index)=>{
              const stageLinks=linksByStage.get(stageDef.stage)||[];
              const isCurrent=stageDef.stage===currentStage;
              return <div className="document-flow-stage-wrap" key={stageDef.stage}>
                <div className={`document-flow-tab ${isCurrent?"current":stageLinks.length?"linked":"empty"}`}>
                  <span className="document-flow-tab-label">{stageDef.label}</span>
                  <div className="document-flow-tab-links">
                    {isCurrent&&<span className="document-flow-current-number">{number}</span>}
                    {stageLinks.map((link:any,linkIndex:number)=><Link prefetch={false} key={`${link.type}-${link.id}-${linkIndex}`} href={String(link.href||"#")}>{link.number||link.id}</Link>)}
                    {!isCurrent&&stageLinks.length===0&&<span className="document-flow-placeholder">—</span>}
                  </div>
                </div>
                {index<flowStages.length-1&&<span className="document-flow-mini-arrow">→</span>}
              </div>;
            })}
          </div>
        </section>}
        {(showLegacyPrevious||fields.length>0)&&<div className="document-section-heading"><div><span className="document-section-kicker">Overview</span><h2>Document details</h2></div></div>}
        {showLegacyPrevious&&previous&&<div className="document-source-link"><span>{previous.label}</span><strong><Link prefetch={false} href={href(previous.type,previous.id)}>{previous.number}</Link></strong></div>}
        {fields.length>0&&<div className="document-meta">{fields.map(([key,value])=><div key={key}><span>{labels[key]||key.replace(/([A-Z])/g," $1")}</span><strong>{key==="journalId"?<Link prefetch={false} href={`/journals/${encodeURIComponent(String(value))}`}>{String(value)}</Link>:fieldDisplay(key,value)}</strong></div>)}</div>}
        {type==="payment"&&paymentAdvancedFields.length>0&&<details className="payment-advanced-details no-print">
          <summary>Advanced Accounting Details</summary>
          <div className="document-meta payment-advanced-grid">
            {paymentAdvancedFields.map(([key,value])=><div key={key}><span>{labels[key]||key.replace(/([A-Z])/g," $1")}</span><strong>{fieldDisplay(key,value)}</strong></div>)}
          </div>
        </details>}
        {lines.length>0&&<><div className="document-section-heading document-lines-heading"><div><span className="document-section-kicker">Items</span><h2>Line items</h2></div><span className="document-section-count">{lines.length} line{lines.length===1?"":"s"}</span></div><div className="document-lines"><table className="data-table"><thead><tr><th>#</th><th>Item Code</th><th>Item Name</th><th>UOM</th><th>Moving Avg Cost</th><th>Qty</th><th>Rate</th><th>Net</th><th>GST</th><th>Total</th></tr></thead><tbody>{lines.map((line:any,index:number)=>{const itemId=String(line.itemId||"");const item=itemId?itemMap.get(itemId):null;const itemCode=String(item?.itemCode||item?.itemId||itemId||"");const itemName=String(item?.itemName||line.description||"");const originalTemp=String(line.description||"");const uom=String(line.uom||item?.uom||"Each");const movingAverage=item?`${baseCurrency} ${n(item.defaultRate).toFixed(2)}`:"—";const lineKey=line.invoiceLineId||line.quoteLineId||line.poLineId||line.billLineId||index;return <tr key={lineKey}><td>{line.lineNo||index+1}</td><td>{item?<Link prefetch={false} href={`/stock/item/${encodeURIComponent(item.itemId||item.itemCode)}`}><strong>{itemCode}</strong></Link>:isSupplierQuotation?<span className="small">TEMP</span>:<span>{itemCode||"UNLINKED"}</span>}</td><td>{item?<><Link prefetch={false} href={`/stock/item/${encodeURIComponent(item.itemId||item.itemCode)}`}>{itemName}</Link>{isSupplierQuotation&&originalTemp&&originalTemp!==itemName?<><br/><span className="small">Original TEMP: {originalTemp}</span></>:null}</>:itemName}</td><td>{uom}</td><td>{movingAverage}</td><td>{line.qty}</td><td>{transactionMoney(line.rate)}</td><td>{transactionMoney(line.netAmount)}</td><td>{transactionMoney(line.gstAmount)}</td><td><strong>{transactionMoney(line.totalAmount)}</strong></td></tr>;})}</tbody></table></div></>}
        {lines.length>0&&(()=>{
          const lineNetTotal = lines.reduce((sum: number, l: any) => sum + n(l.netAmount || (n(l.qty) * n(l.rate))), 0);
          const lineGstTotal = lines.reduce((sum: number, l: any) => sum + n(l.gstAmount), 0);
          const lineGrandTotal = lines.reduce((sum: number, l: any) => sum + n(l.totalAmount || (n(l.netAmount) + n(l.gstAmount))), 0);
          const docNet = n(record.netAmount ?? record.subtotal ?? lineNetTotal);
          const docGst = n(record.gstAmount ?? record.taxTotal ?? lineGstTotal);
          const docTotal = n(record.totalAmount ?? record.total ?? lineGrandTotal);
          return (
            <div className="document-totals-wrap">
              <div className="document-totals-card">
                <div className="document-total-row">
                  <span>Net Total</span>
                  <strong>{transactionMoney(docNet)}</strong>
                </div>
                <div className="document-total-row">
                  <span>GST</span>
                  <strong>{transactionMoney(docGst)}</strong>
                </div>
                <div className="document-total-row document-total-grand">
                  <span>Total</span>
                  <strong>{transactionMoney(docTotal)}</strong>
                </div>
                {transactionCurrency !== baseCurrency && n(record.baseTotalAmount) > 0 && (
                  <div className="document-total-row document-total-base">
                    <span>Base Total</span>
                    <strong>{baseMoney(record.baseTotalAmount)}</strong>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
        <div className="document-footer"><span>System generated document</span><span>Document No: {number}{id!==number?` · Internal Record ID: ${id}`:""}</span></div>
      </>:null}
    </section>

    {record&&<>
      {isSalesOrder&&salesOrderSourceQuoteId&&String(record.customerId||"")&&<CustomerAdvanceChainSummary context="order" sourceQuoteId={salesOrderSourceQuoteId} customerId={String(record.customerId||"")} quoteTotal={n(record.totalAmount)}/>}
      {realPo&&String(record.supplierId||"")&&<SupplierAdvanceChainSummary context="po" poId={id} supplierId={String(record.supplierId||"")} poTotal={n(record.totalAmount)}/>}
      {salesInvoicePaid&&<div className="status-banner no-print" style={{marginTop:16}}>Sales Invoice is fully paid.</div>}
      {type==="invoice"&&isCreditNote&&<LazyDocumentSection title="Credit Note / Refund Actions" description="Refundable credit controls are loaded only when requested." buttonLabel="Open Refund / Credit Actions"><SalesInvoiceCycle invoiceId={id} record={record}/></LazyDocumentSection>}
      {paymentFinalizationReady&&<PaymentFinalSave record={record}/>} 
      {type==="payment"&&Boolean(String(record.journalId||"").trim())&&(
        <>
          {paymentSupplierBillRef
            ? <SupplierPaymentSettlementSummary billRef={paymentSupplierBillRef} supplierId={String(record.partyId||"")}/>
            : paymentPoId
              ? <SupplierAdvanceChainSummary context="payment" poId={paymentPoId} supplierId={String(record.partyId||"")} paymentId={id}/>
              : null}
          {paymentSalesInvoiceRef
            ? <CustomerReceiptSettlementSummary invoiceRef={paymentSalesInvoiceRef} customerId={String(record.partyId||"")}/>
            : paymentQuoteId
              ? <CustomerAdvanceChainSummary context="payment" sourceQuoteId={paymentQuoteId} customerId={String(record.partyId||"")} paymentId={id}/>
              : null}
          <DocumentConversionActions type={type} id={id} status={rowStatus} documentNumber={number}/>
        </>
      )}
      {type==="expense"&&<DocumentConversionActions type={type} id={id} status={rowStatus} documentNumber={number}/>} 
    </>}

    {supplierQuoteItemsOpen && isSupplierQuotation && (
      <div
        className="no-print"
        role="dialog"
        aria-modal="true"
        aria-label="Save Temp Items"
        onClick={() => setSupplierQuoteItemsOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1000,
          background: "rgba(15, 23, 42, 0.48)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "5vh 24px",
          overflowY: "auto",
        }}
      >
        <div
          onClick={(event) => event.stopPropagation()}
          style={{
            width: "min(1500px, 96vw)",
            maxHeight: "90vh",
            overflowY: "auto",
            background: "var(--surface, #ffffff)",
            border: "1px solid var(--border, #dbe4f0)",
            borderRadius: 16,
            boxShadow: "0 24px 80px rgba(15, 23, 42, 0.25)",
            padding: 18,
          }}
        >
          <div className="form-title-row" style={{ marginBottom: 12 }}>
            <div>
              <strong>Save Temp Items</strong>
              <p className="small">Review temporary Supplier Quotation lines and save them to Item Master before Purchase Order creation.</p>
            </div>
            <button type="button" className="secondary" onClick={() => setSupplierQuoteItemsOpen(false)}>Close</button>
          </div>
          <SupplierQuoteItemReadiness supplierQuoteId={id} onReadinessChange={(next)=>{setSupplierQuoteReadiness(next);if(next.allItemsPermanent&&!next.existingPo)setSupplierQuoteItemsOpen(false);}}/>
        </div>
      </div>
    )}

    {salesQuoteFulfilmentOpen && type === "quote" && !isSalesOrder && (
      <div
        className="no-print"
        role="dialog"
        aria-modal="true"
        aria-label="Sales Fulfilment"
        onClick={() => setSalesQuoteFulfilmentOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1000,
          background: "rgba(15, 23, 42, 0.48)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "5vh 24px",
          overflowY: "auto",
        }}
      >
        <div
          onClick={(event) => event.stopPropagation()}
          style={{
            width: "min(1500px, 96vw)",
            maxHeight: "90vh",
            overflowY: "auto",
            background: "var(--surface, #ffffff)",
            border: "1px solid var(--border, #dbe4f0)",
            borderRadius: 16,
            boxShadow: "0 24px 80px rgba(15, 23, 42, 0.25)",
            padding: 18,
          }}
        >
          <div className="form-title-row" style={{ marginBottom: 12 }}>
            <div>
              <strong>Sales Fulfilment</strong>
              <p className="small">Review temporary items, stock readiness, customer advances and Sales Order conversion.</p>
            </div>
            <button type="button" className="secondary" onClick={() => setSalesQuoteFulfilmentOpen(false)}>Close</button>
          </div>
          <SalesQuoteCycle quoteId={id} onReadinessChange={setSalesQuoteReadiness}/>
        </div>
      </div>
    )}

    {poAdvanceOpen && realApprovedPo && record && (
      <div
        className="no-print"
        role="dialog"
        aria-modal="true"
        aria-label="Supplier Advance Payment"
        onClick={() => setPoAdvanceOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1000,
          background: "rgba(15, 23, 42, 0.48)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "5vh 24px",
          overflowY: "auto",
        }}
      >
        <div
          onClick={(event) => event.stopPropagation()}
          style={{
            width: "min(1200px, 94vw)",
            maxHeight: "90vh",
            overflowY: "auto",
            background: "var(--surface, #ffffff)",
            border: "1px solid var(--border, #dbe4f0)",
            borderRadius: 16,
            boxShadow: "0 24px 80px rgba(15, 23, 42, 0.25)",
            padding: 18,
          }}
        >
          <div className="form-title-row" style={{ marginBottom: 12 }}>
            <div>
              <strong>Supplier Advance Payment</strong>
              <p className="small">Create or review advance payments linked to this Purchase Order.</p>
            </div>
            <button type="button" className="secondary" onClick={() => setPoAdvanceOpen(false)}>Close</button>
          </div>
          <SupplierAdvanceFromPo poId={id} poNumber={number} supplierId={String(record.supplierId||"")} supplierName={supplierName} projectId={String(record.projectId||"")} projectName={projectName} totalAmount={n(record.totalAmount)}/>
        </div>
      </div>
    )}

    {poReceiptOpen && realApprovedPo && (
      <div
        className="no-print"
        role="dialog"
        aria-modal="true"
        aria-label="Purchase Receipt / GRN"
        onClick={() => setPoReceiptOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1000,
          background: "rgba(15, 23, 42, 0.48)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "5vh 24px",
          overflowY: "auto",
        }}
      >
        <div
          onClick={(event) => event.stopPropagation()}
          style={{
            width: "min(1200px, 94vw)",
            maxHeight: "90vh",
            overflowY: "auto",
            background: "var(--surface, #ffffff)",
            border: "1px solid var(--border, #dbe4f0)",
            borderRadius: 16,
            boxShadow: "0 24px 80px rgba(15, 23, 42, 0.25)",
            padding: 18,
          }}
        >
          <div className="form-title-row" style={{ marginBottom: 12 }}>
            <div>
              <strong>Purchase Receipt / GRN</strong>
              <p className="small">Create or complete the Purchase Receipt / GRN and review remaining supply controls.</p>
            </div>
            <button type="button" className="secondary" onClick={() => setPoReceiptOpen(false)}>Close</button>
          </div>
          <PoPartialSupplyClose poId={id} poNumber={number}/>
          <DocumentConversionActions type={type} id={id} status={rowStatus} documentNumber={number}/>
        </div>
      </div>
    )}

    {salesOrderActionsOpen && isSalesOrder && record && (
      <div
        className="no-print"
        role="dialog"
        aria-modal="true"
        aria-label="Sales Order Fulfilment"
        onClick={() => setSalesOrderActionsOpen(false)}
        style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(15, 23, 42, 0.48)",display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"5vh 24px",overflowY:"auto"}}
      >
        <div onClick={(event)=>event.stopPropagation()} style={{width:"min(1300px,95vw)",maxHeight:"90vh",overflowY:"auto",background:"var(--surface, #ffffff)",border:"1px solid var(--border, #dbe4f0)",borderRadius:16,boxShadow:"0 24px 80px rgba(15, 23, 42, 0.25)",padding:18}}>
          <div className="form-title-row" style={{marginBottom:12}}>
            <div><strong>Sales Order Fulfilment</strong><p className="small">Create or review Delivery Note / Stock Out and downstream Sales Invoice links.</p></div>
            <button type="button" className="secondary" onClick={()=>setSalesOrderActionsOpen(false)}>Close</button>
          </div>
          <SalesOrderCycle orderId={id}/>
        </div>
      </div>
    )}

    {salesInvoiceSettlementOpen && type === "invoice" && !isCreditNote && record && (
      <div
        className="no-print"
        role="dialog"
        aria-modal="true"
        aria-label="Sales Invoice Settlement"
        onClick={() => setSalesInvoiceSettlementOpen(false)}
        style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(15, 23, 42, 0.48)",display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"5vh 24px",overflowY:"auto"}}
      >
        <div onClick={(event)=>event.stopPropagation()} style={{width:"min(1450px,96vw)",maxHeight:"90vh",overflowY:"auto",background:"var(--surface, #ffffff)",border:"1px solid var(--border, #dbe4f0)",borderRadius:16,boxShadow:"0 24px 80px rgba(15, 23, 42, 0.25)",padding:18}}>
          <div className="form-title-row" style={{marginBottom:12}}>
            <div><strong>Sales Invoice Settlement</strong><p className="small">Review Customer Advance, receipt, return and settlement actions.</p></div>
            <button type="button" className="secondary" onClick={()=>setSalesInvoiceSettlementOpen(false)}>Close</button>
          </div>
          {salesInvoiceSourceQuoteId&&String(record.customerId||"")&&<CustomerAdvanceChainSummary context="invoice" sourceQuoteId={salesInvoiceSourceQuoteId} customerId={String(record.customerId||"")} invoiceId={id} invoiceNumber={number} invoiceTotal={n(record.totalAmount)} invoiceOutstanding={n(record.outstandingAmount??record.totalAmount??0)}/>}
          <CustomerInvoiceAdvancePlan invoiceId={id} outstandingAmount={n(record.outstandingAmount??record.totalAmount??0)} status={rowStatus} onPlanChange={setSalesInvoicePlanSummary}/>
          <SalesInvoiceCycle invoiceId={id} record={record}/>
        </div>
      </div>
    )}

    {supplierBillSettlementOpen && type === "supplierBill" && record && (
      <div
        className="no-print"
        role="dialog"
        aria-modal="true"
        aria-label="Supplier Invoice Settlement"
        onClick={() => setSupplierBillSettlementOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1000,
          background: "rgba(15, 23, 42, 0.48)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "5vh 24px",
          overflowY: "auto",
        }}
      >
        <div
          onClick={(event) => event.stopPropagation()}
          style={{
            width: "min(1400px, 96vw)",
            maxHeight: "90vh",
            overflowY: "auto",
            background: "var(--surface, #ffffff)",
            border: "1px solid var(--border, #dbe4f0)",
            borderRadius: 16,
            boxShadow: "0 24px 80px rgba(15, 23, 42, 0.25)",
            padding: 18,
          }}
        >
          <div className="form-title-row" style={{ marginBottom: 12 }}>
            <div>
              <strong>Supplier Invoice Settlement</strong>
              <p className="small">Review supplier advances, allocations and downstream payment actions.</p>
            </div>
            <button type="button" className="secondary" onClick={() => setSupplierBillSettlementOpen(false)}>Close</button>
          </div>
          {supplierBillPoId&&<SupplierAdvanceChainSummary context="invoice" poId={supplierBillPoId} supplierId={String(record.supplierId||"")} billId={id} billNumber={number} billTotal={n(record.totalAmount)} billOutstanding={n(record.outstandingAmount??record.totalAmount??0)}/>}
          {supplierBillPoId&&<SupplierInvoiceAdvanceAdjustment billId={id} billNumber={number} poId={supplierBillPoId} supplierId={String(record.supplierId||"")} outstandingAmount={n(record.outstandingAmount??record.totalAmount??0)} status={rowStatus} onPlanChange={setSupplierBillPlanSummary}/>}
          <DocumentConversionActions type={type} id={id} status={rowStatus} documentNumber={number}/>
        </div>
      </div>
    )}
  </div>;
}
