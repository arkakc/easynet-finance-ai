import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";
export default async function BulkInvoiceHistoryPage(){
 await requirePermission("audit.read");
 const entries=await prisma.auditLog.findMany({where:{entityType:"SalesInvoiceBulk",action:"BULK_CONVERT"},orderBy:{createdAt:"desc"},take:300});
 const rows=entries.map(entry=>{
  let metadata:Record<string,unknown>={};
  try{metadata=JSON.parse(entry.metadata||"{}");}catch{}
  return {id:entry.id,createdAt:entry.createdAt,batchId:String(metadata.batchId||""),sourceId:entry.entityId||"",
   destinationId:String(metadata.destinationId||""),number:entry.entityCode||"",result:String(metadata.result||entry.outcome),message:entry.description||""};
 });
 return <div><div className="page-head"><div><h2>Bulk Invoice Batch History</h2><p className="small">Read-only, recorded invoice batch outcomes. Audit permission required.</p></div></div>
 <section className="panel"><p className="small"><Link href="/sales/bulk-invoices">Back to Bulk Sales Invoices</Link> · Most recent 300 audit entries</p>
 <div className="table-wrap"><table><thead><tr><th>Recorded</th><th>Batch ID</th><th>Source Order</th><th>Result</th><th>Invoice</th><th>Details</th></tr></thead><tbody>
 {rows.map(row=><tr key={row.id}><td>{row.createdAt.toISOString()}</td><td>{row.batchId}</td><td>{row.sourceId}</td><td>{row.result}</td><td>{row.destinationId?<Link href={"/transactions/salesInvoice/"+encodeURIComponent(row.destinationId)}>{row.number||row.destinationId}</Link>:"—"}</td><td>{row.message}</td></tr>)}
 {!rows.length&&<tr><td colSpan={6}>No recorded bulk invoice conversions.</td></tr>}
 </tbody></table></div></section></div>;
}
