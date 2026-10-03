"use client";

import { useEffect, useState } from "react";
import CustomerAdvanceChainSummary from "@/app/components/customer-advance-chain-summary";

type Props={
  invoiceRef:string;
  customerId:string;
};

export default function CustomerReceiptSettlementSummary({invoiceRef,customerId}:Props){
  const[invoice,setInvoice]=useState<any|null>(null);
  const[sourceQuoteId,setSourceQuoteId]=useState("");
  const[loading,setLoading]=useState(true);

  useEffect(()=>{
    let active=true;
    void(async()=>{
      setLoading(true);
      try{
        const response=await fetch("/api/erp/transactions",{cache:"no-store"});
        const body=await response.json();
        if(!response.ok||!body.ok)throw new Error(body.error||"Sales Invoice context load failed");

        const row=(body.invoices||[]).find((item:any)=>
          String(item.invoiceId||"")===invoiceRef||String(item.invoiceNumber||"")===invoiceRef
        )||null;

        let quoteRef=String(row?.sourceQuoteId||"").trim();
        if(!quoteRef){
          const sourceRef=String(row?.sourceDocumentId||"").trim();
          const source=(body.quotes||[]).find((item:any)=>
            String(item.quoteId||"")===sourceRef||String(item.quoteNumber||"")===sourceRef
          );
          quoteRef=String(source?.sourceDocumentId||source?.sourceQuoteId||sourceRef||"").trim();
        }

        if(active){
          setInvoice(row);
          setSourceQuoteId(quoteRef);
        }
      }catch{
        if(active){
          setInvoice(null);
          setSourceQuoteId("");
        }
      }finally{
        if(active)setLoading(false);
      }
    })();
    return()=>{active=false;};
  },[invoiceRef]);

  if(loading||!invoice||!sourceQuoteId)return null;

  return <CustomerAdvanceChainSummary
    context="invoice"
    sourceQuoteId={sourceQuoteId}
    customerId={String(invoice.customerId||customerId||"")}
    invoiceId={String(invoice.invoiceId||invoiceRef)}
    invoiceNumber={String(invoice.invoiceNumber||invoiceRef)}
    invoiceTotal={Number(invoice.totalAmount||0)}
    invoiceOutstanding={Number(invoice.outstandingAmount||0)}
  />;
}
