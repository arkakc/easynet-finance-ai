import PurchaseReceiptClient from "@/app/components/purchase-receipt-client";

export default async function PurchaseReceiptPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  return <PurchaseReceiptClient id={id}/>;
}
