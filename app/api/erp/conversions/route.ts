import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requirePermission } from "@/lib/auth";
import { listTable } from "@/lib/backend/apps-script";
import { POST as legacyPost } from "@/app/api/conversions/route";

function year(){return new Intl.DateTimeFormat("en",{timeZone:"Pacific/Port_Moresby",year:"numeric"}).format(new Date())}
async function nextNumber(table:string,field:string,prefix:string){const p=`${prefix}-${year()}-`;const rows=await listTable<any>(table,500,0);const max=rows.rows.reduce((m,row)=>{const v=String(row[field]||"");if(!v.startsWith(p))return m;const n=Number(v.slice(p.length));return Number.isInteger(n)&&n>m?n:m},0);return `${p}${String(max+1).padStart(5,"0")}`}

export async function POST(request:Request){try{const body=await request.json() as{action?:"quoteToInvoice"|"poToBill";payload?:Record<string,unknown>};if(!body.action)return NextResponse.json({ok:false,error:"Conversion action is required"},{status:400});await requirePermission(body.action==="quoteToInvoice"?"sales.write":"purchase.write");if(!env.APP_SECRET)throw new Error("Server compatibility credential is not configured");let payload=body.payload||{};if(body.action==="quoteToInvoice"&&!String(payload.invoiceNumber||"").trim())payload={...payload,invoiceNumber:await nextNumber("Invoices","invoiceNumber","SI")};if(body.action==="poToBill"&&!String(payload.billNumber||"").trim())payload={...payload,billNumber:await nextNumber("SupplierBills","billNumber","PB")};return legacyPost(new Request(request.url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:body.action,payload,secret:env.APP_SECRET})}))}catch(error){const message=error instanceof Error?error.message:"Conversion failed";return NextResponse.json({ok:false,error:message},{status:message==="Forbidden"?403:message==="Unauthorized"?401:400})}}
