"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  billId: string;
  billNumber: string;
  poId: string;
  supplierId: string;
  outstandingAmount: number;
  status: string;
};

type Payment = { paymentId:string; paymentNumber?:string; amount?:number|string; status?:string; journalId?:string; againstDocumentId?:string; partyType?:string; partyId?:string; paymentType?:string; reference?:string; createdAt?:string };
const money=(value:unknown)=>`K${Number(value||0).toFixed(2)}`;
function createdValue(row:Payment){const t=new Date(row.createdAt||"").getTime();return Number.isFinite(t)?t:0;}

export default function SupplierInvoiceAdvanceAdjustment(props:Props){
  const router=useRouter();
  const[payments,setPayments]=useState<Payment[]>([]);
  const[loading,setLoading]=useState(true);
  const[busyId,setBusyId]=useState("");
  const[message,setMessage]=useState("");
  const postedInvoice=["POSTED","PARTLY_PAID"].includes(String(props.status||"").toUpperCase());
  const marker=`PO:${props.poId}|`;

  async function load(){
    if(!props.poId||!postedInvoice){setLoading(false);return;}
    setLoading(true);
    try{
      const response=await fetch("/api/erp/transactions",{cache:"no-store"});
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Supplier advance load failed");
      const rows=(body.payments||[]).filter((row:Payment)=>String(row.partyType||"")==="Supplier"&&String(row.paymentType||"").toUpperCase()==="PAY"&&String(row.partyId||"")===props.supplierId&&String(row.reference||"").startsWith(marker)&&String(row.status||"").toUpperCase()==="POSTED"&&Boolean(row.journalId)&&!String(row.againstDocumentId||"").trim());
      setPayments(rows);
    }catch(error){setMessage(error instanceof Error?error.message:"Supplier advance load failed");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[props.billId,props.poId,props.supplierId,props.status]);

  const totalAvailable=useMemo(()=>payments.reduce((sum,row)=>sum+Number(row.amount||0),0),[payments]);

  async function allocate(payment:Payment){
    const amount=Number(payment.amount||0);
    if(amount>props.outstandingAmount+0.001){setMessage(`${payment.paymentNumber||payment.paymentId} is ${money(amount)}, which is greater than this invoice outstanding ${money(props.outstandingAmount)}. Partial advance allocation needs a reconciliation split; this full advance is not posted automatically.`);return;}
    if(busyId)return;
    if(!window.confirm(`Adjust ${money(amount)} supplier advance ${payment.paymentNumber||payment.paymentId} against ${props.billNumber}?`))return;
    setBusyId(payment.paymentId);setMessage("Adjusting Supplier Advance against Supplier Invoice…");
    try{
      const response=await fetch("/api/erp/transactions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"allocateAdvance",payload:{paymentId:payment.paymentId,partyType:"Supplier",againstDocumentType:"Supplier Invoice",againstDocumentId:props.billId}})});
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||"Supplier advance adjustment failed");
      setMessage(`Supplier Advance ${payment.paymentNumber||payment.paymentId} adjusted successfully. Accounts Payable and Supplier Advances were reconciled.`);
      await load();router.refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"Supplier advance adjustment failed");}
    finally{setBusyId("");}
  }

  if(!props.poId||!postedInvoice)return null;
  return <section className="panel table-wrap no-print" style={{marginTop:20}}>
    <div className="form-title-row"><div><h3>Supplier Advance Adjustment</h3><p className="small">PO-linked posted advances are reconciled only after the Supplier Invoice is posted. Accounting: Dr Accounts Payable / Cr Supplier Advances. Any remaining invoice balance stays payable by normal Payment Entry.</p></div><span className="auto-badge">{loading?"Loading…":`${money(totalAvailable)} Available`}</span></div>
    {message&&<div className="status-banner" style={{marginTop:12}}>{message}</div>}
    <table className="data-table"><thead><tr><th>Advance Payment</th><th>Created</th><th>Advance Amount</th><th>Invoice Outstanding</th><th>Action</th></tr></thead><tbody>
      {!loading&&payments.length===0&&<tr><td colSpan={5}>No unallocated posted Supplier Advance linked to this Purchase Order.</td></tr>}
      {[...payments].sort((a,b)=>createdValue(b)-createdValue(a)).map((row)=>{const amount=Number(row.amount||0),tooLarge=amount>props.outstandingAmount+0.001;return <tr key={row.paymentId}><td><Link prefetch={false} href={`/transactions/payment/${encodeURIComponent(row.paymentId)}`}><strong>{row.paymentNumber||row.paymentId}</strong></Link></td><td>{row.createdAt?new Date(row.createdAt).toLocaleString("en-PG",{timeZone:"Pacific/Port_Moresby"}):"—"}</td><td>{money(amount)}</td><td>{money(props.outstandingAmount)}</td><td>{tooLarge?<span className="small"><strong>Needs partial allocation</strong><br/>Advance exceeds invoice outstanding.</span>:<button type="button" disabled={Boolean(busyId)} onClick={()=>void allocate(row)}>{busyId===row.paymentId?"Adjusting…":"Adjust Advance"}</button>}</td></tr>;})}
    </tbody></table>
  </section>;
}
