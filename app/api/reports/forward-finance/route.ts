import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { buildFinancialStatements } from "@/lib/accounting/financial-statements";
import { buildCashFlowStatement } from "@/lib/accounting/cash-flow";
import { configuredFiscalYearStart } from "@/lib/accounting/financial-statements";
import { forecastCashByDueDate, partyAgeingSummary } from "@/lib/reporting/forward-finance";

export const runtime = "nodejs";
const params = z.object({
 asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 horizon: z.coerce.number().int().min(1).max(365).default(90),
});
export async function GET(request:NextRequest){
 try{
  await requirePermission("reports.read");
  const query=params.parse({asOf:request.nextUrl.searchParams.get("asOf"),horizon:request.nextUrl.searchParams.get("horizon")||90});
  const financials=await buildFinancialStatements({asOf:query.asOf});
  const from=await configuredFiscalYearStart(query.asOf);
  const cash=await buildCashFlowStatement({from,asOf:query.asOf});
  const receivables=financials.aging.receivables.rows;
  const payables=financials.aging.payables.rows;
  const forecasts=forecastCashByDueDate(cash.totals.closingCash,query.asOf,[
   ...receivables.map(x=>({kind:"AR" as const,dueDate:x.dueDate,outstanding:x.outstanding})),
   ...payables.map(x=>({kind:"AP" as const,dueDate:x.dueDate,outstanding:x.outstanding})),
  ],query.horizon);
  return NextResponse.json({ok:true,asOf:query.asOf,currency:financials.currency,ageing:{
    receivables:{...financials.aging.receivables,parties:partyAgeingSummary(receivables)},
    payables:{...financials.aging.payables,parties:partyAgeingSummary(payables)},
   },control:{receivables:financials.controls.receivables,payables:financials.controls.payables},
   forecast:{openingCash:cash.totals.closingCash,ledgerCashBalanced:cash.control.balanced,periods:forecasts,method:"Due-date scenario: assumes every posted outstanding AR is received and AP paid at its due date, including overdue amounts immediately. Not a statistical forecast; excludes payroll, future sales, unposted POs and other future cash flows."}});
 }catch(e){
  const message=e instanceof Error?e.message:"Forward reporting unavailable";
  return NextResponse.json({ok:false,error:message},{status:message==="Unauthorized"?401:message==="Forbidden"?403:e instanceof z.ZodError?400:500});
 }
}
