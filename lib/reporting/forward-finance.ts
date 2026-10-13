import type { AgingRow, AgingBucket } from "@/lib/accounting/financial-statements";
const round = (n:number) => Math.round((n + Number.EPSILON)*100)/100;
export function partyAgeingSummary(rows: AgingRow[]) {
 const parties = new Map<string,{partyCode:string;partyName:string;total:number;overdue:number;buckets:Record<AgingBucket,number>}>();
 for(const row of rows){
  const key=row.partyCode+"\u0000"+row.partyName;
  const x=parties.get(key)||{partyCode:row.partyCode,partyName:row.partyName,total:0,overdue:0,buckets:{"Current":0,"1-30":0,"31-60":0,"61-90":0,"90+":0}};
  x.total+=row.outstanding; x.buckets[row.bucket]+=row.outstanding;
  if(row.bucket!=="Current")x.overdue+=row.outstanding;
  parties.set(key,x);
 }
 return [...parties.values()].map(x=>({...x,total:round(x.total),overdue:round(x.overdue)})).sort((a,b)=>b.overdue-a.overdue);
}
export type ForecastOpenItem = { kind:"AR"|"AP"; dueDate:string|null; outstanding:number };
export function forecastCashByDueDate(openingCash:number,asOf:string,items:ForecastOpenItem[],days=90){
 if(!Number.isFinite(openingCash)||!/^\d{4}-\d{2}-\d{2}$/.test(asOf)||!Number.isInteger(days)||days<1||days>365)throw new Error("Invalid forecast parameters");
 const start=new Date(asOf+"T00:00:00Z");if(Number.isNaN(start.getTime())||start.toISOString().slice(0,10)!==asOf)throw new Error("Invalid forecast date");
 const periods=[30,60,90,180,365].filter(n=>n<=days);if(!periods.includes(days))periods.push(days);
 let cash=openingCash,prev=0;
 return periods.map(day=>{
  let incoming=0,outgoing=0;
  for(const item of items){
   if(!Number.isFinite(item.outstanding)||item.outstanding<0)throw new Error("Invalid outstanding amount");
   const due=item.dueDate?new Date(item.dueDate+"T00:00:00Z"):start;
   if(Number.isNaN(due.getTime()))throw new Error("Invalid due date");
   const delta=Math.max(0,Math.round((due.getTime()-start.getTime())/86400000));
   if(delta>prev&&delta<=day || (prev===0&&delta===0)){
    if(item.kind==="AR")incoming+=item.outstanding;else outgoing+=item.outstanding;
   }
  }
  cash=round(cash+incoming-outgoing);prev=day;
  return {day,expectedReceipts:round(incoming),expectedPayments:round(outgoing),projectedCash:cash};
 });
}
