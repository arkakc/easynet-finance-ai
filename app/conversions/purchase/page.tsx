"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type SupplierQuote={poId:string;poNumber:string;supplierId:string;projectId?:string;totalAmount?:number|string;status?:string};
type PurchaseOrder={poId:string;poNumber:string;supplierId:string;projectId?:string;totalAmount?:number|string;status?:string};
type TxData={ok:boolean;supplierQuotes?:SupplierQuote[];purchaseOrders?:PurchaseOrder[];error?:string};

function localDate(){const d=new Date();const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Pacific/Port_Moresby",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${v.year}-${v.month}-${v.day}`;}

export default function PurchaseConversionsPage(){
  const router=useRouter();
  const [supplierQuotes,setSupplierQuotes]=useState<SupplierQuote[]>([]);
  const [purchaseOrders,setPurchaseOrders]=useState<PurchaseOrder[]>([]);
  const [selectedPoId,setSelectedPoId]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);

  async function load(){
    try{
      const response=await fetch("/api/erp/transactions");
      const body=await response.json() as TxData;
      if(!response.ok||!body.ok) throw new Error(body.error||"Transaction load failed");
      setSupplierQuotes((body.supplierQuotes||[]).filter(row=>["APPROVED","CONVERTED"].includes(String(row.status||"").toUpperCase())));
      setPurchaseOrders((body.purchaseOrders||[]).filter(row=>!["CANCELLED","CANCELED"].includes(String(row.status||"").toUpperCase())));
    }catch(error){setMessage(error instanceof Error?error.message:"Load failed");}
  }

  useEffect(()=>{void load();},[]);
  const selectedPo=useMemo(()=>purchaseOrders.find(row=>row.poId===selectedPoId),[purchaseOrders,selectedPoId]);

  async function supplierQuoteToPo(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setMessage("");
    try{
      const form=new FormData(event.currentTarget);
      const response=await fetch("/api/erp/purchase-conversions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({supplierQuoteId:form.get("supplierQuoteId")})});
      const body=await response.json();
      if(!response.ok||!body.ok) throw new Error(body.error||"Conversion failed");
      router.push(`/transactions/purchaseOrder/${body.createdId}`);router.refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"Conversion failed");}finally{setBusy(false);}
  }

  async function poToPayment(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setMessage("");
    try{
      const f=new FormData(event.currentTarget);
      const po=purchaseOrders.find(row=>row.poId===String(f.get("poId")||""));
      if(!po) throw new Error("Select a Purchase Order");
      const amount=Number(f.get("amount")||0);
      if(!(amount>0)) throw new Error("Payment amount must be greater than zero");
      const response=await fetch("/api/erp/transactions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"createPayment",payload:{paymentNumber:"",paymentType:"PAY",partyType:"Supplier",partyId:po.supplierId,projectId:po.projectId||"",paymentDate:f.get("paymentDate"),amount,paymentMethod:f.get("paymentMethod"),cashBankAccountId:f.get("cashBankAccountId"),againstDocumentType:"Purchase Order",againstDocumentId:po.poId,reference:f.get("reference")||""}})});
      const body=await response.json();
      if(!response.ok||!body.ok) throw new Error(body.error||"Purchase payment creation failed");
      router.push(`/transactions/payment/${body.result.recordId}`);router.refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"Purchase payment creation failed");}finally{setBusy(false);}
  }

  return <>
    <div className="page-heading"><div><h2>Purchase Document Conversions</h2><p className="small">Supplier Quotation → Purchase Order → Purchase Payment / Receipt.</p></div></div>
    {message&&<section className="panel"><strong>Status:</strong> {message}</section>}

    <form className="panel form-grid" onSubmit={supplierQuoteToPo}>
      <h3 className="form-title">Supplier Quotation → Purchase Order</h3>
      <label>Approved Supplier Quotation<select name="supplierQuoteId" required defaultValue=""><option value="" disabled>Select Supplier Quotation</option>{supplierQuotes.map(q=><option key={q.poId} value={q.poId}>{q.poNumber} · {q.supplierId} · K{Number(q.totalAmount||0).toFixed(2)}</option>)}</select></label>
      <div className="form-wide"><button type="submit" disabled={busy}>Create Purchase Order</button></div>
    </form>

    <form className="panel form-grid" onSubmit={poToPayment}>
      <h3 className="form-title">Purchase Order → Purchase Payment / Receipt</h3>
      <label>Purchase Order<select name="poId" required value={selectedPoId} onChange={e=>setSelectedPoId(e.target.value)}><option value="" disabled>Select Purchase Order</option>{purchaseOrders.map(po=><option key={po.poId} value={po.poId}>{po.poNumber} · {po.supplierId} · K{Number(po.totalAmount||0).toFixed(2)}</option>)}</select></label>
      <label>Payment Date<input name="paymentDate" type="date" required defaultValue={localDate()} /></label>
      <label>Amount<input key={selectedPoId||"none"} name="amount" type="number" min="0.01" step="0.01" required defaultValue={selectedPo?Number(selectedPo.totalAmount||0):undefined} /></label>
      <label>Method<select name="paymentMethod" defaultValue="Bank Transfer"><option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Cheque</option></select></label>
      <label>Cash / Bank Account<input name="cashBankAccountId" defaultValue="ACC-1110" required /></label>
      <label className="form-wide">Reference<input name="reference" placeholder="Bank ref / supplier payment ref" /></label>
      <div className="form-wide"><button type="submit" disabled={busy}>Create Purchase Payment</button></div>
    </form>
  </>;
}
