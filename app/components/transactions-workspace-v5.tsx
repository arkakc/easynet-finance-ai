"use client";

import Link from "next/link";
import { FormEvent, InvalidEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import PurchasePaymentStaged from "@/app/components/purchase-payment-staged";
import SalesPaymentStaged from "@/app/components/sales-payment-staged";
import AdjustableDataTable, { type AdjustableColumn } from "@/app/components/adjustable-data-table";
import TransactionItemLines, { emptyTransactionLine, type TransactionDraftLine, type TransactionItemMaster } from "@/app/components/transaction-item-lines";
import { useFlowDataRefresh } from "@/app/components/flow-navigation";
import QuickMasterModal, { type MasterType, type CreatedMasterRow } from "@/app/components/quick-master-modal";
import styles from "@/app/transactions/transactions.module.css";
import AccountPicker from "@/app/components/account-picker";

type Module = "sales" | "purchase" | "expense";
type Tab = "salesQuote" | "salesOrder" | "deliveryNote" | "salesInvoice" | "salesPayment" | "supplierQuote" | "purchaseOrder" | "supplierInvoice" | "purchasePayment" | "expense";
type SectionMode = "menu" | "create" | "list";
type RecordType = "quote" | "invoice" | "purchaseOrder" | "supplierBill" | "payment" | "expense";
type Master = { customers:any[]; suppliers:any[]; projects:any[] };
type TxData = { quotes:any[]; salesOrders:any[]; deliveryNotes:any[]; supplierQuotes:any[]; purchaseOrders:any[]; invoices:any[]; supplierBills:any[]; payments:any[]; expenses:any[] };
type ReceiptState = { ordered:number; received:number; remaining:number; hasStock:boolean; hasRemaining:boolean; partial:boolean; fullyReceived:boolean };
type AccountOption = { accountId:string; accountCode:string; accountName:string; accountType:string; balance?:number };
type SectionMeta = { title:string; createLabel:string; listLabel:string; existingTitle:string };
type DoctypeListRow = {
  key:string;
  docId:string;
  docNumber:string;
  href:string;
  createdAtLabel:string;
  createdAtValue:number;
  partyProject:ReactNode;
  partyProjectText:string;
  amount:ReactNode;
  amountValue:number;
  status:ReactNode;
  statusText:string;
  action:ReactNode;
  rowClassName?:string;
};

const emptyMaster:Master={customers:[],suppliers:[],projects:[]};
const emptyTx:TxData={quotes:[],salesOrders:[],deliveryNotes:[],supplierQuotes:[],purchaseOrders:[],invoices:[],supplierBills:[],payments:[],expenses:[]};
const money=(value:unknown)=>`K${Number(value||0).toFixed(2)}`;
const moneyIn=(value:unknown,currency:string)=>`${String(currency||"PGK").toUpperCase()} ${Number(value||0).toFixed(2)}`;
const paymentEligible=(value:unknown)=>["POSTED","PARTLY_PAID"].includes(String(value||"").toUpperCase());
const poInvoiceEligible=(value:unknown)=>["APPROVED","PART_RECEIVED","RECEIVED","PART_BILLED","CONVERTED","BILL_CREATED","BILLED","CLOSED_PARTIAL"].includes(String(value||"").toUpperCase());
const APPROVAL_READY_STATUSES=new Set(["DRAFT","PENDING_APPROVAL","PENDING APPROVAL","PENDING FOR APPROVAL"]);
const QUOTE_CONVERSION_STATUSES=new Set(["APPROVED","PART INVOICED"]);
const SUPPLIER_QUOTE_CONVERSION_STATUSES=new Set(["APPROVED","SENT"]);

const SECTION_META:Record<Tab,SectionMeta>={
  salesQuote:{title:"Sales Quotation",createLabel:"Create New Sales Quotation",listLabel:"View Existing Quotations",existingTitle:"Existing Sales Quotations"},
  salesOrder:{title:"Sales Order",createLabel:"Create New Sales Order",listLabel:"View Existing Sales Orders",existingTitle:"Existing Sales Orders"},
  deliveryNote:{title:"Delivery Note / Stock Out",createLabel:"Create New Delivery Note",listLabel:"View Existing Delivery Notes",existingTitle:"Existing Delivery Notes"},
  salesInvoice:{title:"Sales Invoice",createLabel:"Create New Sales Invoice",listLabel:"View Existing Sales Invoices",existingTitle:"Existing Sales Invoices"},
  salesPayment:{title:"Sales Payment Entry / Receipt",createLabel:"Create New Sales Payment Entry / Receipt",listLabel:"View Existing Sales Payments / Receipts",existingTitle:"Existing Sales Payments / Receipts"},
  supplierQuote:{title:"Supplier Quotation",createLabel:"Create New Supplier Quotation",listLabel:"View Existing Supplier Quotations",existingTitle:"Existing Supplier Quotations"},
  purchaseOrder:{title:"Purchase Order",createLabel:"Create New Purchase Order",listLabel:"View Existing Purchase Orders",existingTitle:"Existing Purchase Orders"},
  supplierInvoice:{title:"Supplier Invoice",createLabel:"Create New Supplier Invoice",listLabel:"View Existing Supplier Invoices",existingTitle:"Existing Supplier Invoices"},
  purchasePayment:{title:"Purchase Payment Entry / Receipt",createLabel:"Create New Purchase Payment Entry / Receipt",listLabel:"View Existing Purchase Payments / Receipts",existingTitle:"Existing Purchase Payments / Receipts"},
  expense:{title:"Expense",createLabel:"Create New Expense",listLabel:"View Existing Expenses",existingTitle:"Existing Expenses"},
};
const numberMeta:Partial<Record<Tab,{label:string;action:string;partyType?:string}>>={
  salesQuote:{label:"Auto Quotation No",action:"createQuote"}, salesOrder:{label:"Auto Sales Order No",action:"createSalesOrder"}, salesInvoice:{label:"Auto Sales Invoice No",action:"createInvoice"}, supplierQuote:{label:"Auto Supplier Quotation No",action:"createSupplierQuote"}, purchaseOrder:{label:"Auto Purchase Order No",action:"createPurchaseOrder"},
};
const MODULE_TABS:Record<Module,Tab[]>={sales:["salesQuote","salesOrder","deliveryNote","salesInvoice","salesPayment"],purchase:["supplierQuote","purchaseOrder","supplierInvoice","purchasePayment"],expense:["expense"]};
function defaultTab(module:Module):Tab{return module==="purchase"?"supplierQuote":module==="expense"?"expense":"salesQuote";}
function localDate(plusDays=0){const date=new Date();date.setDate(date.getDate()+plusDays);const p=new Intl.DateTimeFormat("en-US",{timeZone:"Pacific/Port_Moresby",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);const v=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${v.year}-${v.month}-${v.day}`;}
function partyId(row:any){return String(row.customerId||row.supplierId||"");}
function partyName(row:any){return String(row.customerName||row.supplierName||partyId(row));}
function partyDisplay(row:any){const id=partyId(row),name=partyName(row);return id&&name!==id?`${name} (${id})`:name;}
function resolveParty(options:any[],input:string){const q=input.trim().toLowerCase();if(!q)return null;return options.find(r=>partyDisplay(r).toLowerCase()===q)||options.find(r=>partyId(r).toLowerCase()===q)||options.find(r=>partyName(r).toLowerCase()===q)||null;}
function createdValue(row:any){const value=row.createdAt||row.creation||row.created||row.updatedAt||row.deliveryDate||row.quoteDate||row.invoiceDate||row.poDate||row.billDate||row.paymentDate||row.expenseDate||"";const t=new Date(value).getTime();return Number.isFinite(t)?t:0;}
function createdLabel(row:any){const value=row.createdAt||row.creation||row.created||row.updatedAt||row.deliveryDate||"";if(!value)return"—";const d=new Date(value);if(!Number.isFinite(d.getTime()))return String(value);return new Intl.DateTimeFormat("en-PG",{timeZone:"Pacific/Port_Moresby",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(d);}
function newest<T>(rows:T[]){return[...rows].sort((a:any,b:any)=>createdValue(b)-createdValue(a));}
function normalizedStatus(value:unknown){return String(value||"DRAFT").trim().replace(/[_-]+/g," ").replace(/\s+/g," ").toUpperCase();}
function approvalReady(value:unknown){return APPROVAL_READY_STATUSES.has(normalizedStatus(value));}
function salesDocumentNumber(row:any){return String(row?.quoteNumber||row?.documentNumber||row?.code||row?.quoteId||"").trim();}
function isSalesOrderRecord(row:any){return salesDocumentNumber(row).toUpperCase().startsWith("SO-");}
function isSalesQuoteRecord(row:any){return !isSalesOrderRecord(row);}
function sameAmount(left:unknown,right:unknown){return Math.abs(Number(left||0)-Number(right||0))<0.01;}

export default function TransactionsWorkspaceV5(){
  const router=useRouter();
  const pathname=usePathname();
  const searchParams=useSearchParams();
  const searchParamsKey=searchParams.toString();
  const[initialized,setInitialized]=useState(false);const[module,setModule]=useState<Module>("sales");const[tab,setTab]=useState<Tab>("salesQuote");const[sectionMode,setSectionMode]=useState<SectionMode>("menu");
  const[masters,setMasters]=useState<Master>(emptyMaster);const[mastersLoaded,setMastersLoaded]=useState(false);const[items,setItems]=useState<TransactionItemMaster[]>([]);const[itemsLoaded,setItemsLoaded]=useState(false);const[tx,setTx]=useState<TxData>(emptyTx);const[existingLoaded,setExistingLoaded]=useState(false);const[existingLoading,setExistingLoading]=useState(false);
  const[receiptStates,setReceiptStates]=useState<Record<string,ReceiptState>>({});const[receiptStatesLoaded,setReceiptStatesLoaded]=useState(false);const[receiptStatesLoading,setReceiptStatesLoading]=useState(false);
  const[status,setStatus]=useState("");const[selectedParty,setSelectedParty]=useState("");const[partyInput,setPartyInput]=useState("");const[expenseSupplier,setExpenseSupplier]=useState("");const[expenseSupplierInput,setExpenseSupplierInput]=useState("");const[lines,setLines]=useState<TransactionDraftLine[]>([emptyTransactionLine()]);const[gstRate,setGstRate]=useState("10");const[nextDocumentNo,setNextDocumentNo]=useState("AUTO");const[saving,setSaving]=useState(false);const[approvalBusy,setApprovalBusy]=useState("");const[conversionBusy,setConversionBusy]=useState("");const[accountOptions,setAccountOptions]=useState<AccountOption[]>([]);
  const[quickModal,setQuickModal]=useState<MasterType|null>(null);const[selectedProjectId,setSelectedProjectId]=useState<string>("");const[invoiceAccountOverride,setInvoiceAccountOverride]=useState("");const[expenseAccountId,setExpenseAccountId]=useState("");const[cashBankAccountId,setCashBankAccountId]=useState("");const[baseCurrency,setBaseCurrency]=useState("PGK");const[documentCurrency,setDocumentCurrency]=useState("PGK");const[documentExchangeRate,setDocumentExchangeRate]=useState("");
  const[deleteBusy,setDeleteBusy]=useState<string>("");

  function syncUrl(nextModule:Module,nextTab:Tab,nextMode:SectionMode){const params=new URLSearchParams(searchParams.toString());params.set("module",nextModule);params.set("tab",nextTab);params.set("mode",nextMode);router.replace(`${pathname}?${params.toString()}`,{scroll:false});}

  const loadMasters=useCallback(async(force=false)=>{if(mastersLoaded&&!force)return;try{const response=await fetch("/api/masters",{cache:"no-store"});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Master-data load failed");setMasters({customers:body.customers||[],suppliers:body.suppliers||[],projects:body.projects||[]});setMastersLoaded(true);}catch(error){setStatus(error instanceof Error?error.message:"Master-data load failed");}},[mastersLoaded]);
  const loadItems=useCallback(async(force=false)=>{if(itemsLoaded&&!force)return;try{const response=await fetch("/api/stock?scope=items",{cache:"no-store"});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Item Master load failed");setItems(body.items||[]);setItemsLoaded(true);}catch(error){setStatus(error instanceof Error?error.message:"Item Master load failed");}},[itemsLoaded]);
  const loadAccountOptions=useCallback(async()=>{try{const response=await fetch("/api/erp/reference-options",{cache:"no-store"});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Account options load failed");setAccountOptions(Array.isArray(body.accounts)?body.accounts:[]);const base=String(body.baseCurrency||"PGK").toUpperCase();setBaseCurrency(base);setDocumentCurrency(current=>current==="PGK"?base:current);}catch(error){setStatus(error instanceof Error?error.message:"Account options load failed");}},[]);
  useFlowDataRefresh(()=>{void loadTransactions(true);void loadMasters(true);void loadItems(true);});

  async function handleMasterCreated(createdType:MasterType,record:CreatedMasterRow){
    await loadMasters(true);
    if(createdType==="customer"){
      const id=String(record.customerId||"");
      const name=String(record.customerName||id);
      const display=id&&name!==id?`${name} (${id})`:name;
      setPartyInput(display);
      setSelectedParty(id);
      setDocumentCurrency(String(record.currency||baseCurrency).toUpperCase());
      setDocumentExchangeRate("");
    }else if(createdType==="supplier"){
      const id=String(record.supplierId||"");
      const name=String(record.supplierName||id);
      const display=id&&name!==id?`${name} (${id})`:name;
      if(tab==="expense"){
        setExpenseSupplierInput(display);
        setExpenseSupplier(id);
      }else{
        setPartyInput(display);
        setSelectedParty(id);
        setDocumentCurrency(String(record.currency||baseCurrency).toUpperCase());
        setDocumentExchangeRate("");
      }
    }else if(createdType==="project"){
      const id=String(record.projectId||"");
      setSelectedProjectId(id);
    }
  }

  async function loadTransactions(force=false){if(existingLoaded&&!force)return tx;setExistingLoading(true);try{const response=await fetch("/api/erp/transactions",{cache:"no-store"});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Transaction load failed");const rawQuotes=[...(Array.isArray(body.quotes)?body.quotes:[]),...(Array.isArray(body.salesOrders)?body.salesOrders:[])];const quotes=rawQuotes.filter(isSalesQuoteRecord);const salesOrders=rawQuotes.filter(isSalesOrderRecord);const next={quotes,salesOrders,deliveryNotes:body.deliveryNotes||[],supplierQuotes:body.supplierQuotes||[],purchaseOrders:body.purchaseOrders||[],invoices:body.invoices||[],supplierBills:body.supplierBills||[],payments:body.payments||[],expenses:body.expenses||[]};setTx(next);setExistingLoaded(true);return next;}catch(error){setStatus(error instanceof Error?error.message:"Transaction load failed");return null;}finally{setExistingLoading(false);}}

  async function loadReceiptStates(force=false){if(receiptStatesLoaded&&!force)return receiptStates;setReceiptStatesLoading(true);try{const response=await fetch("/api/stock",{cache:"no-store"});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Purchase receipt status load failed");const itemMap=new Map<string,any>((body.items||[]).map((item:any)=>[String(item.itemId||item.itemCode||""),item]));const movements=Array.isArray(body.movements)?body.movements:[];const poLines=Array.isArray(body.poLines)?body.poLines:[];const result:Record<string,ReceiptState>={};for(const po of body.purchaseOrders||[]){const poId=String(po.poId||"");const orderedByItem=new Map<string,number>();for(const line of poLines.filter((r:any)=>String(r.poId||"")===poId)){const item=itemMap.get(String(line.itemId||""));if(String(item?.itemType||"").toUpperCase()!=="STOCK")continue;const itemId=String(line.itemId||"");orderedByItem.set(itemId,(orderedByItem.get(itemId)||0)+Number(line.qty||0));}let ordered=0,received=0;for(const[itemId,qty]of orderedByItem.entries()){ordered+=qty;received+=movements.filter((m:any)=>String(m.sourceDocumentId||"")===poId&&String(m.itemId||"")===itemId&&String(m.movementType||"")==="PURCHASE_RECEIPT").reduce((sum:number,m:any)=>sum+Number(m.qtyIn||0),0);}const hasStock=orderedByItem.size>0;const remaining=Math.max(0,ordered-received);result[poId]={ordered,received,remaining,hasStock,hasRemaining:hasStock&&remaining>0.0001,partial:received>0.0001&&remaining>0.0001,fullyReceived:hasStock&&ordered>0.0001&&remaining<=0.0001};}setReceiptStates(result);setReceiptStatesLoaded(true);return result;}catch(error){setStatus(error instanceof Error?error.message:"Purchase receipt status load failed");return{};}finally{setReceiptStatesLoading(false);}}

  async function loadNextDocumentNo(currentTab:Tab){const meta=numberMeta[currentTab];if(!meta){setNextDocumentNo("");return;}setNextDocumentNo("Loading…");try{const params=new URLSearchParams({nextNumberFor:meta.action});if(meta.partyType)params.set("partyType",meta.partyType);const response=await fetch(`/api/erp/transactions?${params}`,{cache:"no-store"});const body=await response.json();setNextDocumentNo(response.ok&&body.ok?body.nextNumber||"AUTO":"AUTO");}catch{setNextDocumentNo("AUTO");}}

  useEffect(()=>{const params=new URLSearchParams(searchParamsKey);const requestedModule=params.get("module");const resolvedModule:Module=requestedModule==="purchase"||requestedModule==="expense"?requestedModule:"sales";const requestedTab=params.get("tab") as Tab|null;const resolvedTab=requestedTab&&MODULE_TABS[resolvedModule].includes(requestedTab)?requestedTab:defaultTab(resolvedModule);const requestedMode=params.get("mode");const resolvedMode:SectionMode=requestedMode==="create"?requestedMode:"list";setModule(resolvedModule);setTab(resolvedTab);setSectionMode(resolvedMode);setInitialized(true);},[searchParamsKey]);
  useEffect(()=>{if(!initialized)return;if(sectionMode==="list"){void loadTransactions(true);if(!mastersLoaded)void loadMasters();if(tab==="purchaseOrder"&&!receiptStatesLoaded)void loadReceiptStates();}if(sectionMode==="create"){if(["salesQuote","salesOrder","salesInvoice","supplierQuote","purchaseOrder","supplierInvoice","expense"].includes(tab)&&!mastersLoaded)void loadMasters();if(["salesQuote","salesOrder","salesInvoice","supplierQuote","purchaseOrder"].includes(tab)&&!itemsLoaded)void loadItems();if(["supplierInvoice","deliveryNote"].includes(tab)&&!existingLoaded)void loadTransactions();if(tab==="expense"||tab==="salesInvoice")void loadAccountOptions();if(numberMeta[tab])void loadNextDocumentNo(tab);}},[initialized,sectionMode,tab]);

  const salesSide=module==="sales";const commercial=["salesQuote","salesOrder","salesInvoice","supplierQuote","purchaseOrder"].includes(tab);const supplierQuotation=tab==="supplierQuote";const partyOptions=salesSide?masters.customers:masters.suppliers;
  const projectOptions=useMemo(()=>{if(!salesSide||!selectedParty)return masters.projects;const linked=masters.projects.filter(project=>String(project.customerId||"")===selectedParty);return linked.length?linked:masters.projects;},[salesSide,selectedParty,masters.projects]);
  const subtotal=useMemo(()=>lines.reduce((sum,line)=>sum+(Number(line.qty)||0)*(Number(line.rate)||0),0),[lines]);const gstAmount=useMemo(()=>subtotal*((Number(gstRate)||0)/100),[subtotal,gstRate]);const netTotal=subtotal+gstAmount;
  const deliveryReadySalesOrders=useMemo(()=>tx.salesOrders.filter((row:any)=>["APPROVED","PART DELIVERED"].includes(normalizedStatus(row.status))),[tx.salesOrders]);
  const supplierInvoiceReadyPos=useMemo(()=>tx.purchaseOrders.filter((row:any)=>!String(row.poNumber||"").toUpperCase().startsWith("SUPQ-")&&poInvoiceEligible(row.status)),[tx.purchaseOrders]);
  const globallyBusy=saving||Boolean(approvalBusy)||Boolean(conversionBusy)||Boolean(deleteBusy);
  const expenseAccounts=useMemo(()=>accountOptions.filter(row=>["expense","cost of goods sold","cogs"].includes(String(row.accountType||"").toLowerCase())),[accountOptions]);
  const cashBankAccounts=useMemo(()=>accountOptions.filter((row:any)=>row.isCashBank===true||String(row.accountRole||"").toLowerCase()==="cash-bank"||["ACC-1110","ACC-1120","ACC-1121"].includes(String(row.accountId||""))),[accountOptions]);
  const accountLabel=(row:AccountOption)=>`${row.accountCode || row.accountId} — ${row.accountName || row.accountId}`;

  function customerLabel(id:unknown){const key=String(id||"");if(!key)return"—";const row=masters.customers.find(x=>String(x.customerId||"")===key);const name=String(row?.customerName||key);return name!==key?`${name} (${key})`:key;}
  function supplierLabel(id:unknown){const key=String(id||"");if(!key)return"—";const row=masters.suppliers.find(x=>String(x.supplierId||"")===key);const name=String(row?.supplierName||key);return name!==key?`${name} (${key})`:key;}
  function projectLabel(id:unknown){const key=String(id||"");if(!key)return"No project";const row=masters.projects.find(x=>String(x.projectId||"")===key);const name=String(row?.projectName||key);return name!==key?`${name} (${key})`:key;}
  function activeRows(rows:any[]){return rows.filter((row:any)=>!["CANCELLED","REVERSED"].includes(normalizedStatus(row.status)));}
  function linkedSalesOrdersForQuote(quote:any){
    const refs=new Set([quote?.quoteId,quote?.quoteNumber].map(value=>String(value||"")).filter(Boolean));
    const quoteCustomer=String(quote?.customerId||"");
    const quoteProject=String(quote?.projectId||"");
    const quoteTotal=Number(quote?.totalAmount||0);
    return activeRows(tx.salesOrders).filter((order:any)=>{
      const direct=[order.sourceDocumentId,order.sourceQuoteId,order.salesQuoteId,order.quoteId,order.quoteNumber].some(value=>refs.has(String(value||"")));
      if(direct)return true;
      const sameCustomer=quoteCustomer&&String(order.customerId||"")===quoteCustomer;
      const sameProject=String(order.projectId||"")===quoteProject;
      const sameTotal=Math.abs(Number(order.totalAmount||0)-quoteTotal)<0.01;
      return sameCustomer&&sameProject&&sameTotal;
    });
  }
  function linkedSalesInvoicesForQuote(quote:any){
    const salesOrder=String(quote?.quoteNumber||"").toUpperCase().startsWith("SO-");
    const refs=new Set([quote?.quoteId,quote?.quoteNumber].map(value=>String(value||"")).filter(Boolean));
    const quoteCustomer=String(quote?.customerId||"");
    const quoteProject=String(quote?.projectId||"");
    const quoteTotal=Number(quote?.totalAmount||0);
    return activeRows(tx.invoices).filter((invoice:any)=>{
      if(String(invoice.invoiceNumber||"").toUpperCase().startsWith("CN-"))return false;
      const direct=[invoice.quoteId,invoice.orderId,invoice.sourceDocumentId,invoice.sourceQuoteId,invoice.salesOrderId].some(value=>refs.has(String(value||"")));
      if(direct)return true;
      if(salesOrder)return false;
      return quoteCustomer&&String(invoice.customerId||"")===quoteCustomer&&String(invoice.projectId||"")===quoteProject&&sameAmount(invoice.totalAmount,quoteTotal);
    });
  }
  function salesInvoiceBlockedLabel(quote:any){const invoices=linkedSalesInvoicesForQuote(quote);if(!invoices.length)return"";const posted=invoices.find((invoice:any)=>["POSTED","PARTLY_PAID","PAID"].includes(normalizedStatus(invoice.status)));return posted?`Sales Invoice Posted: ${posted.invoiceNumber||posted.invoiceId}`:`Sales Invoice Draft: ${invoices[0].invoiceNumber||invoices[0].invoiceId}`;}
  function deliveryNotesForSalesOrder(order:any){const refs=new Set([order?.quoteId,order?.quoteNumber].map(value=>String(value||"")).filter(Boolean));return tx.deliveryNotes.filter((note:any)=>refs.has(String(note.sourceDocumentId||""))||refs.has(String(note.salesOrderId||"")));}
  function linkedPurchaseOrderForSupplierQuote(row:any){
    const refs=new Set([row?.poId,row?.poNumber,row?.sourceDocumentId].map(value=>String(value||"")).filter(Boolean));
    const supplierId=String(row?.supplierId||"");
    const projectId=String(row?.projectId||"");
    const totalAmount=Number(row?.totalAmount||0);
    return tx.purchaseOrders.find((po:any)=>{
      if(String(po.poNumber||"").toUpperCase().startsWith("SUPQ-"))return false;
      const direct=[po.sourceDocumentId,po.sourceSupplierQuoteId,po.supplierQuoteId,po.poId,po.poNumber].some(value=>refs.has(String(value||"")));
      if(direct)return true;
      return supplierId&&String(po.supplierId||"")===supplierId&&String(po.projectId||"")===projectId&&sameAmount(po.totalAmount,totalAmount);
    });
  }
  function linkedSupplierBillsForPo(po:any){
    const refs=new Set([po?.poId,po?.poNumber,po?.orderId,po?.sourceDocumentId].map(value=>String(value||"")).filter(Boolean));
    const supplierId=String(po?.supplierId||"");
    const projectId=String(po?.projectId||"");
    const totalAmount=Number(po?.totalAmount||0);
    return tx.supplierBills.filter((bill:any)=>{
      if(["CANCELLED","REVERSED"].includes(String(bill.status||"").toUpperCase()))return false;
      const direct=[bill.poId,bill.orderId,bill.sourceDocumentId,bill.sourcePurchaseOrderId].some(value=>refs.has(String(value||"")));
      if(direct)return true;
      return supplierId&&String(bill.supplierId||"")===supplierId&&String(bill.projectId||"")===projectId&&sameAmount(bill.totalAmount,totalAmount);
    });
  }
  function linkedPaymentsForDocument(row:any,partyType:"Customer"|"Supplier"){
    const refs=new Set([row?.invoiceId,row?.invoiceNumber,row?.billId,row?.billNumber,row?.paymentId,row?.paymentNumber].map(value=>String(value||"")).filter(Boolean));
    const partyId=String(partyType==="Customer"?row?.customerId||"":row?.supplierId||"");
    const projectId=String(row?.projectId||"");
    const targetAmount=Number(row?.outstandingAmount??row?.totalAmount??row?.amount??0);
    return activeRows(tx.payments).filter((payment:any)=>{
      if(String(payment.partyType||"")!==partyType)return false;
      const direct=[payment.againstDocumentId,payment.sourceDocumentId,payment.invoiceId,payment.billId].some(value=>refs.has(String(value||"")));
      if(direct)return true;
      const sameParty=partyId&&String(payment.partyId||"")===partyId;
      const sameProject=String(payment.projectId||"")===projectId;
      const amount=Number(payment.amount||0);
      return sameParty&&sameProject&&targetAmount>0&&amount>0&&amount<=targetAmount+0.01;
    });
  }
  function supplierInvoiceBlockedLabel(po:any){const bills=linkedSupplierBillsForPo(po);if(!bills.length)return"";const posted=bills.find((bill:any)=>["POSTED","PARTLY_PAID","PAID"].includes(String(bill.status||"").toUpperCase()));return posted?`Supplier Invoice Posted: ${posted.billNumber||posted.billId}`:`Supplier Invoice Draft: ${bills[0].billNumber||bills[0].billId}`;}
  function resetSectionState(){setStatus("");setSelectedParty("");setPartyInput("");setSelectedProjectId("");setExpenseSupplier("");setExpenseSupplierInput("");setInvoiceAccountOverride("");setExpenseAccountId("");setCashBankAccountId("");setDocumentCurrency(baseCurrency);setDocumentExchangeRate("");setLines([emptyTransactionLine()]);}
  function changeTab(value:Tab){if(globallyBusy)return;resetSectionState();setTab(value);setSectionMode("list");syncUrl(module,value,"list");}
  function openMode(mode:Exclude<SectionMode,"menu">){if(globallyBusy)return;resetSectionState();setSectionMode(mode);syncUrl(module,tab,mode);if(mode==="list")void loadTransactions(true);}
  function backToSection(){if(globallyBusy)return;resetSectionState();setSectionMode("list");syncUrl(module,tab,"list");void loadTransactions(true);}
  function returnQuery(mode:SectionMode){return`returnModule=${encodeURIComponent(module)}&returnTab=${encodeURIComponent(tab)}&returnMode=${encodeURIComponent(mode)}`;}
  function documentHref(type:string,id:string,mode:SectionMode="list"){return`/transactions/${type}/${encodeURIComponent(id)}?${returnQuery(mode)}`;}
  function handlePartyInput(value:string,options=partyOptions){setPartyInput(value);const match=resolveParty(options,value);setSelectedParty(match?partyId(match):"");if(match){setDocumentCurrency(String(match.currency||baseCurrency).toUpperCase());setDocumentExchangeRate("");}}
  function handleExpenseSupplierInput(value:string){setExpenseSupplierInput(value);const match=resolveParty(masters.suppliers,value);setExpenseSupplier(match?partyId(match):"");}
  function validateParty(options:any[],input:string,selected:string,label:string){if(selected)return selected;const match=resolveParty(options,input);if(!match)throw new Error(`Select a valid ${label} from the suggestions`);return partyId(match);}

  async function call(action:string,payload:unknown){const response=await fetch("/api/erp/transactions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,payload})});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Transaction failed");await loadTransactions(true);if(itemsLoaded&&body.result?.itemLinking?.created)await loadItems(true);if(numberMeta[tab])await loadNextDocumentNo(tab);return body.result;}
  async function approve(recordType:RecordType,recordId:string){if(globallyBusy)return;setApprovalBusy(recordId);setStatus("Approving…");try{const response=await fetch("/api/erp/actions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({target:"approvals",body:{payload:{recordType,recordId,decision:"APPROVE",note:"Transaction list"}}})});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Approval failed");setStatus(`Document approved. Final status: ${body.status||"APPROVED"}`);await loadTransactions(true);if(recordType==="purchaseOrder"){setReceiptStatesLoaded(false);await loadReceiptStates(true);}}catch(error){setStatus(error instanceof Error?error.message:"Approval failed");}finally{setApprovalBusy("");}}

  async function handleDeleteDocument(type:"quote"|"invoice"|"purchaseOrder"|"supplierBill"|"payment"|"expense",id:string,docNumber:string){
    if(globallyBusy)return;
    const confirmed=window.confirm(`Are you sure you want to delete ${docNumber||id}? This action cannot be undone.`);
    if(!confirmed)return;
    setDeleteBusy(id);
    setStatus(`Deleting ${docNumber||id}…`);
    try{
      const response=await fetch("/api/erp/transactions",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"deleteDocument",payload:{type,id}})
      });
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Delete failed");
      setStatus(`Successfully deleted ${docNumber||id}.`);
      await loadTransactions(true);
      if(type==="purchaseOrder"){
        setReceiptStatesLoaded(false);
        await loadReceiptStates(true);
      }
    }catch(error){
      const message=error instanceof Error?error.message:"Delete failed";
      setStatus(message);
      alert(`Cannot delete ${docNumber||id}:\n\n${message}`);
    }finally{
      setDeleteBusy("");
    }
  }

  function deleteAction(type:"quote"|"invoice"|"purchaseOrder"|"supplierBill"|"payment"|"expense",id:string,docNumber:string){
    const isBusy=deleteBusy===id;
    return <button
      type="button"
      className="danger-button"
      disabled={globallyBusy}
      style={{
        color:"#dc2626",
        borderColor:"#fca5a5",
        background:"#fef2f2",
        cursor:globallyBusy?"not-allowed":"pointer"
      }}
      onClick={()=>void handleDeleteDocument(type,id,docNumber)}
    >
      {isBusy?"Deleting…":"Delete"}
    </button>;
  }

  function editAction(recordType:RecordType,id:string,rowStatus:string){const normalized=normalizedStatus(rowStatus);if(normalized!=="DRAFT")return<button type="button" disabled>Edit Locked</button>;const href=recordType==="invoice"?`/transactions/invoice/${encodeURIComponent(id)}/edit`:`/transactions/${recordType}/${encodeURIComponent(id)}/edit`;return<Link prefetch={false} className="button-link" href={href}>Edit</Link>;}
  function approvalAction(recordType:RecordType,id:string,rowStatus:string){return approvalReady(rowStatus)?<button type="button" disabled={globallyBusy} onClick={()=>void approve(recordType,id)}>{approvalBusy===id?"Approving…":"Approve"}</button>:null;}
  function workflowActions(recordType:RecordType,id:string,rowStatus:string){const normalized=normalizedStatus(rowStatus);return<>{editAction(recordType,id,normalized)}{approvalAction(recordType,id,rowStatus)}{recordType==="supplierBill"&&paymentEligible(normalized)&&<a className="button-link" href={`/transactions?module=purchase&tab=purchasePayment&mode=create&sourceBill=${encodeURIComponent(id)}`}>Create Payment Entry</a>}</>;}

  function validateCommercialLines(){
    const valid=lines.filter(line=>String(line.itemName||line.description||line.itemInput||"").trim()&&Number(line.qty)>0&&Number(line.rate)>=0);
    if(!valid.length)throw new Error("Add at least one item line with Item, Qty and Unit Price before saving.");
    if(tab==="purchaseOrder"||tab==="salesOrder"||tab==="salesInvoice"){
      const missingMaster=valid.filter(line=>!String(line.itemId||"").trim());
      if(missingMaster.length)throw new Error(`${SECTION_META[tab].title} requires Item Master linked lines. Select an existing Item or create the Item Master first.`);
    }
    return valid;
  }
  function commercialSaveLabel(){
    if(saving)return"Saving...";
    if(tab==="supplierQuote")return"Save Supplier Quotation";
    if(tab==="purchaseOrder")return"Save Purchase Order";
    if(tab==="salesOrder")return"Save Sales Order";
    return"Save Draft";
  }
  function invalidCommercialField(event:InvalidEvent<HTMLFormElement>){
    const target=event.target as HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement;
    const label=target.closest("label")?.textContent?.replace(/\+ Create New .*/,"").trim()||target.getAttribute("name")||"required field";
    setStatus(`Please complete ${label}.`);
  }
  async function submitCommercial(event:FormEvent<HTMLFormElement>){event.preventDefault();if(globallyBusy){setStatus("Another transaction action is still running. Please wait, then click Save again.");return;}const saveName=supplierQuotation?"Supplier Quotation":SECTION_META[tab].title;setSaving(true);setStatus(`Saving ${saveName}…`);try{const form=new FormData(event.currentTarget);const validLines=validateCommercialLines();const resolvedParty=validateParty(partyOptions,partyInput,selectedParty,salesSide?"Customer":"Supplier");const payload={documentNumber:"",partyId:resolvedParty,projectId:form.get("projectId")??"",documentDate:form.get("documentDate"),dueDate:form.get("dueDate")??"",expiryDate:form.get("expiryDate")??"",gstRate:Number(form.get("gstRate")||0)/100,accountId:form.get("accountId")??"",poId:"",currency:documentCurrency,exchangeRate:documentCurrency===baseCurrency?1:Number(documentExchangeRate||0)||undefined,lines:validLines.map(line=>({itemId:line.itemId,itemCode:line.itemId,itemName:line.itemName,itemType:line.itemType,description:line.itemName||line.description,qty:Number(line.qty),uom:line.uom,rate:Number(line.rate)}))};const action=tab==="salesQuote"?"createQuote":tab==="salesOrder"?"createSalesOrder":tab==="salesInvoice"?"createInvoice":tab==="supplierQuote"?"createSupplierQuote":"createPurchaseOrder";const result=await call(action,payload);const detail=tab==="salesInvoice"?"invoice":tab==="supplierQuote"||tab==="purchaseOrder"?"purchaseOrder":"quote";setStatus(`${saveName} saved successfully. Opening document…`);router.push(documentHref(detail,result.recordId,"list"));router.refresh();}catch(error){setStatus(error instanceof Error?error.message:"Save failed");}finally{setSaving(false);}}
  async function createSalesOrderFromQuote(quote:any,returnMode:SectionMode="list"){const quoteId=String(quote.quoteId||"");if(!quoteId||globallyBusy)return;setConversionBusy(`so:${quoteId}`);setStatus("Converting Sales Quotation to Sales Order…");try{const response=await fetch("/api/erp/sales-order-conversion",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({quoteId,orderDate:localDate()})});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Sales Order conversion failed");await loadTransactions(true);router.push(documentHref("quote",body.createdId,returnMode));router.refresh();}catch(error){setStatus(error instanceof Error?error.message:"Sales Order conversion failed");}finally{setConversionBusy("");}}
  async function createDeliveryNoteFromSalesOrder(order:any){const salesOrderId=String(order.quoteId||"");if(!salesOrderId||globallyBusy)return;setConversionBusy(`dn:${salesOrderId}`);setStatus("Creating Delivery Note / Stock Out…");try{const response=await fetch("/api/erp/sales-delivery-note",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({salesOrderId,deliveryDate:localDate()})});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Delivery Note failed");await loadTransactions(true);setTab("deliveryNote");setSectionMode("list");syncUrl("sales","deliveryNote","list");router.refresh();}catch(error){setStatus(error instanceof Error?error.message:"Delivery Note failed");}finally{setConversionBusy("");}}
  async function createSalesInvoiceFromSalesOrder(order:any,returnMode:SectionMode="list"){const quoteId=String(order.quoteId||"");if(!quoteId||globallyBusy)return;setConversionBusy(`invoice:${quoteId}`);setStatus("Converting Sales Order to Sales Invoice…");try{const response=await fetch("/api/erp/sales-invoice-conversion",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({quoteId,mode:"FULL",invoiceDate:localDate(),dueDate:localDate(30)})});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Sales Invoice conversion failed");await loadTransactions(true);router.push(documentHref("invoice",body.createdId,returnMode));router.refresh();}catch(error){setStatus(error instanceof Error?error.message:"Sales Invoice conversion failed");}finally{setConversionBusy("");}}
  async function createPurchaseOrderFromSupplierQuote(row:any,returnMode:SectionMode="list"){const supplierQuoteId=String(row.poId||"");if(!supplierQuoteId||globallyBusy)return;setConversionBusy(`po:${supplierQuoteId}`);setStatus("Converting Supplier Quotation to Purchase Order…");try{const response=await fetch("/api/erp/purchase-conversions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({supplierQuoteId})});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Purchase Order conversion failed");await loadTransactions(true);router.push(documentHref("purchaseOrder",body.createdId,returnMode));router.refresh();}catch(error){setStatus(error instanceof Error?error.message:"Purchase Order conversion failed");}finally{setConversionBusy("");}}
  async function createSupplierInvoiceFromPo(po:any,returnMode:SectionMode="create"){const poId=String(po.poId||"");if(!poId||globallyBusy)return;setConversionBusy(`bill:${poId}`);setStatus("Saving Supplier Invoice from currently billable PO quantity…");try{const response=await fetch("/api/erp/conversions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"poToBill",payload:{poId,billDate:localDate(),dueDate:localDate(30),costAccountId:"ACC-5100"}})});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Supplier Invoice conversion failed");await loadTransactions(true);router.push(documentHref("supplierBill",body.createdId,returnMode));}catch(error){setStatus(error instanceof Error?error.message:"Supplier Invoice conversion failed");}finally{setConversionBusy("");}}
  async function submitExpense(event:FormEvent<HTMLFormElement>){event.preventDefault();if(globallyBusy)return;setSaving(true);setStatus("Saving Expense…");try{const form=new FormData(event.currentTarget);const supplierId=expenseSupplierInput.trim()?validateParty(masters.suppliers,expenseSupplierInput,expenseSupplier,"Supplier"):"";const result=await call("createExpense",{...Object.fromEntries(form.entries()),supplierId,expenseNumber:""});router.push(documentHref("expense",result.recordId,"list"));}catch(error){setStatus(error instanceof Error?error.message:"Save failed");}finally{setSaving(false);}}

  const tabButton=(value:Tab,label:string)=><button type="button" key={value} disabled={globallyBusy} className={tab===value?"tab active":"tab"} onClick={()=>changeTab(value)}>{label}</button>;
  const view=(type:string,id:string)=><Link prefetch={false} className="button-link secondary-link" href={documentHref(type,id,"list")}>View / Print</Link>;
  const section=SECTION_META[tab];const title=module==="sales"?"Sales Transactions":module==="purchase"?"Purchase Transactions":"Expenses";const numberLabel=numberMeta[tab]?.label||"Auto Document No";const partyListId=salesSide?"customer-suggestions":"supplier-suggestions";

  function existingCount(){if(tab==="salesQuote")return tx.quotes.length;if(tab==="salesOrder")return tx.salesOrders.length;if(tab==="deliveryNote")return tx.deliveryNotes.length;if(tab==="salesInvoice")return tx.invoices.length;if(tab==="salesPayment")return tx.payments.filter(r=>r.partyType==="Customer").length;if(tab==="supplierQuote")return tx.supplierQuotes.length;if(tab==="purchaseOrder")return tx.purchaseOrders.length;if(tab==="supplierInvoice")return tx.supplierBills.length;if(tab==="purchasePayment")return tx.payments.filter(r=>r.partyType==="Supplier").length;return tx.expenses.length;}
  const emptyAction=<span className="small">—</span>;
  const listColumns:AdjustableColumn<DoctypeListRow>[]=[
    {key:"docId",label:"Doc ID",mandatory:true,defaultWidth:220,sortValue:row=>row.docNumber,value:row=><Link prefetch={false} href={row.href}><strong>{row.docNumber}</strong></Link>},
    {key:"createdAt",label:"Creation Date Time",mandatory:true,defaultWidth:220,sortValue:row=>row.createdAtValue,value:row=>row.createdAtLabel},
    {key:"partyProject",label:"Supplier/Customer & project",mandatory:true,defaultWidth:300,sortValue:row=>row.partyProjectText,value:row=>row.partyProject},
    {key:"amount",label:"Total/Amount",defaultWidth:170,sortValue:row=>row.amountValue,value:row=>row.amount},
    {key:"status",label:"Status",defaultWidth:180,sortValue:row=>row.statusText,value:row=>row.status},
    {key:"action",label:"Action CTA Only Approve & Convert",defaultWidth:340,sortValue:row=>row.statusText,value:row=><div className="row-actions">{row.action||emptyAction}</div>},
  ];
  const makeListRow=(row:Omit<DoctypeListRow,"createdAtLabel"|"createdAtValue"|"statusText">&{source:any;statusText?:string}):DoctypeListRow=>({
    ...row,
    createdAtLabel:createdLabel(row.source),
    createdAtValue:createdValue(row.source),
    statusText:row.statusText||normalizedStatus(row.source?.status),
  });

  function existingRows():DoctypeListRow[]{
    if(tab==="salesQuote")return newest(tx.quotes).map(row=>{const linkedOrders=linkedSalesOrdersForQuote(row);const linkedOrder=linkedOrders[0];const statusKey=normalizedStatus(row.status);const convertedStatus=linkedOrder?`${statusKey==="APPROVED"?"APPROVED & ":""}CONVERTED`:statusKey;const canConvert=QUOTE_CONVERSION_STATUSES.has(statusKey)&&!linkedOrder;return makeListRow({source:row,key:String(row.quoteId),docId:String(row.quoteId),docNumber:String(row.quoteNumber||row.quoteId),href:documentHref("quote",row.quoteId,"list"),partyProject:<>{customerLabel(row.customerId)}<br/><span className="small">{projectLabel(row.projectId)}</span></>,partyProjectText:`${customerLabel(row.customerId)} ${projectLabel(row.projectId)}`,amount:money(row.totalAmount),amountValue:Number(row.totalAmount||0),status:<>{convertedStatus}{linkedOrder&&<><br/><span className="small">→ Sales Order {linkedOrder.quoteNumber||linkedOrder.quoteId}</span></>}</>,statusText:convertedStatus,action:approvalAction("quote",row.quoteId,row.status)||(!linkedOrder&&canConvert?<button type="button" disabled={globallyBusy} onClick={()=>void createSalesOrderFromQuote(row,"list")}>{conversionBusy===`so:${row.quoteId}`?"Converting…":"Convert to Sales Order"}</button>:null)});});
    if(tab==="salesOrder")return newest(tx.salesOrders).map(row=>{const deliveries=deliveryNotesForSalesOrder(row);const linkedInvoices=linkedSalesInvoicesForQuote(row);const linkedInvoice=linkedInvoices[0];const statusKey=normalizedStatus(row.status);const canDeliver=["APPROVED","PART DELIVERED"].includes(statusKey)&&!linkedInvoice;const canInvoice=statusKey==="DELIVERED"&&!linkedInvoice;const action=approvalAction("quote",row.quoteId,row.status)||(canDeliver?<button type="button" disabled={globallyBusy} onClick={()=>void createDeliveryNoteFromSalesOrder(row)}>{conversionBusy===`dn:${row.quoteId}`?"Creating…":"Create Delivery Note / Stock Out"}</button>:canInvoice?<button type="button" disabled={globallyBusy} onClick={()=>void createSalesInvoiceFromSalesOrder(row,"list")}>{conversionBusy===`invoice:${row.quoteId}`?"Converting…":"Convert to Sales Invoice"}</button>:null);return makeListRow({source:row,key:String(row.quoteId),docId:String(row.quoteId),docNumber:String(row.quoteNumber||row.quoteId),href:documentHref("quote",row.quoteId,"list"),partyProject:<>{customerLabel(row.customerId)}<br/><span className="small">{projectLabel(row.projectId)}</span></>,partyProjectText:`${customerLabel(row.customerId)} ${projectLabel(row.projectId)}`,amount:money(row.totalAmount),amountValue:Number(row.totalAmount||0),status:<>{statusKey}{deliveries.length>0&&<><br/><span className="small">Delivery Notes: {deliveries.length}</span></>}{linkedInvoice&&<><br/><span className="small">→ {linkedInvoice.invoiceNumber||linkedInvoice.invoiceId} ({normalizedStatus(linkedInvoice.status)})</span></>}</>,statusText:statusKey,action});});
    if(tab==="deliveryNote")return newest(tx.deliveryNotes).map(row=>makeListRow({source:row,key:String(row.deliveryId||row.deliveryNumber),docId:String(row.deliveryId||row.deliveryNumber),docNumber:String(row.deliveryNumber||row.deliveryId),href:"/stock?mode=register",partyProject:<>{customerLabel(row.customerId)}<br/><span className="small">{projectLabel(row.projectId)}</span></>,partyProjectText:`${customerLabel(row.customerId)} ${projectLabel(row.projectId)}`,amount:<>{money(row.totalAmount)}<br/><span className="small">Source SO: {row.sourceDocumentId||"—"}</span></>,amountValue:Number(row.totalAmount||0),status:<>{row.status||"POSTED"}{row.journalId&&<><br/><span className="small">Journal {row.journalId}</span></>}</>,statusText:normalizedStatus(row.status||"POSTED"),action:emptyAction}));
    if(tab==="salesInvoice")return newest(tx.invoices).map(row=>{const outstanding=Number(row.outstandingAmount??row.totalAmount??0);const linkedPayments=linkedPaymentsForDocument(row,"Customer");const openPayment=linkedPayments.find((payment:any)=>!String(payment.journalId||"").trim()||["DRAFT","APPROVED"].includes(normalizedStatus(payment.status)));const canReceive=paymentEligible(row.status)&&outstanding>0.001&&!openPayment;const paymentNote=openPayment?`Payment Draft: ${openPayment.paymentNumber||openPayment.paymentId}`:linkedPayments.length?`Payments: ${linkedPayments.length}`:"";return makeListRow({source:row,key:String(row.invoiceId),docId:String(row.invoiceId),docNumber:String(row.invoiceNumber||row.invoiceId),href:documentHref("invoice",row.invoiceId,"list"),partyProject:<>{customerLabel(row.customerId)}<br/><span className="small">{projectLabel(row.projectId)}</span></>,partyProjectText:`${customerLabel(row.customerId)} ${projectLabel(row.projectId)}`,amount:<>{money(row.totalAmount)}<br/><span className="small">Outstanding {money(outstanding)}</span></>,amountValue:Number(row.totalAmount||0),status:<>{row.status}{paymentNote&&<><br/><span className="small">{paymentNote}</span></>}</>,statusText:normalizedStatus(row.status),action:approvalAction("invoice",row.invoiceId,row.status)||(openPayment?<Link prefetch={false} className="button-link" href={documentHref("payment",openPayment.paymentId,"list")}>Open Payment Entry</Link>:canReceive?<Link prefetch={false} className="button-link" href={`/transactions?module=sales&tab=salesPayment&mode=create&sourceInvoice=${encodeURIComponent(row.invoiceId)}`}>Create Payment Entry</Link>:null),rowClassName:outstanding>0?styles.outstandingRow:""});});
    if(tab==="supplierQuote")return newest(tx.supplierQuotes).map(row=>{const convertedPo=linkedPurchaseOrderForSupplierQuote(row);const statusKey=normalizedStatus(row.status);const convertedStatus=convertedPo?`${statusKey==="APPROVED"?"APPROVED & ":""}CONVERTED`:statusKey;const canConvert=SUPPLIER_QUOTE_CONVERSION_STATUSES.has(statusKey)&&!convertedPo;return makeListRow({source:row,key:String(row.poId),docId:String(row.poId),docNumber:String(row.poNumber||row.poId),href:documentHref("purchaseOrder",row.poId,"list"),partyProject:<>{supplierLabel(row.supplierId)}<br/><span className="small">{projectLabel(row.projectId)}</span></>,partyProjectText:`${supplierLabel(row.supplierId)} ${projectLabel(row.projectId)}`,amount:money(row.totalAmount),amountValue:Number(row.totalAmount||0),status:<>{convertedStatus}{convertedPo?<><br/><span className="small">→ Purchase Order {convertedPo.poNumber||convertedPo.poId}</span></>:null}</>,statusText:convertedStatus,action:approvalAction("purchaseOrder",row.poId,row.status)||(!convertedPo&&canConvert?<button type="button" disabled={globallyBusy} onClick={()=>void createPurchaseOrderFromSupplierQuote(row,"list")}>{conversionBusy===`po:${row.poId}`?"Converting…":"Convert to Purchase Order"}</button>:null)});});
    if(tab==="purchaseOrder")return newest(tx.purchaseOrders).map(row=>{const receipt=receiptStates[String(row.poId||"")];const rowClass=receipt?.partial?styles.partialReceiptRow:receipt?.fullyReceived?styles.receiptCompleteRow:"";const eligible=poInvoiceEligible(row.status);const supplierInvoiceLabel=supplierInvoiceBlockedLabel(row);const action=approvalAction("purchaseOrder",row.poId,row.status)||(eligible&&receipt?.hasStock&&receipt.hasRemaining&&normalizedStatus(row.status)!=="CLOSED PARTIAL"?<Link className="button-link" href={`/stock?mode=movement&sourcePo=${encodeURIComponent(row.poId)}`}>Create Purchase Receipt / GRN</Link>:eligible&&!supplierInvoiceLabel?<button type="button" disabled={globallyBusy} onClick={()=>void createSupplierInvoiceFromPo(row,"list")}>{conversionBusy===`bill:${row.poId}`?"Saving…":"Create Supplier Invoice"}</button>:null);return makeListRow({source:row,key:String(row.poId),docId:String(row.poId),docNumber:String(row.poNumber||row.poId),href:documentHref("purchaseOrder",row.poId,"list"),partyProject:<>{supplierLabel(row.supplierId)}<br/><span className="small">{projectLabel(row.projectId)}</span></>,partyProjectText:`${supplierLabel(row.supplierId)} ${projectLabel(row.projectId)}`,amount:money(row.totalAmount),amountValue:Number(row.totalAmount||0),status:<>{row.status}{receipt?.hasStock&&<><br/><span className="small">Received {receipt.received.toLocaleString()} / {receipt.ordered.toLocaleString()} · Remaining {receipt.remaining.toLocaleString()}</span></>}{receipt?.partial&&<><br/><span className="small"><strong>PARTIAL RECEIPT</strong></span></>}{receipt?.fullyReceived&&<><br/><span className="small">Goods fully received</span></>}{supplierInvoiceLabel&&<><br/><span className="small">{supplierInvoiceLabel}</span></>}</>,statusText:normalizedStatus(row.status),action,rowClassName:rowClass});});
    if(tab==="supplierInvoice")return newest(tx.supplierBills).map(row=>{const outstanding=Number(row.outstandingAmount??row.totalAmount??0);const partialPaid=normalizedStatus(row.status)==="PARTLY PAID";const linkedPayments=linkedPaymentsForDocument(row,"Supplier");const openPayment=linkedPayments.find((payment:any)=>!String(payment.journalId||"").trim()||["DRAFT","APPROVED"].includes(normalizedStatus(payment.status)));const paymentNote=openPayment?`Payment Draft: ${openPayment.paymentNumber||openPayment.paymentId}`:linkedPayments.length?`Payments: ${linkedPayments.length}`:"";return makeListRow({source:row,key:String(row.billId),docId:String(row.billId),docNumber:String(row.billNumber||row.billId),href:documentHref("supplierBill",row.billId,"list"),partyProject:<>{supplierLabel(row.supplierId)}<br/><span className="small">{projectLabel(row.projectId)}</span></>,partyProjectText:`${supplierLabel(row.supplierId)} ${projectLabel(row.projectId)}`,amount:<>{money(row.totalAmount)}<br/><span className="small"><strong>Outstanding {money(outstanding)}</strong></span></>,amountValue:Number(row.totalAmount||0),status:<>{row.status}{paymentNote&&<><br/><span className="small">{paymentNote}</span></>}</>,statusText:normalizedStatus(row.status),action:approvalAction("supplierBill",row.billId,row.status)||(openPayment?<Link prefetch={false} className="button-link" href={documentHref("payment",openPayment.paymentId,"list")}>Open Payment Entry</Link>:paymentEligible(row.status)&&outstanding>0.001?<Link prefetch={false} className="button-link" href={`/transactions?module=purchase&tab=purchasePayment&mode=create&sourceBill=${encodeURIComponent(row.billId)}`}>Create Payment Entry</Link>:null),rowClassName:outstanding>0?(partialPaid?styles.partialPaidRow:styles.outstandingRow):""});});
    if(tab==="salesPayment")return newest(tx.payments.filter(r=>r.partyType==="Customer")).map(row=>{const approvedNotFinal=normalizedStatus(row.status)==="APPROVED"&&!row.journalId;return makeListRow({source:row,key:String(row.paymentId),docId:String(row.paymentId),docNumber:String(row.paymentNumber||row.paymentId),href:documentHref("payment",row.paymentId,"list"),partyProject:<>{customerLabel(row.partyId)}<br/><span className="small">{projectLabel(row.projectId)}</span></>,partyProjectText:`${customerLabel(row.partyId)} ${projectLabel(row.projectId)}`,amount:money(row.amount),amountValue:Number(row.amount||0),status:<>{row.status}{row.journalId&&<><br/><span className="small">Finalized</span></>}</>,statusText:normalizedStatus(row.status),action:approvalAction("payment",row.paymentId,row.status)||(approvedNotFinal?<Link className="button-link" href={documentHref("payment",row.paymentId,"list")}>Final Save / Post</Link>:null)});});
    if(tab==="purchasePayment")return newest(tx.payments.filter(r=>r.partyType==="Supplier")).map(row=>{const approvedNotFinal=normalizedStatus(row.status)==="APPROVED"&&!row.journalId;return makeListRow({source:row,key:String(row.paymentId),docId:String(row.paymentId),docNumber:String(row.paymentNumber||row.paymentId),href:documentHref("payment",row.paymentId,"list"),partyProject:<>{supplierLabel(row.partyId)}<br/><span className="small">{projectLabel(row.projectId)}</span></>,partyProjectText:`${supplierLabel(row.partyId)} ${projectLabel(row.projectId)}`,amount:money(row.amount),amountValue:Number(row.amount||0),status:<>{row.status}{row.journalId&&<><br/><span className="small">Finalized</span></>}</>,statusText:normalizedStatus(row.status),action:approvalAction("payment",row.paymentId,row.status)||(approvedNotFinal?<Link className="button-link" href={documentHref("payment",row.paymentId,"list")}>Final Save / Post</Link>:null)});});
    return newest(tx.expenses).map(row=>makeListRow({source:row,key:String(row.expenseId),docId:String(row.expenseId),docNumber:String(row.expenseNumber||row.expenseId),href:documentHref("expense",row.expenseId,"list"),partyProject:<>{supplierLabel(row.supplierId)}<br/><span className="small">{projectLabel(row.projectId)}</span></>,partyProjectText:`${supplierLabel(row.supplierId)} ${projectLabel(row.projectId)}`,amount:money(row.totalAmount),amountValue:Number(row.totalAmount||0),status:row.status,statusText:normalizedStatus(row.status),action:approvalAction("expense",row.expenseId,row.status)}));
  }

  return <>
    <div className="page-head">
      <div>
        <h2>{title}</h2>
        <p className="small">{title} → {section.title} → {sectionMode==="create"?"Create Form":"List View"}</p>
      </div>
      <div className="page-head-actions">
        {status && (
          <details className="system-notice-tab">
            <summary>
              <span>ℹ️ System Notice</span>
              <span className="notice-arrow">▾</span>
            </summary>
            <div className="system-notice-dropdown">
              <strong>Transaction notice:</strong> {status}
            </div>
          </details>
        )}
        <span className="badge">{section.title}</span>
      </div>
    </div>

    {module === "sales" && (
      <div className="tabs wrap-tabs">
        {tabButton("salesQuote", "Sales Quotation")}
        {tabButton("salesOrder", "Sales Order")}
        {tabButton("deliveryNote", "Delivery Note / Stock Out")}
        {tabButton("salesInvoice", "Sales Invoice")}
        {tabButton("salesPayment", "Sales Payment Entry / Receipt")}
      </div>
    )}
    {module === "purchase" && (
      <div className="tabs wrap-tabs">
        {tabButton("supplierQuote", "Supplier Quotation")}
        {tabButton("purchaseOrder", "Purchase Order")}
        {tabButton("supplierInvoice", "Supplier Invoice")}
        {tabButton("purchasePayment", "Purchase Payment Entry / Receipt")}
      </div>
    )}

    <div style={{display:"flex",gap:"10px",margin:"14px 0 16px",flexWrap:"wrap",alignItems:"center"}}>
      <button
        type="button"
        disabled={globallyBusy}
        className={sectionMode==="list"?"tab active":"tab"}
        style={{padding:"8px 18px",borderRadius:"6px",fontWeight:600,display:"inline-flex",alignItems:"center",gap:"8px"}}
        onClick={()=>openMode("list")}
      >
        <span>📋</span> {section.listLabel} ({existingCount()})
      </button>
      <button
        type="button"
        disabled={globallyBusy}
        className={sectionMode==="create"?"tab active":"tab"}
        style={{padding:"8px 18px",borderRadius:"6px",fontWeight:600,display:"inline-flex",alignItems:"center",gap:"8px"}}
        onClick={()=>openMode("create")}
      >
        <span>➕</span> {section.createLabel}
      </button>
    </div>

    {sectionMode==="create"&&<section className={`panel ${styles.contextBar}`}><button type="button" disabled={globallyBusy} className="secondary" onClick={()=>openMode("list")}>← Back to {section.listLabel}</button><span className={styles.contextTitle}>{section.createLabel}</span></section>}

    {sectionMode==="create"&&commercial&&<form className="panel" onSubmit={submitCommercial} onInvalidCapture={invalidCommercialField}>
      <div className="form-title-row"><div><h3>{section.createLabel}</h3><p className="small">{supplierQuotation?"Select an existing Item or type a temporary supplier item. After approval, every TEMP line must be reviewed and saved permanently in Item Master before PO conversion.":"Operational rows remain Item Master linked. If a supporting master is missing, create it instantly without leaving this page or losing draft data."}</p></div><span className="auto-badge">Document No: {nextDocumentNo||"AUTO"}</span></div>
      <div className="form-grid">
        <label>{salesSide?"Customer":"Supplier"}<div style={{display:"grid",gap:6}}><input list={partyListId} value={partyInput} onChange={event=>handlePartyInput(event.target.value)} placeholder={`Search ${salesSide?"customer":"supplier"} by name or ID`} autoComplete="off" disabled={saving}/><datalist id={partyListId}>{partyOptions.map(row=><option key={partyId(row)} value={partyDisplay(row)}/>)}</datalist><select value={selectedParty} onChange={event=>{const row=partyOptions.find(option=>partyId(option)===event.target.value);handlePartyInput(row?partyDisplay(row):"");}} required disabled={saving}><option value="">{`Select ${salesSide?"customer":"supplier"} from list`}</option>{partyOptions.map(row=><option key={partyId(row)} value={partyId(row)}>{partyDisplay(row)}</option>)}</select><span className="small">Type to search, or use the dropdown list.</span></div><div className="field-action"><button type="button" onClick={()=>setQuickModal(salesSide?"customer":"supplier")}>{`+ Create New ${salesSide?"Customer":"Supplier"}`}</button></div></label>
        <label>Project<select name="projectId" value={selectedProjectId} onChange={e=>setSelectedProjectId(e.target.value)} disabled={saving}><option value="">No project</option>{projectOptions.map(row=><option key={row.projectId} value={row.projectId}>{row.projectName} ({row.projectId})</option>)}</select><div className="field-action"><button type="button" onClick={()=>setQuickModal("project")}>+ Create New Project</button></div></label>
        <label>{numberLabel}<input value={nextDocumentNo||"AUTO"} readOnly/></label><div></div>
        <label>Date<input name="documentDate" type="date" required defaultValue={localDate()} disabled={saving}/></label>{tab==="salesInvoice"&&<label>Due Date<input name="dueDate" type="date" defaultValue={localDate(30)} disabled={saving}/></label>}{(tab==="salesQuote"||tab==="supplierQuote")&&<label>Valid Till<input name="expiryDate" type="date" defaultValue={localDate(7)} disabled={saving}/></label>}<label>Currency<input value={documentCurrency} onChange={event=>{setDocumentCurrency(event.target.value.toUpperCase().slice(0,3));setDocumentExchangeRate("");}} maxLength={3} pattern="[A-Za-z]{3}" required disabled={saving}/><span className="small">Party currency defaults here. Company base: {baseCurrency}.</span></label>{documentCurrency!==baseCurrency&&<label>Exchange Rate<input value={documentExchangeRate} onChange={event=>setDocumentExchangeRate(event.target.value)} type="number" min="0.00000001" step="0.00000001" placeholder={`1 ${documentCurrency} = ? ${baseCurrency}`} disabled={saving}/><span className="small">Optional on draft. If blank, posting uses the latest approved historical rate on/before document date.</span></label>}<label>GST %<input name="gstRate" type="number" min="0" max="100" step="0.01" value={gstRate} onChange={event=>setGstRate(event.target.value)} disabled={saving}/></label>{tab==="salesInvoice"&&<label>Revenue Account Override<AccountPicker name="accountId" value={invoiceAccountOverride} onChange={setInvoiceAccountOverride} accounts={accountOptions} kind="income" disabled={saving} placeholder="Search revenue account (optional)"/><span className="small">Item Master account has priority when this is blank.</span></label>}
      </div>
      <h4>Items</h4><TransactionItemLines lines={lines} items={items} supplierQuotation={supplierQuotation} onChange={saving?()=>undefined:setLines}/>
      <div style={{display:"flex",justifyContent:"flex-end",marginTop:18}}><div style={{width:"min(420px,100%)",border:"1px solid #e5ebf2",borderRadius:10,overflow:"hidden",background:"#fff"}}><div style={{display:"flex",justifyContent:"space-between",padding:"12px 14px"}}><span>Sub Total</span><strong>{moneyIn(subtotal,documentCurrency)}</strong></div><div style={{display:"flex",justifyContent:"space-between",padding:"12px 14px"}}><span>GST {Number(gstRate||0).toFixed(2)}%</span><strong>{moneyIn(gstAmount,documentCurrency)}</strong></div><div style={{display:"flex",justifyContent:"space-between",padding:14,background:"#f8fafc",fontSize:18}}><strong>Net Total</strong><strong>{moneyIn(netTotal,documentCurrency)}</strong></div></div></div><div className="button-row"><button type="submit" disabled={saving||globallyBusy} style={(saving||globallyBusy)?{opacity:0.6,cursor:"not-allowed",filter:"grayscale(1)"}:undefined}>{commercialSaveLabel()}</button></div>
    </form>}

    {sectionMode==="create"&&tab==="deliveryNote"&&<><section className="panel"><div className="form-title-row"><div><h3>Create New Delivery Note / Stock Out</h3><p className="small">Delivery Note posts stock out and COGS for stock items. Sales Invoice unlocks after delivery for stock lines.</p></div><span className="auto-badge">{existingLoading?"Loading…":`${deliveryReadySalesOrders.length} SO Available`}</span></div></section><section className="panel table-wrap"><table className="data-table"><thead><tr><th>Sales Order</th><th>Customer</th><th>Project</th><th>Total</th><th>Status</th><th>Action</th></tr></thead><tbody>{!existingLoading&&deliveryReadySalesOrders.length===0&&<tr><td colSpan={6}>No approved Sales Orders are available for Delivery Note / Stock Out.</td></tr>}{newest(deliveryReadySalesOrders).map(order=><tr key={order.quoteId}><td><Link href={documentHref("quote",order.quoteId,"create")}><strong>{order.quoteNumber||order.quoteId}</strong></Link></td><td>{customerLabel(order.customerId)}</td><td>{projectLabel(order.projectId)}</td><td>{money(order.totalAmount)}</td><td>{order.status}</td><td><button type="button" disabled={globallyBusy} onClick={()=>void createDeliveryNoteFromSalesOrder(order)}>{conversionBusy===`dn:${order.quoteId}`?"Creating…":"Create Delivery Note / Stock Out"}</button></td></tr>)}</tbody></table></section></>}
    {sectionMode==="create"&&tab==="salesPayment"&&<SalesPaymentStaged key={`sales-payment:${searchParamsKey}`}/>}
    {sectionMode==="create"&&tab==="supplierInvoice"&&<><section className="panel"><div className="form-title-row"><div><h3>Create New Supplier Invoice</h3><p className="small">Partial billing is allowed. Stock lines become billable only after Purchase Receipt; service/non-stock lines use remaining ordered quantity.</p></div><span className="auto-badge">{existingLoading?"Loading…":`${supplierInvoiceReadyPos.length} PO Available`}</span></div></section><section className="panel table-wrap"><table className="data-table"><thead><tr><th>Purchase Order</th><th>Supplier</th><th>Project</th><th>Total</th><th>Lifecycle</th><th>Action</th></tr></thead><tbody>{!existingLoading&&supplierInvoiceReadyPos.length===0&&<tr><td colSpan={6}>No approved/part-received Purchase Orders are available for billing.</td></tr>}{newest(supplierInvoiceReadyPos).map(po=>{const supplierInvoiceLabel=supplierInvoiceBlockedLabel(po);return <tr key={po.poId}><td><Link href={documentHref("purchaseOrder",po.poId,"create")}><strong>{po.poNumber||po.poId}</strong></Link></td><td>{supplierLabel(po.supplierId)}</td><td>{projectLabel(po.projectId)}</td><td>{money(po.totalAmount)}</td><td>{po.status}</td><td>{supplierInvoiceLabel?<span className="auto-badge">{supplierInvoiceLabel}</span>:<button type="button" disabled={globallyBusy} onClick={()=>void createSupplierInvoiceFromPo(po)}>{conversionBusy===`bill:${po.poId}`?"Saving…":"Create Supplier Invoice"}</button>}</td></tr>;})}</tbody></table></section></>}
    {sectionMode==="create"&&tab==="purchasePayment"&&<PurchasePaymentStaged key={`purchase-payment:${searchParamsKey}`}/>}
    {sectionMode==="create"&&tab==="expense"&&<form className="panel form-grid" onSubmit={submitExpense}><h3 className="form-title">Create New Expense</h3><label>Date<input name="expenseDate" type="date" required defaultValue={localDate()} disabled={saving}/></label><label>Supplier<div style={{display:"grid",gap:6}}><input list="expense-supplier-suggestions" value={expenseSupplierInput} onChange={event=>handleExpenseSupplierInput(event.target.value)} placeholder="Search supplier by name or ID" autoComplete="off" disabled={saving}/><datalist id="expense-supplier-suggestions">{masters.suppliers.map(row=><option key={partyId(row)} value={partyDisplay(row)}/>)}</datalist><select value={expenseSupplier} onChange={event=>{const row=masters.suppliers.find(option=>partyId(option)===event.target.value);handleExpenseSupplierInput(row?partyDisplay(row):"");}} disabled={saving}><option value="">No supplier / select from list</option>{masters.suppliers.map(row=><option key={partyId(row)} value={partyId(row)}>{partyDisplay(row)}</option>)}</select><span className="small">Type to search, or use the dropdown list.</span></div><div className="field-action"><button type="button" onClick={()=>setQuickModal("supplier")}>+ Create New Supplier</button></div></label><label>Project<select name="projectId" value={selectedProjectId} onChange={e=>setSelectedProjectId(e.target.value)} disabled={saving}><option value="">No project</option>{masters.projects.map(row=><option key={row.projectId} value={row.projectId}>{row.projectName} ({row.projectId})</option>)}</select><div className="field-action"><button type="button" onClick={()=>setQuickModal("project")}>+ Create New Project</button></div></label><label>Expense Account<AccountPicker name="expenseAccountId" value={expenseAccountId} onChange={setExpenseAccountId} accounts={accountOptions} kind="expense" required disabled={saving} placeholder="Search expense account by name or code"/></label><label>Net Amount<input name="netAmount" type="number" min="0" step="0.01" required disabled={saving}/></label><label>GST Amount<input name="gstAmount" type="number" min="0" step="0.01" defaultValue="0" disabled={saving}/></label><label>Payment Method<select name="paymentMethod" disabled={saving}><option>Cash</option><option>Bank Transfer</option><option>Card</option></select></label><label>Cash / Bank Account<AccountPicker name="cashBankAccountId" value={cashBankAccountId} onChange={setCashBankAccountId} accounts={accountOptions} kind="cash-bank" required disabled={saving} placeholder="Search cash/bank account by name or code"/></label><label className="form-wide">Description<input name="description" required disabled={saving}/></label><div className="form-wide"><button type="submit" disabled={saving||globallyBusy} style={(saving||globallyBusy)?{opacity:0.6,cursor:"not-allowed",filter:"grayscale(1)"}:undefined}>{saving?"Saving...":"Save Draft"}</button></div></form>}

    {sectionMode==="list"&&<section className="panel">
      <div className="form-title-row">
        <div>
          <h3>{section.existingTitle}</h3>
          <p className="small">Excel-style doctype list view: global search, sortable columns, movable headers, resizable columns, and Doc ID click-to-open.</p>
        </div>
        <span className="auto-badge">{existingLoading||(tab==="purchaseOrder"&&receiptStatesLoading)?"Loading…":`${existingCount()} Documents · Newest first`}</span>
      </div>
      <AdjustableDataTable<DoctypeListRow>
        rows={existingRows()}
        columns={listColumns}
        loading={existingLoading||(tab==="purchaseOrder"&&receiptStatesLoading)}
        emptyMessage="No existing documents found in this section."
        loadingMessage="Loading live list values…"
        rowKey={(row)=>row.key}
        rowClassName={(row)=>row.rowClassName}
      />
    </section>}

    {quickModal && (
      <QuickMasterModal
        isOpen={Boolean(quickModal)}
        type={quickModal}
        defaultCustomerId={salesSide ? selectedParty : ""}
        customers={masters.customers}
        onClose={() => setQuickModal(null)}
        onSuccess={handleMasterCreated}
      />
    )}
  </>;
}
