import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requirePermission, type Permission } from "@/lib/auth";
import TransactionsWorkspaceV5 from "@/app/components/transactions-workspace-v5";

const documentTypes:Record<string,{module:"sales"|"purchase"|"expense";permission:Permission}>={
 salesQuote:{module:"sales",permission:"sales.read"},
 salesOrder:{module:"sales",permission:"sales.read"},
 deliveryNote:{module:"sales",permission:"sales.read"},
 salesInvoice:{module:"sales",permission:"sales.read"},
 salesPayment:{module:"sales",permission:"sales.read"},
 supplierQuote:{module:"purchase",permission:"purchase.read"},
 purchaseOrder:{module:"purchase",permission:"purchase.read"},
 purchaseReceipt:{module:"purchase",permission:"purchase.read"},
 supplierInvoice:{module:"purchase",permission:"purchase.read"},
 purchasePayment:{module:"purchase",permission:"purchase.read"},
 expense:{module:"expense",permission:"purchase.write"},
};
export default async function DocumentTypePage({params}:{params:Promise<{type:string}>}){
 const {type}=await params;
 const config=documentTypes[type];
 if(!config)notFound();
 await requirePermission(config.permission);
 return <Suspense fallback={<section className="panel">Loading document register…</section>}>
  <TransactionsWorkspaceV5 directDocumentType={type}/>
 </Suspense>;
}
