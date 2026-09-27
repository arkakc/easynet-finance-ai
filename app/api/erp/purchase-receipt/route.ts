import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { ensureAccountingInfrastructure } from "@/lib/accounting/infrastructure";
import { loadConfiguredPostingAccounts } from "@/lib/accounting/finance-settings.server";
import { documentSeriesId } from "@/lib/accounting/document-numbering";
import { normalizeAccountingDate } from "@/lib/accounting/loan";
import { postPurchaseReceiptAtomic } from "@/lib/accounting/atomic-stock";
import { listTable } from "@/lib/backend/apps-script";
import { prisma } from "@/src/lib/prisma";

const createSchema=z.object({
  action:z.literal("createDraft"),
  purchaseOrderId:z.string().trim().min(1),
  receiptDate:z.string().trim().min(8),
});

const approveSchema=z.object({
  action:z.literal("approve"),
  receiptId:z.string().trim().min(1),
  warehouseId:z.string().trim().min(1),
  receiptDate:z.string().trim().min(8),
  lines:z.array(z.object({itemId:z.string().trim().min(1),qty:z.coerce.number().finite().positive()})).min(1),
});

const actionSchema=z.discriminatedUnion("action",[createSchema,approveSchema]);

function year(){
  return Number(new Intl.DateTimeFormat("en",{timeZone:"Pacific/Port_Moresby",year:"numeric"}).format(new Date()));
}

async function resolvePurchaseOrder(ref:string){
  return prisma.purchaseOrder.findFirst({
    where:{OR:[{id:ref},{code:ref}]},
    include:{
      supplier:{select:{code:true,name:true}},
      project:{select:{code:true,name:true}},
      lines:{include:{item:true},orderBy:{lineNo:"asc"}},
    },
  });
}

async function remainingStockLines(order:any){
  const itemIds=[...new Set((order.lines||[]).filter((line:any)=>line.item?.type==="GOOD"&&line.itemId).map((line:any)=>String(line.itemId)))];
  const result:any[]=[];
  for(const itemId of itemIds){
    const sourceLines=(order.lines||[]).filter((line:any)=>String(line.itemId||"")===itemId);
    const ordered=sourceLines.reduce((sum:number,line:any)=>sum+Number(line.quantity||0),0);
    const received=await prisma.stockMovement.aggregate({
      where:{itemId,type:"PURCHASE_RECEIPT",referenceId:{in:[order.id,order.code]}},
      _sum:{quantity:true},
    });
    const alreadyReceived=Number(received._sum.quantity||0);
    const remaining=Math.max(0,ordered-alreadyReceived);
    if(remaining<=0.0001)continue;
    const line=sourceLines[0];
    result.push({
      itemId,
      itemCode:line.item?.code||itemId,
      itemName:line.item?.name||line.description||itemId,
      itemType:"STOCK",
      uom:line.unit||line.item?.unit||"Each",
      orderedQty:ordered,
      alreadyReceivedQty:alreadyReceived,
      remainingQty:remaining,
      qty:remaining,
      rate:Number(line.unitPrice||0),
    });
  }
  return result;
}

function parseItems(value:any){
  if(!value)return[];
  try{return Array.isArray(value)?value:JSON.parse(String(value));}catch{return[];}
}

function mapReceipt(receipt:any,order:any,lines:any[]){
  return{
    receiptId:receipt.id,
    receiptNumber:receipt.code,
    receiptDate:receipt.receiptDate?.toISOString?.().slice(0,10)||String(receipt.receiptDate||"").slice(0,10),
    sourceDocumentId:receipt.purchaseOrderId,
    purchaseOrderId:receipt.purchaseOrderId,
    purchaseOrderNumber:order?.code||receipt.purchaseOrderId,
    supplierId:order?.supplier?.code||"",
    supplierName:order?.supplier?.name||"",
    projectId:order?.project?.code||"",
    projectName:order?.project?.name||"",
    status:String(receipt.status||"DRAFT").toUpperCase(),
    warehouseId:receipt.warehouseId||"",
    journalId:receipt.journalId||"",
    note:receipt.note||"",
    totalAmount:Number(order?.total||0),
    createdAt:receipt.createdAt?.toISOString?.()||String(receipt.createdAt||""),
    approvedAt:receipt.approvedAt?.toISOString?.()||"",
    lines,
  };
}

async function legacyReceipts(){
  const movements=await listTable<any>("StockMovements",500,0);
  const grouped=new Map<string,any>();
  for(const movement of movements.rows||[]){
    if(String(movement.movementType||"").toUpperCase()!=="PURCHASE_RECEIPT")continue;
    const movementId=String(movement.movementId||"");
    const receiptNumber=movementId.replace(/-\d{3}$/,"")||movementId;
    const sourceDocumentId=String(movement.sourceDocumentId||"");
    const current=grouped.get(receiptNumber)||{
      receiptId:receiptNumber,receiptNumber,receiptDate:String(movement.movementDate||movement.createdAt||"").slice(0,10),
      sourceDocumentId,purchaseOrderId:sourceDocumentId,status:"POSTED",warehouseId:String(movement.warehouseId||""),
      journalId:String(movement.journalId||""),createdAt:movement.createdAt||movement.movementDate||"",approvedAt:movement.createdAt||movement.movementDate||"",
      totalAmount:0,lines:[],legacyPosted:true,receivedByItem:{},
    };
    current.totalAmount+=Number(movement.value||0);
    const movementItemId=String(movement.itemId||"");
    if(movementItemId)current.receivedByItem[movementItemId]=(Number(current.receivedByItem[movementItemId]||0)+Number(movement.qtyIn||0));
    if(!current.journalId&&movement.journalId)current.journalId=String(movement.journalId);
    grouped.set(receiptNumber,current);
  }
  for(const row of grouped.values()){
    const order=await resolvePurchaseOrder(String(row.purchaseOrderId||""));
    if(order){
      row.purchaseOrderNumber=order.code;
      row.supplierId=order.supplier?.code||"";
      row.supplierName=order.supplier?.name||"";
      row.projectId=order.project?.code||"";
      row.projectName=order.project?.name||"";
      row.totalAmount=Number(order.total||row.totalAmount||0);
      const sourceByItem=new Map<string,any>();
      for(const line of (order.lines||[]).filter((line:any)=>line.item?.type==="GOOD"&&line.itemId)){
        const itemId=String(line.itemId);
        const current=sourceByItem.get(itemId)||{line,orderedQty:0};
        current.orderedQty+=Number(line.quantity||0);
        sourceByItem.set(itemId,current);
      }
      row.lines=[...sourceByItem.entries()].filter(([itemId])=>Number(row.receivedByItem?.[itemId]||0)>0).map(([itemId,value]:any)=>({
        lineId:value.line.id,itemId,itemCode:value.line.item?.code||itemId,itemName:value.line.item?.name||value.line.description||"",
        itemType:"STOCK",uom:value.line.unit||value.line.item?.unit||"Each",orderedQty:Number(value.orderedQty||0),qty:Number(row.receivedByItem?.[itemId]||0),
      }));
      delete row.receivedByItem;
    }
  }
  return [...grouped.values()];
}

export async function GET(request:Request){
  try{
    await requirePermission("purchase.read");
    const id=new URL(request.url).searchParams.get("id")?.trim()||"";
    if(!id){
      const [persisted,legacy]=await Promise.all([prisma.purchaseReceipt.findMany({orderBy:{createdAt:"desc"}}),legacyReceipts()]);
      const mapped=await Promise.all(persisted.map(async receipt=>{
        const order=await resolvePurchaseOrder(receipt.purchaseOrderId);
        const stored=parseItems(receipt.items);
        return mapReceipt(receipt,order,stored);
      }));
      const byNumber=new Map(mapped.map((row:any)=>[String(row.receiptNumber),row]));
      for(const row of legacy)if(!byNumber.has(String(row.receiptNumber)))byNumber.set(String(row.receiptNumber),row);
      const purchaseReceipts=[...byNumber.values()].sort((a:any,b:any)=>new Date(b.createdAt||b.receiptDate||0).getTime()-new Date(a.createdAt||a.receiptDate||0).getTime());
      return NextResponse.json({ok:true,purchaseReceipts});
    }

    const receipt=await prisma.purchaseReceipt.findFirst({where:{OR:[{id},{code:id}]}});
    if(receipt){
      const order=await resolvePurchaseOrder(receipt.purchaseOrderId);
      if(!order)throw new Error("Source Purchase Order not found");
      return NextResponse.json({ok:true,purchaseReceipt:mapReceipt(receipt,order,parseItems(receipt.items))});
    }

    const legacy=(await legacyReceipts()).find((row:any)=>String(row.receiptId)===id||String(row.receiptNumber)===id);
    if(!legacy)throw new Error("Purchase Receipt / GRN not found");
    return NextResponse.json({ok:true,purchaseReceipt:legacy,legacy:true});
  }catch(error){
    const message=error instanceof Error?error.message:"Purchase Receipt / GRN load failed";
    return NextResponse.json({ok:false,error:message},{status:message==="Forbidden"?403:message==="Unauthorized"?401:400});
  }
}

export async function POST(request:Request){
  try{
    await requirePermission("purchase.write");
    const input=actionSchema.parse(await request.json());

    if(input.action==="createDraft"){
      const order=await resolvePurchaseOrder(input.purchaseOrderId);
      if(!order||String(order.code||"").toUpperCase().startsWith("SUPQ-"))throw new Error("Purchase Receipt source must be a valid Purchase Order");
      if(!["SENT","PARTIAL_RECEIVED","RECEIVED","BILLED"].includes(String(order.status||"").toUpperCase()))throw new Error("Purchase Receipt can only be created from an approved Purchase Order");

      const existing=await prisma.purchaseReceipt.findFirst({where:{purchaseOrderId:order.id,status:"DRAFT"},orderBy:{createdAt:"desc"}});
      if(existing)return NextResponse.json({ok:true,purchaseReceipt:mapReceipt(existing,order,parseItems(existing.items)),existing:true,message:"Existing Draft Purchase Receipt opened."});

      const lines=await remainingStockLines(order);
      if(!lines.length)throw new Error("No remaining STOCK quantity is available to receive for this Purchase Order");
      const created=await prisma.purchaseReceipt.create({data:{
        code:documentSeriesId("PR",year()),purchaseOrderId:order.id,
        receiptDate:new Date(input.receiptDate.slice(0,10)+"T00:00:00+10:00"),status:"DRAFT",
        items:JSON.stringify(lines),createdBy:"purchase-receipt",
      }});
      return NextResponse.json({ok:true,purchaseReceipt:mapReceipt(created,order,lines),message:"Draft Purchase Receipt / GRN created. Select warehouse and complete receipt to post stock and GRNI."});
    }

    const receipt=await prisma.purchaseReceipt.findFirst({where:{OR:[{id:input.receiptId},{code:input.receiptId}]}});
    if(!receipt)throw new Error("Purchase Receipt / GRN not found");
    if(String(receipt.status||"").toUpperCase()==="POSTED"){
      const order=await resolvePurchaseOrder(receipt.purchaseOrderId);
      return NextResponse.json({ok:true,purchaseReceipt:mapReceipt(receipt,order,parseItems(receipt.items)),existing:true,message:"Purchase Receipt / GRN is already submitted."});
    }
    if(String(receipt.status||"").toUpperCase()!=="DRAFT")throw new Error("Only a Draft Purchase Receipt / GRN can be completed");

    const order=await resolvePurchaseOrder(receipt.purchaseOrderId);
    if(!order)throw new Error("Source Purchase Order not found");
    const remaining=await remainingStockLines(order);
    const remainingMap=new Map(remaining.map((line:any)=>[String(line.itemId),Number(line.remainingQty||0)]));
    for(const line of input.lines){
      const max=Number(remainingMap.get(String(line.itemId))||0);
      if(!(max>0))throw new Error("Selected item has no remaining receivable quantity");
      if(Number(line.qty)>max+0.0001)throw new Error("Receipt quantity exceeds remaining Purchase Order quantity");
    }

    await ensureAccountingInfrastructure();
    const defaults=await loadConfiguredPostingAccounts();
    const result=await postPurchaseReceiptAtomic({
      receiptNumber:receipt.code,
      postingDate:normalizeAccountingDate(input.receiptDate),
      purchaseOrderRef:receipt.purchaseOrderId,
      warehouseRef:input.warehouseId,
      lines:input.lines.map(line=>({itemRef:line.itemId,qty:Number(line.qty)})),
      inventoryAccountId:defaults.defaultInventoryAccount,
      grniAccountId:defaults.stockReceivedButNotBilledAccount,
      createdBy:"purchase-receipt",
      approvedBy:"Finance Controller",
    });

    const submittedLines=input.lines.map(line=>{
      const source=remaining.find((x:any)=>String(x.itemId)===String(line.itemId));
      return{...source,qty:Number(line.qty)};
    });
    const updated=await prisma.purchaseReceipt.update({where:{id:receipt.id},data:{
      receiptDate:new Date(input.receiptDate.slice(0,10)+"T00:00:00+10:00"),status:"POSTED",
      warehouseId:result.warehouse.id,journalId:result.journalId||null,items:JSON.stringify(submittedLines),
      approvedBy:"Finance Controller",approvedAt:new Date(),
    }});

    const refreshedOrder=await resolvePurchaseOrder(receipt.purchaseOrderId);
    return NextResponse.json({ok:true,purchaseReceipt:mapReceipt(updated,refreshedOrder,submittedLines),posting:result,message:"Purchase Receipt / GRN submitted. Stock In and Inventory / GRNI ledger posting completed."});
  }catch(error){
    const message=error instanceof z.ZodError?error.errors.map(entry=>entry.path.join(".")+": "+entry.message).join("; "):error instanceof Error?error.message:"Purchase Receipt / GRN action failed";
    return NextResponse.json({ok:false,error:message},{status:message==="Forbidden"?403:message==="Unauthorized"?401:400});
  }
}
