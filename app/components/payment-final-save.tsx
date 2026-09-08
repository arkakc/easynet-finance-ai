"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PaymentRecord={
  paymentId:string;paymentNumber?:string;paymentType?:string;paymentDate?:string;amount?:number|string;paymentMethod?:string;cashBankAccountId?:string;reference?:string;
  againstDocumentType?:string;againstDocumentId?:string;sourceDocumentId?:string;partyType?:string;partyId?:string;projectId?:string;status?:string;journalId?:string;
};
type CashBankAccount={accountId:string;accountCode:string;accountName:string;balance:number};
type AdvanceSummary={allocatedAmount:number;remainingAmount:number;allocations:any[]};
const money=(value:unknown)=>`K${Number(value||0).toFixed(2)}`;
const eligibleStatus=(value:unknown)=>["POSTED","PARTLY_PAID"].includes(String(value||"").toUpperCase());
function localDate(){const p=new Intl.DateTimeFormat("en-US",{timeZone:"Pacific/Port_Moresby",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const v=Object.fromEntries(p.map(x=>[x.type,x.value]));return`${v.year}-${v.month}-${v.day}`;}
function marker(record:PaymentRecord,prefix:"SQ"|"PO"){const match=String(record.reference||"").match(new RegExp(`^${prefix}:([^|]+)\\|`));return match?.[1]||"";}
function partyLabel(record:PaymentRecord,masters:any){const id=String(record.partyId||"");if(!id)return"—";const rows=String(record.partyType||"")==="Supplier"?masters.suppliers||[]:masters.customers||[];const row=rows.find((item:any)=>String(item.supplierId||item.customerId||"")===id);const name=row?String(row.supplierName||row.customerName||id):id;return name!==id?`${name} (${id})`:id;}
function projectLabel(id:string,projects:any[]){if(!id)return"No project";const row=projects.find((item:any)=>String(item.projectId||"")===id);const name=row?String(row.projectName||id):id;return name!==id?`${name} (${id})`:id;}

export default function PaymentFinalSave({record}:{record:PaymentRecord}){
  const router=useRouter();
  const[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[documents,setDocuments]=useState<any[]>([]),[loadingDocs,setLoadingDocs]=useState(false),[accounts,setAccounts]=useState<CashBankAccount[]>([]),[masters,setMasters]=useState<any>({customers:[],suppliers:[],projects:[]});
  const[selectedAccountId,setSelectedAccountId]=useState(String(record.cashBankAccountId||"")),[amountValue,setAmountValue]=useState(Number(record.amount||0)),[journalId,setJournalId]=useState(String(record.journalId||""));
  const[advanceSummary,setAdvanceSummary]=useState<AdvanceSummary|null>(null),[allocationAmounts,setAllocationAmounts]=useState<Record<string,string>>({});
  const finalized=Boolean(journalId),approved=String(record.status||"").toUpperCase()==="APPROVED";
  const partyType=String(record.partyType||"");const customer=partyType==="Customer";const supplier=partyType==="Supplier";const pay=String(record.paymentType||"").toUpperCase()==="PAY";
  const refund=customer&&pay&&String(record.againstDocumentType||"").toLowerCase().includes("credit note");
  const advanceMode=finalized&&!refund&&!String(record.againstDocumentId||"").trim()&&((customer&&!pay)||(supplier&&pay));
  const selectedAccount=useMemo(()=>accounts.find(row=>row.accountId===selectedAccountId)||null,[accounts,selectedAccountId]);
  const insufficientFunds=pay&&selectedAccount?amountValue>Number(selectedAccount.balance||0)+0.001:false;
  const sourceId=String(record.sourceDocumentId||"").trim()||(customer?marker(record,"SQ"):supplier?marker(record,"PO"):"");

  useEffect(()=>{let active=true;void(async()=>{try{const[refResponse,masterResponse]=await Promise.all([fetch("/api/erp/reference-options",{cache:"no-store"}),fetch("/api/masters",{cache:"no-store"})]);const[refs,masterBody]=await Promise.all([refResponse.json(),masterResponse.json()]);if(!refResponse.ok||!refs.ok)throw new Error(refs.error||"Cash / Bank account list failed");if(!masterResponse.ok||!masterBody.ok)throw new Error(masterBody.error||"Master reference load failed");if(!active)return;setAccounts(refs.cashBankAccounts||[]);setMasters({customers:masterBody.customers||[],suppliers:masterBody.suppliers||[],projects:masterBody.projects||[]});if(!selectedAccountId&&refs.cashBankAccounts?.length)setSelectedAccountId(String(refs.cashBankAccounts[0].accountId||""));}catch(error){if(active)setMessage(error instanceof Error?error.message:"Reference data load failed");}})();return()=>{active=false;};},[]);

  async function loadAdvanceWorkspace(){
    if(!advanceMode)return;
    setLoadingDocs(true);
    try{
      const[summaryR,txR]=await Promise.all([fetch(`/api/erp/advance-allocation?paymentId=${encodeURIComponent(record.paymentId)}`,{cache:"no-store"}),fetch("/api/erp/transactions",{cache:"no-store"})]);
      const[summaryBody,tx]=await Promise.all([summaryR.json(),txR.json()]);
      if(!summaryR.ok||!summaryBody.ok)throw new Error(summaryBody.error||"Advance balance load failed");if(!txR.ok||!tx.ok)throw new Error(tx.error||"Open document load failed");
      const summary=summaryBody.summary as AdvanceSummary;setAdvanceSummary(summary);
      const source=customer?tx.invoices||[]:tx.supplierBills||[];const partyField=customer?"customerId":"supplierId";
      const rows=source.filter((row:any)=>String(row[partyField]||"")===String(record.partyId||"")&&eligibleStatus(row.status)&&Number(row.outstandingAmount??row.totalAmount??0)>0.001&&(sourceId?(customer?String(row.sourceDocumentId||"")===sourceId:String(row.poId||row.sourceDocumentId||"")===sourceId):true));
      setDocuments(rows);
      setAllocationAmounts(Object.fromEntries(rows.map((row:any)=>{const id=customer?row.invoiceId:row.billId;const max=Math.min(Number(summary.remainingAmount||0),Number(row.outstandingAmount??row.totalAmount??0));return[id,String(max)];})));
    }catch(error){setMessage(error instanceof Error?error.message:"Advance allocation workspace load failed");}finally{setLoadingDocs(false);}
  }
  useEffect(()=>{if(advanceMode)void loadAdvanceWorkspace();},[advanceMode,record.paymentId,sourceId]);

  async function finalSave(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(finalized||busy)return;
    if(insufficientFunds&&selectedAccount){setMessage(`Insufficient funds in ${selectedAccount.accountName} (${selectedAccount.accountId}). Available ${money(selectedAccount.balance)}, payment ${money(amountValue)}.`);return;}
    if(!window.confirm("Are you sure you want to finalize this Payment Entry? This will create the accounting effect.")){setMessage("Final Save cancelled. The form is still editable.");return;}
    setBusy(true);setMessage("Final Saving Payment Entry… Please wait until accounting posting is complete.");
    try{const form=new FormData(event.currentTarget);const response=await fetch("/api/erp/transactions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"finalizePayment",payload:{paymentId:record.paymentId,partyType:record.partyType,paymentDate:form.get("paymentDate"),amount:form.get("amount"),paymentMethod:form.get("paymentMethod"),cashBankAccountId:form.get("cashBankAccountId"),reference:form.get("reference")}})});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Final Save failed");const postedJournalId=String(body.result?.journalId||"");if(postedJournalId)setJournalId(postedJournalId);setMessage(body.result?.refund?"Customer Refund finalized successfully.":body.result?.advance?"Advance finalized successfully. It can now be allocated partially or fully to eligible posted invoices.":"Payment Entry finalized successfully.");router.refresh();}catch(error){setMessage(error instanceof Error?error.message:"Final Save failed");}finally{setBusy(false);}
  }

  async function allocate(document:any){
    if(!advanceSummary||busy)return;const documentId=String(customer?document.invoiceId:document.billId);const label=String(customer?document.invoiceNumber||documentId:document.billNumber||documentId);const outstanding=Number(document.outstandingAmount??document.totalAmount??0);const amount=Number(allocationAmounts[documentId]||0);
    if(!(amount>0)||amount>Number(advanceSummary.remainingAmount||0)+0.001||amount>outstanding+0.001){setMessage("Allocation amount must be greater than zero and cannot exceed the remaining advance or document outstanding.");return;}
    if(!window.confirm(`Allocate ${money(amount)} from ${record.paymentNumber||record.paymentId} to ${label}?`))return;
    setBusy(true);setMessage("Saving partial advance allocation…");
    try{const response=await fetch("/api/erp/advance-allocation",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paymentId:record.paymentId,partyType:record.partyType,againstDocumentType:customer?"Sales Invoice":"Supplier Invoice",againstDocumentId:documentId,amount,allocationDate:localDate()})});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Advance allocation failed");setMessage(`Allocated ${money(body.result.allocatedAmount)} to ${label}. Advance remaining ${money(body.result.remainingAdvance)}; document outstanding ${money(body.result.documentOutstanding)}.`);await loadAdvanceWorkspace();router.refresh();}catch(error){setMessage(error instanceof Error?error.message:"Advance allocation failed");}finally{setBusy(false);}
  }

  if(!approved&&!finalized)return null;
  const againstId=String(record.againstDocumentId||"");
  const navigation=<div className="button-row" style={{marginTop:14}}>
    {journalId&&<Link prefetch={false} className="button-link" href={`/journals/${encodeURIComponent(journalId)}`}>View Journal Entry · {journalId}</Link>}
    {refund&&againstId&&<Link prefetch={false} className="button-link secondary-link" href={`/transactions/invoice/${encodeURIComponent(againstId)}`}>← Back to Sales Credit Note</Link>}
    {!refund&&againstId&&customer&&<Link prefetch={false} className="button-link secondary-link" href={`/transactions/invoice/${encodeURIComponent(againstId)}`}>← Back to Sales Invoice</Link>}
    {againstId&&supplier&&<Link prefetch={false} className="button-link secondary-link" href={`/transactions/supplierBill/${encodeURIComponent(againstId)}`}>← Back to Supplier Invoice</Link>}
    {!againstId&&sourceId&&customer&&<Link prefetch={false} className="button-link secondary-link" href={`/transactions/quote/${encodeURIComponent(sourceId)}`}>← Back to Sales Quotation</Link>}
    {!againstId&&sourceId&&supplier&&<Link prefetch={false} className="button-link secondary-link" href={`/transactions/purchaseOrder/${encodeURIComponent(sourceId)}`}>← Back to Purchase Order</Link>}
  </div>;

  return <>
    <section className="panel no-print" style={{marginTop:20}}>
      <div className="form-title-row"><div><h3>{finalized?(refund?"Customer Refund Finalized":"Payment Entry Finalized"):"Approved Payment Entry — Final Review"}</h3><p className="small">{refund?"Controlled Customer Refund: Dr Customer Advances / Cr Cash or Bank.":advanceMode?(customer?"Customer Advance: Dr Cash/Bank / Cr Customer Advances. Allocation is recorded separately so one advance can settle multiple invoices.":"Supplier Advance: Dr Supplier Advances / Cr Cash/Bank. Allocation is recorded separately so one advance can settle multiple supplier invoices."):"Approval authorizes the transaction. Final Save creates its accounting effect."}</p></div><span className="auto-badge">{busy?"SAVING…":finalized?advanceMode?"FINALIZED ADVANCE":"FINALIZED":"APPROVED — EDITABLE"}</span></div>
      <form className="form-grid" onSubmit={finalSave} style={{marginTop:18}}>
        <label>Payment Entry No<input value={record.paymentNumber||record.paymentId} readOnly/></label>
        <label>Customer / Supplier<input value={partyLabel(record,masters)} readOnly/></label>
        <label>Against / Source Document<input value={`${record.againstDocumentType||""} ${againstId}`.trim()||(sourceId?`${customer?"Sales Quotation":"Purchase Order"} ${sourceId}`:advanceMode?"Unallocated Advance":"—")} readOnly/></label>
        <label>Project<input value={projectLabel(String(record.projectId||""),masters.projects||[])} readOnly/></label>
        <label>Payment Date<input name="paymentDate" type="date" defaultValue={String(record.paymentDate||"").slice(0,10)} required disabled={finalized||busy}/></label>
        <label>Amount<input name="amount" type="number" min="0.01" step="0.01" value={amountValue} onChange={e=>setAmountValue(Number(e.target.value||0))} required disabled={finalized||busy}/></label>
        <label>Payment Method<select name="paymentMethod" defaultValue={record.paymentMethod||""} required disabled={finalized||busy}><option value="">Select method</option><option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Cheque</option></select></label>
        <label>Cash / Bank Account<select name="cashBankAccountId" value={selectedAccountId} onChange={e=>setSelectedAccountId(e.target.value)} required disabled={finalized||busy}><option value="">Select Cash / Bank account</option>{accounts.map(account=><option key={account.accountId} value={account.accountId}>{account.accountName} ({account.accountId}) · Balance {money(account.balance)}</option>)}</select>{selectedAccount&&<span className="small">Available balance: <strong>{money(selectedAccount.balance)}</strong></span>}</label>
        <label className="form-wide">Reference<input name="reference" defaultValue={record.reference||""} placeholder="Bank / receipt reference" disabled={finalized||busy}/></label>
        {insufficientFunds&&selectedAccount&&<div className="form-wide status-banner">Insufficient funds: {selectedAccount.accountName} ({selectedAccount.accountId}) has {money(selectedAccount.balance)}, but this payment is {money(amountValue)}. Final Save is blocked.</div>}
        {!finalized&&<div className="form-wide"><button type="submit" disabled={busy||insufficientFunds||!selectedAccountId}>{busy?"Saving…":"Final Save"}</button></div>}
      </form>
      {message&&<div className="status-banner" style={{marginTop:14}}>{message}</div>}
      {navigation}
    </section>

    {advanceMode&&<section className="panel table-wrap no-print" style={{marginTop:20}}>
      <div className="form-title-row"><div><h3>Allocate Advance</h3><p className="small">Partial allocation is supported. The remaining advance stays available for later invoices from the same source document, or for any eligible invoice when this is a general advance.</p></div><span className="auto-badge">{loadingDocs?"Loading…":advanceSummary?`Remaining ${money(advanceSummary.remainingAmount)}`:"Advance"}</span></div>
      {advanceSummary&&<div className="document-meta" style={{marginTop:12}}><div><span>Advance Amount</span><strong>{money(record.amount)}</strong></div><div><span>Allocated</span><strong>{money(advanceSummary.allocatedAmount)}</strong></div><div><span>Unallocated Remaining</span><strong>{money(advanceSummary.remainingAmount)}</strong></div><div><span>Allocation Entries</span><strong>{advanceSummary.allocations?.length||0}</strong></div></div>}
      <table className="data-table" style={{marginTop:14}}><thead><tr><th>{customer?"Sales Invoice":"Supplier Invoice"}</th><th>Project</th><th>Total</th><th>Outstanding</th><th>Allocate Now</th><th>Action</th></tr></thead><tbody>
        {!loadingDocs&&documents.length===0&&<tr><td colSpan={6}>No eligible posted document with an outstanding balance is available for this advance.</td></tr>}
        {documents.map(row=>{const documentId=String(customer?row.invoiceId:row.billId);const number=customer?row.invoiceNumber:row.billNumber;const type=customer?"invoice":"supplierBill";const max=Math.min(Number(advanceSummary?.remainingAmount||0),Number(row.outstandingAmount??row.totalAmount??0));return<tr key={documentId}><td><Link prefetch={false} href={`/transactions/${type}/${encodeURIComponent(documentId)}`}><strong>{number||documentId}</strong></Link></td><td>{projectLabel(String(row.projectId||""),masters.projects||[])}</td><td>{money(row.totalAmount)}</td><td><strong>{money(row.outstandingAmount??row.totalAmount)}</strong></td><td><input type="number" min="0.01" max={max} step="0.01" value={allocationAmounts[documentId]??String(max)} onChange={e=>setAllocationAmounts(c=>({...c,[documentId]:e.target.value}))} disabled={busy||max<=0}/></td><td><button type="button" disabled={busy||max<=0||!(Number(allocationAmounts[documentId]??max)>0)} onClick={()=>void allocate(row)}>{busy?"Saving…":"Allocate Advance"}</button></td></tr>;})}
      </tbody></table>
    </section>}
  </>;
}