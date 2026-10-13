import test from "node:test";
import assert from "node:assert/strict";
import { partyAgeingSummary, forecastCashByDueDate } from "../../lib/reporting/forward-finance";
test("party ageing groups overdue and current balances without dropping document amounts",()=>{
 const rows=[
 {id:"1",code:"I1",partyCode:"C",partyName:"Customer",dueDate:"2026-09-01",overdueDays:42,bucket:"31-60" as const,outstanding:60},
 {id:"2",code:"I2",partyCode:"C",partyName:"Customer",dueDate:"2026-12-01",overdueDays:0,bucket:"Current" as const,outstanding:40},
 ];
 const result=partyAgeingSummary(rows);
 assert.equal(result[0].total,100);assert.equal(result[0].overdue,60);assert.equal(result[0].buckets.Current,40);
});
test("due-date scenario rolls overdue AR and future AP into correct time windows",()=>{
 const x=forecastCashByDueDate(100,"2026-10-13",[
  {kind:"AR",dueDate:"2026-10-01",outstanding:50},
  {kind:"AP",dueDate:"2026-10-25",outstanding:20},
  {kind:"AP",dueDate:"2026-12-01",outstanding:40},
 ],90);
 assert.deepEqual(x.map(p=>p.projectedCash),[130,90,90]);
});
test("zero-revenue or undated invoices are due immediately in scenario",()=>{
 const x=forecastCashByDueDate(0,"2026-10-13",[{kind:"AR",dueDate:null,outstanding:12}],30);
 assert.equal(x[0].projectedCash,12);
});
test("invalid balances fail instead of presenting inaccurate forecasts",()=>{
 assert.throws(()=>forecastCashByDueDate(0,"2026-10-13",[{kind:"AR",dueDate:null,outstanding:NaN}],30),/Invalid outstanding/);
});
