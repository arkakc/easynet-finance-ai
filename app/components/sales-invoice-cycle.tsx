"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Props={invoiceId:string;record?:any};
type Payment={paymentId:string;paymentNumber?:string;paymentType?:string;partyType?:string;partyId?:string;projectId?:string;amount?:number|string;status?:string;journalId?:string;sourceDocumentId?:string;againstDocumentId?:string;reference?:string;createdAt?:string};
type AllocationSummary={allocatedAmount:number;remainingAmount:number;allocations:Array<{milestone?:string;amount?:number|string}>};
type CashBank={accountId:string;accountName:string;accountCode:string;balance:number};

const money=(value:unknown)=>`K${Number(value||0).toFixed(2)}`;
function localDate(){const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Pacific/Port_Moresby",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const v=Object.fromEntries(parts.map((p)=>[p.type,p.value]));return`${v.year}-${v.month}-${v.day}`;}
function isCreditNote(invoice:any){return String(invoice?.invoiceNumber||"").toUpperCase().startsWith("CN-");}
function createdValue(row:any){const t=new Date(row.createdAt||"").getTime();return Number.isFinite(t)?t:0;}

export default function SalesInvoiceCycle({invoiceId,record}:Props){
  const router=useRouter();
  const[invoice,setInvoice]=useState<any|null>(record||null),[contextLoading,setContextLoading]=useState(!record);
  const[payments,setPayments]=useState<Payment[]>([]),[summaries,setSummaries]=useState<Record<string,AllocationSummary>>({}),[allocationAmounts,setAllocationAmounts]=useState<Record<string,string>>({});
  const[advancesLoaded,setAdvancesLoaded]=useState(false),[returnLoaded,setReturnLoaded]=useState(false),[refundLoaded,setRefundLoaded]=useState(false);
  const[returnData,setReturnData]=useState<any|null>(null),[returnQty,setReturnQty]=useState<Record<string,string>>({}),[returnReason,setReturnReason]=useState("");
  const[refundData,setRefundData]=useState<any|null>(null),[cashBank,setCashBank]=useState<CashBank[]>([]),[refundAmount,setRefundAmount]=useState(""),[refundMethod,setRefundMethod]=useState(""),[refundAccount,setRefundAccount]=useState(""),[refundReference,setRefundReference]=useState("");
  const[busy,setBusy]=useState(""),[message,setMessage]=useState("");

  useEffect(()=>{
    if(record){setInvoice(record);setContextLoading(false);return;}
    let active=true;
    setContextLoading(true);
    void(async()=>{try{const response=await fetch(`/api/erp/sales-invoice-action-context?invoiceId=${encodeURIComponent(invoiceId)}`,{cache:"no-store"});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Sales Invoice action context load failed");if(active)setInvoice(body.invoice);}catch(error){if(active)setMessage(error instanceof Error?error.message:"Sales Invoice action context load failed");}finally{if(active)setContextLoading(false);}})();
    return()=>{active=false;};
  },[invoiceId,record]);

  const credit=isCreditNote(invoice);
  const status=String(invoice?.status||"").toUpperCase();
  const posted=["POSTED","PARTLY_PAID","PAID"].includes(status);
  const outstanding=Number(invoice?.outstandingAmount??invoice?.totalAmount??0);
  const sourceQuoteId=!credit?String(invoice?.sourceDocumentId||"").trim():"";
  const postedAdvances=payments.filter((row)=>String(row.status||"").toUpperCase()==="POSTED"&&Boolean(row.journalId));
  const totalAdvance=postedAdvances.reduce((sum,row)=>sum+Number(row.amount||0),0);
  const totalAllocated=Object.values(summaries).reduce((sum,row)=>sum+Number(row.allocatedAmount||0),0);
  const availableAdvance=Object.values(summaries).reduce((sum,row)=>sum+Number(row.remainingAmount||0),0);
  const thisInvoiceAdvance=Object.values(summaries).reduce((sum,row)=>sum+(row.allocations||[]).filter((a)=>String(a.milestone||"")===invoiceId).reduce((s,a)=>s+Number(a.amount||0),0),0);

  async function loadAdvances(){
    if(!invoice||!sourceQuoteId||busy)return;
    setBusy("advances");setMessage("Loading customer advances for this Sales Quotation…");
    try{
      const response=await fetch(`/api/erp/source-payments?sourceDocumentId=${encodeURIComponent(sourceQuoteId)}&partyType=Customer&partyId=${encodeURIComponent(String(invoice.customerId||""))}`,{cache:"no-store"});
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Customer advance lookup failed");
      const linked=(body.payments||[]).filter((row:Payment)=>String(row.paymentType||"").toUpperCase()==="RECEIVE");
      setPayments(linked);
      const finalized=linked.filter((row:Payment)=>String(row.status||"").toUpperCase()==="POSTED"&&Boolean(row.journalId));
      const next:Record<string,AllocationSummary>={};
      await Promise.all(finalized.map(async(row:Payment)=>{const r=await fetch(`/api/erp/advance-allocation?paymentId=${encodeURIComponent(row.paymentId)}`,{cache:"no-store"});const b=await r.json();if(r.ok&&b.ok)next[row.paymentId]=b.summary;}));
      setSummaries(next);
      setAllocationAmounts(Object.fromEntries(finalized.map((row:Payment)=>[row.paymentId,String(Math.min(Number(next[row.paymentId]?.remainingAmount||0),outstanding))])));
      setAdvancesLoaded(true);setMessage("");
    }catch(error){setMessage(error instanceof Error?error.message:"Customer advance lookup failed");}
    finally{setBusy("");}
  }

  async function loadReturn(){
    if(!invoice||!posted||credit||busy)return;
    setBusy("return-load");setMessage("Loading returnable quantities…");
    try{const response=await fetch(`/api/erp/sales-return?invoiceId=${encodeURIComponent(invoiceId)}`,{cache:"no-store"});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Sales Return data load failed");setReturnData(body);setReturnQty(Object.fromEntries((body.lines||[]).map((line:any)=>[line.itemId,"0"])));setReturnLoaded(true);setMessage("");}
    catch(error){setMessage(error instanceof Error?error.message:"Sales Return data load failed");}
    finally{setBusy("");}
  }

  async function loadRefund(){
    if(!invoice||!credit||status!=="POSTED"||busy)return;
    setBusy("refund-load");setMessage("Checking refundable customer credit…");
    try{
      const[refundR,refsR]=await Promise.all([fetch(`/api/erp/customer-refund?creditNoteId=${encodeURIComponent(invoiceId)}`,{cache:"no-store"}),fetch("/api/erp/reference-options",{cache:"no-store"})]);
      const[refundBody,refs]=await Promise.all([refundR.json(),refsR.json()]);
      if(!refundR.ok||!refundBody.ok)throw new Error(refundBody.error||"Customer refund balance load failed");
      if(!refsR.ok||!refs.ok)throw new Error(refs.error||"Cash / Bank account load failed");
      setRefundData(refundBody);setRefundAmount(String(refundBody.balance?.refundable||0));setCashBank(refs.cashBankAccounts||[]);if(refs.cashBankAccounts?.length)setRefundAccount((current)=>current||String(refs.cashBankAccounts[0].accountId||""));setRefundLoaded(true);setMessage("");
    }catch(error){setMessage(error instanceof Error?error.message:"Customer refund balance load failed");}
    finally{setBusy("");}
  }

  async function allocate(payment:Payment){
    if(!invoice||busy)return;const summary=summaries[payment.paymentId];const amount=Number(allocationAmounts[payment.paymentId]||0);
    if(!(amount>0)){setMessage("Allocation amount must be greater than zero.");return;}
    if(amount>Number(summary?.remainingAmount||0)+0.001||amount>outstanding+0.001){setMessage("Allocation exceeds available advance or invoice outstanding.");return;}
    setBusy(`alloc:${payment.paymentId}`);setMessage("Adjusting Customer Advance against Sales Invoice…");
    try{const response=await fetch("/api/erp/advance-allocation",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paymentId:payment.paymentId,partyType:"Customer",againstDocumentType:"Sales Invoice",againstDocumentId:invoiceId,amount,allocationDate:localDate()})});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Customer advance allocation failed");setMessage(`Advance ${payment.paymentNumber||payment.paymentId} allocated ${money(body.result.allocatedAmount)}. Remaining advance ${money(body.result.remainingAdvance)}; invoice outstanding ${money(body.result.documentOutstanding)}.`);setBusy("");await loadAdvances();router.refresh();return;}
    catch(error){setMessage(error instanceof Error?error.message:"Advance allocation failed");}finally{setBusy("");}
  }

  async function createReturn(){
    if(!returnData||busy)return;const lines=(returnData.lines||[]).map((line:any)=>({itemId:line.itemId,qty:Number(returnQty[line.itemId]||0)})).filter((line:any)=>line.qty>0);
    if(!lines.length){setMessage("Enter return / credit quantity for at least one item.");return;}
    if(returnReason.trim().length<8){setMessage("Enter a clear return / credit reason of at least 8 characters.");return;}
    if(!window.confirm("Create a DRAFT Sales Credit Note / Return? It will require approval before accounting and stock reversal."))return;
    setBusy("return");setMessage("Saving Sales Credit Note / Return Draft…");
    try{const response=await fetch("/api/erp/sales-return",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({invoiceId,returnDate:localDate(),reason:returnReason,lines})});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Sales Credit Note creation failed");router.push(`/transactions/invoice/${encodeURIComponent(body.creditNote.invoiceId)}?returnModule=sales&returnTab=salesInvoice&returnMode=list`);router.refresh();}
    catch(error){setMessage(error instanceof Error?error.message:"Sales Return creation failed");}finally{setBusy("");}
  }

  async function createRefund(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!refundData||busy)return;const amount=Number(refundAmount||0),available=Number(refundData.balance?.refundable||0);
    if(!(amount>0)||amount>available+0.001){setMessage(`Refund must be greater than zero and cannot exceed refundable credit ${money(available)}.`);return;}
    setBusy("refund");setMessage("Saving Customer Refund Payment Draft…");
    try{const response=await fetch("/api/erp/customer-refund",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({creditNoteId:invoiceId,paymentDate:localDate(),amount,paymentMethod:refundMethod,cashBankAccountId:refundAccount,reference:refundReference})});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Customer refund draft failed");router.push(`/transactions/payment/${encodeURIComponent(body.payment.paymentId)}?returnModule=sales&returnTab=salesInvoice&returnMode=list`);router.refresh();}
    catch(error){setMessage(error instanceof Error?error.message:"Customer refund draft failed");}finally{setBusy("");}
  }

  if(contextLoading)return <section className="conversion-box no-print"><strong>Sales Invoice Actions</strong><p className="small">Loading this Sales Invoice only…</p></section>;
  if(!invoice)return <section className="conversion-box no-print"><strong>Sales Invoice Actions</strong>{message&&<div className="status-banner" style={{marginTop:12}}>{message}</div>}</section>;

  return <section className="conversion-box no-print">
    <div className="form-title-row"><div><strong>{credit?"Sales Credit Note / Return Actions":"Sales Invoice Additional Actions"}</strong><p className="small">Nothing below is fetched automatically. Load only the advance, return or refund workflow you need.</p></div><span className="auto-badge">{status||"DRAFT"}</span></div>
    {message&&<div className="status-banner" style={{marginTop:12}}>{message}</div>}

    <div className="button-row" style={{marginTop:14}}>
      {!credit&&posted&&outstanding>0.001&&<Link prefetch={false} className="button-link" href={`/transactions?module=sales&tab=salesPayment&mode=create&sourceInvoice=${encodeURIComponent(invoiceId)}`}>Create / Receive Customer Payment</Link>}
      {!credit&&sourceQuoteId&&<Link prefetch={false} className="button-link secondary-link" href={`/transactions/quote/${encodeURIComponent(sourceQuoteId)}`}>← Back to Sales Quotation</Link>}
      {credit&&invoice.sourceDocumentId&&<Link prefetch={false} className="button-link secondary-link" href={`/transactions/invoice/${encodeURIComponent(String(invoice.sourceDocumentId))}`}>← Open Original Sales Invoice</Link>}
    </div>

    {!credit&&posted&&sourceQuoteId&&<div className="panel" style={{marginTop:18}}><div className="form-title-row"><div><h4>Customer Advance Allocation</h4><p className="small">Only quotation-linked advance receipts are queried when you click the button.</p></div><button type="button" className="secondary" disabled={Boolean(busy)} onClick={()=>void loadAdvances()}>{busy==="advances"?"Loading…":advancesLoaded?"Refresh Customer Advances":"Load Customer Advances"}</button></div>
      {advancesLoaded&&<><div className="document-meta" style={{marginTop:12}}><div><span>Quotation Advances Finalized</span><strong>{money(totalAdvance)}</strong></div><div><span>Allocated Across Invoices</span><strong>{money(totalAllocated)}</strong></div><div><span>Allocated to This Invoice</span><strong>{money(thisInvoiceAdvance)}</strong></div><div><span>Unallocated Advance</span><strong>{money(availableAdvance)}</strong></div></div>
      {postedAdvances.length===0&&<div className="small" style={{marginTop:12}}>No finalized customer advance is linked to this quotation.</div>}
      {outstanding>0.001&&postedAdvances.length>0&&<div className="table-wrap" style={{marginTop:12}}><table className="data-table"><thead><tr><th>Advance Receipt</th><th>Amount</th><th>Allocated</th><th>Remaining Advance</th><th>Allocate Now</th><th>Action</th></tr></thead><tbody>{[...postedAdvances].sort((a,b)=>createdValue(b)-createdValue(a)).map((row)=>{const summary=summaries[row.paymentId];if(!summary||summary.remainingAmount<=0.001)return null;const max=Math.min(summary.remainingAmount,outstanding);return <tr key={row.paymentId}><td><Link prefetch={false} href={`/transactions/payment/${encodeURIComponent(row.paymentId)}`}><strong>{row.paymentNumber||row.paymentId}</strong></Link></td><td>{money(row.amount)}</td><td>{money(summary.allocatedAmount)}</td><td>{money(summary.remainingAmount)}</td><td><input type="number" min="0.01" max={max} step="0.01" value={allocationAmounts[row.paymentId]??String(max)} onChange={(e)=>setAllocationAmounts((c)=>({...c,[row.paymentId]:e.target.value}))} disabled={Boolean(busy)}/></td><td><button type="button" disabled={Boolean(busy)||!(Number(allocationAmounts[row.paymentId]??max)>0)} onClick={()=>void allocate(row)}>{busy===`alloc:${row.paymentId}`?"Adjusting…":"Adjust Advance"}</button></td></tr>;})}</tbody></table></div>}</>}
    </div>}

    {!credit&&posted&&<div className="panel" style={{marginTop:18}}><div className="form-title-row"><div><h4>Sales Return / Credit Note</h4><p className="small">Return quantities are queried only when you need to prepare a return.</p></div><button type="button" className="secondary" disabled={Boolean(busy)} onClick={()=>void loadReturn()}>{busy==="return-load"?"Loading…":returnLoaded?"Refresh Returnable Qty":"Prepare Sales Return / Credit Note"}</button></div>
      {returnLoaded&&returnData&&<div className="table-wrap" style={{marginTop:12}}><table className="data-table"><thead><tr><th>Item</th><th>Sold Qty</th><th>Already Returned</th><th>Returnable</th><th>Return / Credit Qty</th></tr></thead><tbody>{(returnData.lines||[]).map((line:any)=><tr key={line.itemId}><td><strong>{line.itemCode}</strong><br/><span className="small">{line.itemName}</span></td><td>{line.soldQty} {line.uom}</td><td>{line.alreadyReturnedQty} {line.uom}</td><td>{line.returnableQty} {line.uom}</td><td><input type="number" min="0" max={line.returnableQty} step="0.0001" value={returnQty[line.itemId]??"0"} onChange={(e)=>setReturnQty((c)=>({...c,[line.itemId]:e.target.value}))} disabled={Boolean(busy)}/></td></tr>)}</tbody></table><div className="form-grid" style={{marginTop:12}}><label className="form-wide">Return / Credit Reason<textarea rows={2} value={returnReason} onChange={(e)=>setReturnReason(e.target.value)} placeholder="Example: Customer returned 2 routers due to confirmed product defect." disabled={Boolean(busy)}/></label><div className="form-wide"><button type="button" disabled={Boolean(busy)||returnReason.trim().length<8} onClick={()=>void createReturn()}>{busy==="return"?"Saving…":"Create Sales Credit Note / Return Draft"}</button></div></div>{(returnData.existingCreditNotes||[]).length>0&&<div style={{marginTop:12}}><strong>Existing Credit Notes:</strong> {(returnData.existingCreditNotes||[]).map((row:any,index:number)=><span key={row.invoiceId}>{index?", ":""}<Link prefetch={false} href={`/transactions/invoice/${encodeURIComponent(row.invoiceId)}`}>{row.invoiceNumber}</Link> ({row.status})</span>)}</div>}</div>}
    </div>}

    {credit&&status==="POSTED"&&<div className="panel" style={{marginTop:18}}><div className="form-title-row"><div><h4>Customer Credit / Refund</h4><p className="small">Refund balance and bank options are loaded only when requested.</p></div><button type="button" className="secondary" disabled={Boolean(busy)} onClick={()=>void loadRefund()}>{busy==="refund-load"?"Loading…":refundLoaded?"Refresh Refundable Credit":"Check Refundable Credit / Create Refund"}</button></div>
      {refundLoaded&&refundData&&<><div className="document-meta" style={{marginTop:12}}><div><span>Customer Credit Created</span><strong>{money(refundData.balance?.creditCreated||0)}</strong></div><div><span>Already Refunded</span><strong>{money(refundData.balance?.refunded||0)}</strong></div><div><span>Refundable Balance</span><strong>{money(refundData.balance?.refundable||0)}</strong></div></div>{Number(refundData.balance?.refundable||0)>0.001&&<form className="form-grid" style={{marginTop:14}} onSubmit={createRefund}><label>Refund Amount<input type="number" min="0.01" max={Number(refundData.balance?.refundable||0)} step="0.01" value={refundAmount} onChange={(e)=>setRefundAmount(e.target.value)} required disabled={Boolean(busy)}/></label><label>Payment Method<select value={refundMethod} onChange={(e)=>setRefundMethod(e.target.value)} required disabled={Boolean(busy)}><option value="">Select method</option><option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Cheque</option></select></label><label>Cash / Bank Account<select value={refundAccount} onChange={(e)=>setRefundAccount(e.target.value)} required disabled={Boolean(busy)}><option value="">Select Cash / Bank account</option>{cashBank.map((row)=><option key={row.accountId} value={row.accountId}>{row.accountName} ({row.accountId}) · Balance {money(row.balance)}</option>)}</select></label><label>Reference<input value={refundReference} onChange={(e)=>setRefundReference(e.target.value)} placeholder={`Refund reference for ${invoice.invoiceNumber}`} disabled={Boolean(busy)}/></label><div className="form-wide"><button type="submit" disabled={Boolean(busy)||!refundMethod||!refundAccount}>{busy==="refund"?"Saving…":"Create Customer Refund Payment Draft"}</button></div></form>}</>}
    </div>}
  </section>;
}
