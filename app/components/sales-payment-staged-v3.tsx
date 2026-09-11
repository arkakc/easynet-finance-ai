"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FlowCreateLink, useFlowDataRefresh } from "@/app/components/flow-navigation";

type Mode="menu"|"invoice"|"direct";
type Master={customers:any[];projects:any[]};
type CashBankAccount={accountId:string;accountCode:string;accountName:string;balance:number};
const money=(value:unknown)=>`K${Number(value||0).toFixed(2)}`;
const normalize=(value:unknown)=>String(value||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,"");
const paymentEligibleStatus=(value:unknown)=>["POSTED","PARTLY_PAID"].includes(String(value||"").toUpperCase());
const returnQuery="returnModule=sales&returnTab=salesPayment&returnMode=create";
function localDate(){const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Pacific/Port_Moresby",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));return`${v.year}-${v.month}-${v.day}`;}
function customerId(row:any){return String(row.customerId||"");}
function customerName(row:any){return String(row.customerName||customerId(row));}
function customerDisplay(row:any){const id=customerId(row),name=customerName(row);return id&&name!==id?`${name} (${id})`:name;}
function resolveCustomer(rows:any[],input:string){const q=input.trim().toLowerCase();if(!q)return null;return rows.find(row=>customerDisplay(row).toLowerCase()===q)||rows.find(row=>customerId(row).toLowerCase()===q)||rows.find(row=>customerName(row).toLowerCase()===q)||null;}
function projectDisplay(row:any){const id=String(row.projectId||"");const name=String(row.projectName||id);return id&&name!==id?`${name} (${id})`:name||"—";}
function createdValue(row:any){const t=new Date(String(row.createdAt||row.invoiceDate||"")).getTime();return Number.isFinite(t)?t:0;}

export default function SalesPaymentStagedV3(){
  const router=useRouter();
  const[mode,setMode]=useState<Mode>("menu"),[status,setStatus]=useState(""),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[nextNo,setNextNo]=useState("AUTO");
  const[invoices,setInvoices]=useState<any[]>([]),[search,setSearch]=useState(""),[searched,setSearched]=useState<any|null>(null),[selectedInvoice,setSelectedInvoice]=useState<any|null>(null);
  const[masters,setMasters]=useState<Master>({customers:[],projects:[]}),[accounts,setAccounts]=useState<CashBankAccount[]>([]),[customerInput,setCustomerInput]=useState(""),[selectedCustomer,setSelectedCustomer]=useState("");
  const approved=useMemo(()=>[...invoices].filter(row=>paymentEligibleStatus(row.status)&&Number(row.outstandingAmount??row.totalAmount??0)>0.001).sort((a,b)=>createdValue(b)-createdValue(a)),[invoices]);
  const projectOptions=useMemo(()=>{if(!selectedCustomer)return masters.projects;const linked=masters.projects.filter(row=>String(row.customerId||"")===selectedCustomer);return linked.length?linked:masters.projects;},[masters.projects,selectedCustomer]);
  function customerLabel(id:unknown){const key=String(id||"");const row=masters.customers.find(item=>customerId(item)===key);return row?customerDisplay(row):key||"—";}
  function projectLabel(id:unknown){const key=String(id||"");if(!key)return"No project";const row=masters.projects.find(item=>String(item.projectId||"")===key);return row?projectDisplay(row):key;}

  const refreshMasters=useCallback(async()=>{try{const response=await fetch("/api/masters",{cache:"no-store"});const body=await response.json();if(response.ok&&body.ok)setMasters({customers:body.customers||[],projects:body.projects||[]});}catch{}},[]);
  useFlowDataRefresh(()=>{void refreshMasters();});

  async function loadWorkspace(){
    setLoading(true);
    try{
      const[txR,mR,aR,nR]=await Promise.all([
        fetch("/api/erp/transactions",{cache:"no-store"}),fetch("/api/masters",{cache:"no-store"}),fetch("/api/erp/reference-options",{cache:"no-store"}),fetch("/api/erp/transactions?nextNumberFor=createPayment&partyType=Customer",{cache:"no-store"}),
      ]);
      const[tx,m,a,n]=await Promise.all([txR.json(),mR.json(),aR.json(),nR.json()]);
      if(!txR.ok||!tx.ok)throw new Error(tx.error||"Sales Invoice load failed");
      if(!mR.ok||!m.ok)throw new Error(m.error||"Customer master load failed");
      if(!aR.ok||!a.ok)throw new Error(a.error||"Cash / Bank account load failed");
      setInvoices(tx.invoices||[]);setMasters({customers:m.customers||[],projects:m.projects||[]});setAccounts(a.cashBankAccounts||[]);setNextNo(nR.ok&&n.ok?n.nextNumber||"AUTO":"AUTO");
      return tx.invoices||[];
    }catch(error){setStatus(error instanceof Error?error.message:"Sales Payment workspace load failed");return[];}finally{setLoading(false);}
  }

  function eligible(rows:any[]){return rows.filter(row=>paymentEligibleStatus(row.status)&&Number(row.outstandingAmount??row.totalAmount??0)>0.001);}
  function chooseInvoice(row:any){setSelectedInvoice(row);setSearched(row);setSearch(String(row.invoiceNumber||row.invoiceId||""));setStatus("");window.setTimeout(()=>document.getElementById("sales-payment-invoice-form")?.scrollIntoView({behavior:"smooth",block:"start"}),0);}
  async function openInvoiceMode(sourceInvoice=""){
    setMode("invoice");setStatus("");setSelectedInvoice(null);setSearched(null);
    const rows=await loadWorkspace();
    if(sourceInvoice){
      const match=eligible(rows).find((row:any)=>String(row.invoiceId||"")===sourceInvoice||String(row.invoiceNumber||"")===sourceInvoice);
      if(match)chooseInvoice(match);else setStatus(`Sales Invoice is not posted with an outstanding balance, or was not found: ${sourceInvoice}`);
    }
  }
  async function openDirectMode(){setMode("direct");setStatus("");setCustomerInput("");setSelectedCustomer("");await loadWorkspace();}
  function backToPaymentChoices(){setMode("menu");setStatus("");setSearch("");setSearched(null);setSelectedInvoice(null);setCustomerInput("");setSelectedCustomer("");}

  useEffect(()=>{
    const sourceInvoice=new URLSearchParams(window.location.search).get("sourceInvoice")||"";
    if(sourceInvoice)void openInvoiceMode(sourceInvoice);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  function searchInvoice(){
    const q=normalize(search);if(!q){setSearched(null);setStatus("Enter a Sales Invoice number");return;}
    const match=approved.find(row=>normalize(row.invoiceNumber)===q||normalize(row.invoiceId)===q)||approved.find(row=>normalize(row.invoiceNumber).includes(q)||normalize(row.invoiceId).includes(q));
    if(!match){setSearched(null);setStatus(`Posted Sales Invoice with outstanding amount not found: ${search}`);return;}
    setStatus("");setSearched(match);
  }
  async function createPayment(payload:Record<string,unknown>){const response=await fetch("/api/erp/transactions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"createPayment",payload})});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Sales Payment draft save failed");return body.result;}
  async function saveInvoicePayment(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!selectedInvoice||busy)return;setBusy(true);setStatus("Saving Payment Entry…");
    try{const form=new FormData(event.currentTarget);const amount=Number(form.get("amount")||0),outstanding=Number(selectedInvoice.outstandingAmount??selectedInvoice.totalAmount??0);if(!(amount>0))throw new Error("Payment amount must be greater than zero");if(amount>outstanding+0.001)throw new Error("Payment amount cannot exceed Sales Invoice outstanding amount. Record any excess separately as Customer Advance.");const result=await createPayment({paymentNumber:"",paymentType:"RECEIVE",partyType:"Customer",partyId:selectedInvoice.customerId,projectId:selectedInvoice.projectId||"",paymentDate:form.get("paymentDate"),amount,paymentMethod:form.get("paymentMethod"),cashBankAccountId:form.get("cashBankAccountId"),reference:form.get("reference")||"",againstDocumentType:"Sales Invoice",againstDocumentId:selectedInvoice.invoiceId});router.push(`/transactions/payment/${result.recordId}?${returnQuery}`);router.refresh();}catch(error){setStatus(error instanceof Error?error.message:"Sales Payment draft save failed");}finally{setBusy(false);}
  }
  async function saveDirectPayment(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy)return;setBusy(true);setStatus("Saving Customer Advance…");
    try{const form=new FormData(event.currentTarget);const match=selectedCustomer?masters.customers.find(row=>customerId(row)===selectedCustomer):resolveCustomer(masters.customers,customerInput);if(!match)throw new Error("Select a valid Customer from the suggestions");const amount=Number(form.get("amount")||0);if(!(amount>0))throw new Error("Payment amount must be greater than zero");const result=await createPayment({paymentNumber:"",paymentType:"RECEIVE",partyType:"Customer",partyId:customerId(match),projectId:form.get("projectId")||"",paymentDate:form.get("paymentDate"),amount,paymentMethod:form.get("paymentMethod"),cashBankAccountId:form.get("cashBankAccountId"),reference:form.get("reference")||"",againstDocumentType:"",againstDocumentId:""});router.push(`/transactions/payment/${result.recordId}?${returnQuery}`);router.refresh();}catch(error){setStatus(error instanceof Error?error.message:"Customer Advance save failed");}finally{setBusy(false);}
  }
  const cashBankOptions=<><option value="">Select Cash / Bank account</option>{accounts.map(account=><option key={account.accountId} value={account.accountId}>{account.accountName} ({account.accountId}) · Balance {money(account.balance)}</option>)}</>;

  return <>
    {status&&<section className="panel status-banner">{status}</section>}
    {mode==="menu"&&<section className="panel"><div className="form-title-row"><div><h3>Create New Sales Payment Entry / Receipt</h3><p className="small">Choose an allocated receipt against a posted Sales Invoice, or record an unallocated Customer Advance.</p></div></div><div className="button-row" style={{marginTop:18,alignItems:"stretch"}}><button type="button" disabled={loading} style={{minHeight:86,flex:"1 1 320px",textAlign:"left"}} onClick={()=>void openInvoiceMode()}><strong style={{display:"block"}}>Posted Sales Invoice Payment</strong><span style={{display:"block",marginTop:7,fontWeight:400}}>Search or choose a posted/part-paid invoice with outstanding balance.</span></button><button type="button" disabled={loading} className="secondary" style={{minHeight:86,flex:"1 1 320px",textAlign:"left"}} onClick={()=>void openDirectMode()}><strong style={{display:"block"}}>Direct Customer Advance</strong><span style={{display:"block",marginTop:7,fontWeight:400}}>Records a Customer Advance until allocated.</span></button></div></section>}
    {mode!=="menu"&&<section className="panel"><div className="button-row" style={{justifyContent:"space-between"}}><button type="button" className="secondary" disabled={busy} onClick={backToPaymentChoices}>← Back to Sales Payment Choices</button><span className="auto-badge">Next Payment No: {nextNo||"AUTO"}</span></div></section>}

    {mode==="invoice"&&<>
      <section className="panel"><div className="form-title-row"><div><h3>Search Posted Sales Invoice</h3><p className="small">Search comes first so a known invoice can be opened directly without scrolling through the pending list.</p></div></div><div className="form-grid" style={{marginTop:16}}><label>Sales Invoice No<input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();searchInvoice();}}} placeholder="e.g. SI-2026-00001" autoComplete="off"/></label><div style={{display:"flex",alignItems:"end"}}><button type="button" style={{width:"100%",height:52}} onClick={searchInvoice} disabled={loading}>{loading?"Searching…":"Search"}</button></div></div>{searched&&<div style={{marginTop:20}}><div className="document-meta"><div><span>Sales Invoice</span><strong>{searched.invoiceNumber||searched.invoiceId}</strong></div><div><span>Customer</span><strong>{customerLabel(searched.customerId)}</strong></div><div><span>Project</span><strong>{projectLabel(searched.projectId)}</strong></div><div><span>Invoice Total</span><strong>{money(searched.totalAmount)}</strong></div><div><span>Outstanding</span><strong>{money(searched.outstandingAmount??searched.totalAmount)}</strong></div><div><span>Status</span><strong>{searched.status}</strong></div></div><div className="button-row" style={{marginTop:18}}><button type="button" onClick={()=>chooseInvoice(searched)}>Create Payment Entry</button><Link className="button-link secondary-link" href={`/transactions/invoice/${encodeURIComponent(searched.invoiceId)}?${returnQuery}`}>Open Sales Invoice</Link></div></div>}</section>
      <section className="panel table-wrap"><div className="form-title-row"><div><h3>Posted Sales Invoices Pending Payment</h3><p className="small">Newest documents first.</p></div><span className="auto-badge">{loading?"Loading…":`${approved.length} Pending`}</span></div><table className="data-table"><thead><tr><th>Sales Invoice</th><th>Customer</th><th>Project</th><th>Invoice Total</th><th>Outstanding</th><th>Action</th></tr></thead><tbody>{!loading&&approved.length===0&&<tr><td colSpan={6}>No posted Sales Invoices with outstanding balance.</td></tr>}{approved.map(invoice=><tr key={invoice.invoiceId}><td><Link href={`/transactions/invoice/${invoice.invoiceId}?${returnQuery}`}><strong>{invoice.invoiceNumber||invoice.invoiceId}</strong></Link></td><td>{customerLabel(invoice.customerId)}</td><td>{projectLabel(invoice.projectId)}</td><td>{money(invoice.totalAmount)}</td><td><strong>{money(invoice.outstandingAmount??invoice.totalAmount)}</strong></td><td><button type="button" onClick={()=>chooseInvoice(invoice)}>Create Payment</button></td></tr>)}</tbody></table></section>
      {selectedInvoice&&<form id="sales-payment-invoice-form" className="panel form-grid" onSubmit={saveInvoicePayment}><h3 className="form-title">Sales Payment Entry / Receipt Against Invoice</h3><label>Sales Invoice<input value={selectedInvoice.invoiceNumber||selectedInvoice.invoiceId} readOnly/></label><label>Customer<input value={customerLabel(selectedInvoice.customerId)} readOnly/></label><label>Project<input value={projectLabel(selectedInvoice.projectId)} readOnly/></label><label>Auto Payment No<input value={nextNo||"AUTO"} readOnly/></label><label>Invoice Total<input value={money(selectedInvoice.totalAmount)} readOnly/></label><label>Outstanding<input value={money(selectedInvoice.outstandingAmount??selectedInvoice.totalAmount)} readOnly/></label><label>Payment Date<input name="paymentDate" type="date" defaultValue={localDate()} required disabled={busy}/></label><label>Amount<input name="amount" type="number" min="0.01" max={Number(selectedInvoice.outstandingAmount??selectedInvoice.totalAmount??0)} step="0.01" defaultValue={Number(selectedInvoice.outstandingAmount??selectedInvoice.totalAmount??0)} required disabled={busy}/><span className="small">Overpayment is blocked here. Record excess separately as Customer Advance.</span></label><label>Payment Method<select name="paymentMethod" defaultValue="" required disabled={busy}><option value="">Select payment method</option><option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Cheque</option></select></label><label>Cash / Bank Account<select name="cashBankAccountId" required defaultValue="" disabled={busy}>{cashBankOptions}</select></label><label className="form-wide">Reference<input name="reference" placeholder="Bank / receipt reference" disabled={busy}/></label><div className="form-wide button-row"><button type="button" className="secondary" onClick={()=>setSelectedInvoice(null)} disabled={busy}>Cancel</button><button type="submit" disabled={busy} style={busy ? { opacity: 0.6, cursor: "not-allowed", filter: "grayscale(1)" } : undefined}>{busy?"Saving Draft…":"Save Payment Draft"}</button></div></form>}
    </>}

    {mode==="direct"&&<form className="panel form-grid" onSubmit={saveDirectPayment}><div className="form-wide form-title-row"><div><h3 className="form-title">Direct Customer Advance Without Sales Invoice</h3><p className="small">If the Customer or Project is missing, create it in another tab. This form remains open and refreshes master choices when you return.</p></div><div className="button-row"><FlowCreateLink target="customer" label="Create New Customer in New Tab" returnLabel="Customer Advance"/><FlowCreateLink target="project" label="Create New Project in New Tab" returnLabel="Customer Advance"/></div></div><label>Customer<input list="direct-payment-customer-suggestions" value={customerInput} onChange={e=>{const value=e.target.value;setCustomerInput(value);const match=resolveCustomer(masters.customers,value);setSelectedCustomer(match?customerId(match):"");}} placeholder="Type customer name or ID" autoComplete="off" required disabled={busy}/><datalist id="direct-payment-customer-suggestions">{masters.customers.map(row=><option key={customerId(row)} value={customerDisplay(row)}/>)}</datalist></label><label>Project<select name="projectId" defaultValue="" disabled={busy}><option value="">No project</option>{projectOptions.map(row=><option key={row.projectId} value={row.projectId}>{projectDisplay(row)}</option>)}</select></label><label>Auto Payment No<input value={nextNo||"AUTO"} readOnly/></label><label>Payment Date<input name="paymentDate" type="date" defaultValue={localDate()} required disabled={busy}/></label><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required disabled={busy}/></label><label>Payment Method<select name="paymentMethod" defaultValue="" required disabled={busy}><option value="">Select payment method</option><option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Cheque</option></select></label><label>Cash / Bank Account<select name="cashBankAccountId" required defaultValue="" disabled={busy}>{cashBankOptions}</select></label><label className="form-wide">Reference<input name="reference" placeholder="Deposit / advance reference" disabled={busy}/></label><div className="form-wide"><button type="submit" disabled={busy} style={busy ? { opacity: 0.6, cursor: "not-allowed", filter: "grayscale(1)" } : undefined}>{busy?"Saving…":"Save Customer Advance Draft"}</button></div></form>}
  </>;
}