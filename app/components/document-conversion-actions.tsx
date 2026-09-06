"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

function today(){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Pacific/Port_Moresby",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

type InvoicePaymentContext={
  invoiceId:string;
  invoiceNumber:string;
  customerId:string;
  projectId:string;
  totalAmount:number;
  outstandingAmount:number;
};

function approvedPoLifecycle(status:string){
  return ["APPROVED","PART_RECEIVED","CONVERTED","BILL_CREATED","BILLED"].includes(status);
}

export default function DocumentConversionActions({type,id,status,documentNumber}:{type:string;id:string;status:string;documentNumber?:string}){
  const router=useRouter();
  const[message,setMessage]=useState("");
  const[busy,setBusy]=useState(false);
  const[paymentContext,setPaymentContext]=useState<InvoicePaymentContext|null>(null);

  const normalizedStatus=status.toUpperCase();
  const isSupplierQuote=type==="purchaseOrder"&&String(documentNumber||"").startsWith("SUPQ-");
  const canQuote=type==="quote"&&["APPROVED","CONVERTED"].includes(normalizedStatus);
  const canSupplierQuote=isSupplierQuote&&["APPROVED","CONVERTED"].includes(normalizedStatus);
  const canPo=type==="purchaseOrder"&&!isSupplierQuote&&approvedPoLifecycle(normalizedStatus);
  const canInvoicePayment=type==="invoice"&&normalizedStatus==="APPROVED";
  const canSupplierInvoicePayment=type==="supplierBill"&&normalizedStatus==="APPROVED";

  if(!canQuote&&!canSupplierQuote&&!canPo&&!canInvoicePayment&&!canSupplierInvoicePayment)return null;

  function openPurchaseReceipt(){
    router.push(`/stock?mode=movement&sourcePo=${encodeURIComponent(id)}`);
  }

  async function convert(){
    setBusy(true);setMessage("");
    try{
      if(canSupplierInvoicePayment){
        router.push(`/transactions?module=purchase&tab=purchasePayment&mode=create&sourceBill=${encodeURIComponent(id)}`);
        return;
      }
      if(canInvoicePayment){
        const r=await fetch(`/api/erp/invoice-payment-context?id=${encodeURIComponent(id)}`,{cache:"no-store"});
        const b=await r.json();
        if(!r.ok||!b.ok)throw new Error(b.error||"Unable to prepare payment entry");
        setPaymentContext(b.invoice);
        return;
      }
      if(canSupplierQuote){
        const r=await fetch("/api/erp/purchase-conversions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({supplierQuoteId:id})});
        const b=await r.json();
        if(!r.ok||!b.ok)throw new Error(b.error||"Conversion failed");
        router.push(`/transactions/purchaseOrder/${b.createdId}`);router.refresh();return;
      }
      const action=canQuote?"quoteToInvoice":"poToBill";
      const payload=canQuote?{quoteId:id,invoiceDate:today(),dueDate:"",revenueAccountId:"ACC-4100"}:{poId:id,billDate:today(),dueDate:"",costAccountId:"ACC-5100"};
      const r=await fetch("/api/erp/conversions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,payload})});
      const b=await r.json();
      if(!r.ok||!b.ok)throw new Error(b.error||"Conversion failed");
      router.push(`/transactions/${canQuote?"invoice":"supplierBill"}/${b.createdId}`);router.refresh();
    }catch(e){setMessage(e instanceof Error?e.message:"Conversion failed")}finally{setBusy(false)}
  }

  async function createPaymentDraft(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!paymentContext)return;
    setBusy(true);setMessage("");
    try{
      const f=new FormData(e.currentTarget);
      const amount=Number(f.get("amount")||0);
      if(!(amount>0))throw new Error("Payment amount must be greater than zero");
      if(amount>paymentContext.outstandingAmount+0.001)throw new Error("Payment amount cannot exceed invoice outstanding amount");
      const r=await fetch("/api/erp/transactions",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          action:"createPayment",
          payload:{
            paymentNumber:"",
            paymentType:"RECEIVE",
            partyType:"Customer",
            partyId:paymentContext.customerId,
            projectId:paymentContext.projectId||"",
            paymentDate:f.get("paymentDate"),
            amount,
            paymentMethod:f.get("paymentMethod"),
            cashBankAccountId:f.get("cashBankAccountId"),
            reference:f.get("reference")||"",
            againstDocumentType:"Sales Invoice",
            againstDocumentId:paymentContext.invoiceId,
          },
        }),
      });
      const b=await r.json();
      if(!r.ok||!b.ok)throw new Error(b.error||"Payment draft creation failed");
      router.push(`/transactions/payment/${b.result.recordId}`);
      router.refresh();
    }catch(e){setMessage(e instanceof Error?e.message:"Payment draft creation failed")}finally{setBusy(false)}
  }

  const buttonLabel=canSupplierInvoicePayment?"Create Payment Entry / Receipt":canInvoicePayment?"Create Payment Entry / Receipt":canQuote?"Create Sales Invoice":canSupplierQuote?"Create Purchase Order":"Create Supplier Invoice";

  return <div className="conversion-box no-print">
    <strong>Next Document</strong>
    <p className="small">Mapped actions keep source-document, Item Master, party and project linkage.</p>

    {!paymentContext&&canPo&&<div className="button-row">
      <button type="button" className="secondary" disabled={busy} onClick={openPurchaseReceipt}>Create Purchase Receipt / Goods Receipt</button>
      <button type="button" disabled={busy} onClick={convert}>{busy?"Loading…":"Create Supplier Invoice"}</button>
    </div>}

    {!paymentContext&&!canPo&&<button type="button" disabled={busy} onClick={convert}>{busy?"Loading…":buttonLabel}</button>}

    {paymentContext&&<form onSubmit={createPaymentDraft} className="form-grid" style={{marginTop:16}}>
      <label>Sales Invoice<input value={paymentContext.invoiceNumber||paymentContext.invoiceId} readOnly/></label>
      <label>Customer<input value={paymentContext.customerId} readOnly/></label>
      <label>Outstanding<input value={`K${Number(paymentContext.outstandingAmount||0).toFixed(2)}`} readOnly/></label>
      <label>Payment Date<input name="paymentDate" type="date" defaultValue={today()} required/></label>
      <label>Amount<input name="amount" type="number" min="0.01" max={paymentContext.outstandingAmount} step="0.01" defaultValue={paymentContext.outstandingAmount} required/></label>
      <label>Payment Method<select name="paymentMethod" defaultValue="" required><option value="">Select payment method</option><option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Cheque</option></select></label>
      <label>Cash / Bank Account<input name="cashBankAccountId" placeholder="e.g. ACC-1120" required/></label>
      <label>Reference<input name="reference" placeholder="Bank / receipt reference"/></label>
      <div className="form-wide button-row"><button type="button" className="secondary" disabled={busy} onClick={()=>setPaymentContext(null)}>Cancel</button><button type="submit" disabled={busy}>{busy?"Saving Draft…":"Save Payment Draft"}</button></div>
    </form>}
    {message&&<span className="small" style={{display:"block",marginTop:10}}>{message}</span>}
  </div>;
}
