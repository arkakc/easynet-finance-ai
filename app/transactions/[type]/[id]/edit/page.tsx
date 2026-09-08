import { notFound } from "next/navigation";
import { findRecords, listTable } from "@/lib/backend/apps-script";
import { requirePermission, type Permission } from "@/lib/auth";
import DraftDocumentEditorV2 from "@/app/components/draft-document-editor-v2";

const CONFIG: Record<string, { table:string; idField:string; numberField:string; lineTable?:string; parentField?:string; permission:Permission }> = {
  quote:{table:"Quotes",idField:"quoteId",numberField:"quoteNumber",lineTable:"QuoteLines",parentField:"quoteId",permission:"sales.write"},
  purchaseOrder:{table:"PurchaseOrders",idField:"poId",numberField:"poNumber",lineTable:"POLines",parentField:"poId",permission:"purchase.write"},
  supplierBill:{table:"SupplierBills",idField:"billId",numberField:"billNumber",lineTable:"SupplierBillLines",parentField:"billId",permission:"purchase.write"},
  payment:{table:"Payments",idField:"paymentId",numberField:"paymentNumber",permission:"dashboard.read"},
  expense:{table:"Expenses",idField:"expenseId",numberField:"expenseNumber",permission:"purchase.write"},
};

export default async function EditDraftDocumentPage({params}:{params:Promise<{type:string;id:string}>}){
  const{type,id}=await params;const config=CONFIG[type];if(!config)notFound();await requirePermission(config.permission);
  const[recordResult,lineResult,itemResult,customerResult,supplierResult,projectResult]=await Promise.all([
    findRecords<any>(config.table,{[config.idField]:id},1),
    config.lineTable&&config.parentField?findRecords<any>(config.lineTable,{[config.parentField]:id},500):Promise.resolve({rows:[] as any[]}),
    config.lineTable?listTable<any>("Items",500,0):Promise.resolve({rows:[] as any[]}),
    listTable<any>("Customers",500,0),listTable<any>("Suppliers",500,0),listTable<any>("Projects",500,0),
  ]);
  const record=recordResult.rows[0];if(!record)notFound();if(String(record.status||"DRAFT").toUpperCase()!=="DRAFT")notFound();if(String(record.journalId||"").trim())notFound();if(Number(record.paidAmount||0)>0.0001)notFound();
  if(type==="payment"){if(String(record.partyType||"")==="Supplier")await requirePermission("purchase.write");else await requirePermission("sales.write");}
  const number=String(record[config.numberField]||id);const isSupplierQuotation=type==="purchaseOrder"&&number.startsWith("SUPQ-");
  return <DraftDocumentEditorV2 type={type as "quote"|"purchaseOrder"|"supplierBill"|"payment"|"expense"} id={id} number={number} record={record} sourceLines={lineResult.rows||[]} items={itemResult.rows||[]} customers={customerResult.rows||[]} suppliers={supplierResult.rows||[]} projects={projectResult.rows||[]} isSupplierQuotation={isSupplierQuotation}/>;
}
