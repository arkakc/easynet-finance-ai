"use client";

import { useEffect, useState } from "react";
import SupplierAdvanceChainSummary from "@/app/components/supplier-advance-chain-summary";

type Props={
  billRef:string;
  supplierId:string;
};

export default function SupplierPaymentSettlementSummary({billRef,supplierId}:Props){
  const[bill,setBill]=useState<any|null>(null);
  const[loading,setLoading]=useState(true);

  useEffect(()=>{
    let active=true;
    void(async()=>{
      setLoading(true);
      try{
        const response=await fetch("/api/erp/transactions",{cache:"no-store"});
        const body=await response.json();
        if(!response.ok||!body.ok)throw new Error(body.error||"Supplier Invoice context load failed");
        const row=(body.supplierBills||[]).find((item:any)=>
          String(item.billId||"")===billRef||String(item.billNumber||"")===billRef
        )||null;
        if(active)setBill(row);
      }catch{
        if(active)setBill(null);
      }finally{
        if(active)setLoading(false);
      }
    })();
    return()=>{active=false;};
  },[billRef]);

  if(loading||!bill)return null;

  const poId=String(bill.poId||bill.sourceDocumentId||"").trim();
  if(!poId)return null;

  return <SupplierAdvanceChainSummary
    context="invoice"
    poId={poId}
    supplierId={String(bill.supplierId||supplierId||"")}
    billId={String(bill.billId||billRef)}
    billNumber={String(bill.billNumber||billRef)}
    billTotal={Number(bill.totalAmount||0)}
    billOutstanding={Number(bill.outstandingAmount||0)}
  />;
}
