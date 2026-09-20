"use client";

import { FormEvent, useEffect, useState } from "react";
import { FlowReturnPanel, notifyFlowDataChanged } from "@/app/components/flow-navigation";
import AccountPicker from "@/app/components/account-picker";

type AccountOption={accountId:string;accountCode:string;accountName:string;accountType:string;parentAccount?:string};
type Suggestion={revenueAccountId:string;costAccountId:string;revenueAccountLabel:string;costAccountLabel:string;confidence:number;reason:string;source:"AI"|"RULE_FALLBACK"};

export default function QuickItemCreatePage(){
  const[nextCode,setNextCode]=useState("Loading…");const[itemName,setItemName]=useState("");const[itemType,setItemType]=useState<"STOCK"|"SERVICE"|"NON_STOCK">("STOCK");const[uom,setUom]=useState("Each");const[revenueAccount,setRevenueAccount]=useState("");const[costAccount,setCostAccount]=useState("");const[deferredMonths,setDeferredMonths]=useState("0");const[taxCode,setTaxCode]=useState("GST");const[accounts,setAccounts]=useState<AccountOption[]>([]);const[busy,setBusy]=useState(false);const[aiBusy,setAiBusy]=useState(false);const[message,setMessage]=useState("");const[savedLabel,setSavedLabel]=useState("");

  useEffect(()=>{void (async()=>{try{const[stockResponse,refResponse]=await Promise.all([fetch("/api/stock?scope=items",{cache:"no-store"}),fetch("/api/erp/reference-options",{cache:"no-store"})]);const[stock,refs]=await Promise.all([stockResponse.json(),refResponse.json()]);if(!stockResponse.ok||!stock.ok)throw new Error(stock.error||"Item setup load failed");if(!refResponse.ok||!refs.ok)throw new Error(refs.error||"Account options load failed");setNextCode(stock.nextItemCode||"AUTO");setAccounts(refs.accounts||[]);}catch(error){setMessage(error instanceof Error?error.message:"Item setup load failed");}})();},[]);

  async function suggest(name=itemName,type=itemType){if(name.trim().length<2)return;setAiBusy(true);setMessage("AI is judging the Item Name and Type against the Chart of Accounts…");try{const response=await fetch("/api/erp/item-account-suggestion",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({itemName:name,itemType:type})});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"AI account suggestion failed");const s=body.suggestion as Suggestion;setRevenueAccount(s.revenueAccountId);setCostAccount(s.costAccountId);setMessage(`${s.source==="AI"?"AI":"Controlled fallback"} suggested ${s.revenueAccountLabel} and ${s.costAccountLabel}. ${Math.round(Number(s.confidence||0)*100)}% confidence · ${s.reason}. You can override before save.`);}catch(error){setMessage(error instanceof Error?error.message:"AI account suggestion failed");}finally{setAiBusy(false);}}

  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();if(busy||aiBusy)return;setBusy(true);setSavedLabel("");setMessage("Saving Item…");try{const response=await fetch("/api/erp/actions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({target:"stock",body:{action:"createItem",record:{itemName,itemType,uom,revenueAccount,costAccount,deferredRevenueMonths:Number(deferredMonths||0),taxCode}}})});const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error||"Item save failed");const row=body.row||body.result?.row||{};const id=String(row.itemId||row.itemCode||"");setMessage(`Item saved successfully${id?` · ${id}`:""}. Return to the previous document flow and select the new Item Master record.`);setSavedLabel("Item");notifyFlowDataChanged("item",id);setNextCode(String(row.itemCode||row.itemId||nextCode));}catch(error){setMessage(error instanceof Error?error.message:"Item save failed");}finally{setBusy(false);}}

  return <>
    <div className="page-head">
      <div>
        <h2>Create New Item Master</h2>
        <p className="small">Quick catalog item registration with AI-suggested Revenue and Cost/COGS chart of accounts.</p>
      </div>
      <div className="page-head-actions">
        {message && (
          <details className="system-notice-tab">
            <summary>
              <span>ℹ️ System Notice</span>
              <span className="notice-arrow">▾</span>
            </summary>
            <div className="system-notice-dropdown">
              <strong>Item setup notice:</strong> {message}
            </div>
          </details>
        )}
        <a className="button-link secondary-link" href="/stock">
          ← Items & Stock
        </a>
        <span className="badge">Catalog Setup</span>
      </div>
    </div>

    <div className="grid">
      <div className="card">
        <div className="label">GL Mapping Model</div>
        <div className="value small-value">AI Account Assist</div>
      </div>
      <div className="card">
        <div className="label">Tax Standard</div>
        <div className="value small-value">IRC 10% GST Ready</div>
      </div>
      <div className="card">
        <div className="label">Costing Model</div>
        <div className="value small-value">Moving Average Cost</div>
      </div>
      <div className="card">
        <div className="label">Creation Flow</div>
        <div className="value small-value">Cross-Tab Linked</div>
      </div>
    </div>

    <FlowReturnPanel savedLabel={savedLabel}/>
    <form className="panel form-grid" onSubmit={save}>
      <div className="form-wide form-title-row"><div><h3 style={{margin:0}}>New Item</h3><p className="small">AI suggests controlled Revenue and Cost/COGS posting accounts from the Item Name and Type.</p></div><span className="auto-badge">{aiBusy?"AI ANALYZING…":"FLOW QUICK ENTRY"}</span></div>
      <label>Item Code<input value={nextCode||"AUTO"} readOnly/></label>
      <label>Item Name<input value={itemName} onChange={event=>setItemName(event.target.value)} required disabled={busy}/></label>
      <label>Item Type<select value={itemType} onChange={event=>setItemType(event.target.value as typeof itemType)} required disabled={busy}><option value="STOCK">STOCK</option><option value="SERVICE">SERVICE</option><option value="NON_STOCK">NON-STOCK</option></select></label>
      <label>Default UOM<input value={uom} onChange={event=>setUom(event.target.value)} required disabled={busy}/></label>
      <label>Revenue Account<AccountPicker name="revenueAccount" value={revenueAccount} onChange={setRevenueAccount} accounts={accounts} kind="income" required disabled={busy||aiBusy} placeholder="Search revenue account name or code"/></label>
      <label>Cost / COGS Account<AccountPicker name="costAccount" value={costAccount} onChange={setCostAccount} accounts={accounts} kind="expense" required disabled={busy||aiBusy} placeholder="Search cost/COGS account name or code"/></label>
      <label>Moving Average Rate<input value="0.00" readOnly/><span className="small">Calculated from stock transactions.</span></label>
      <label>Deferred Revenue Months<input type="number" min="0" max="120" value={deferredMonths} onChange={event=>setDeferredMonths(event.target.value)} required disabled={busy}/></label>
      <label>Tax Code<input value={taxCode} onChange={event=>setTaxCode(event.target.value)} required disabled={busy}/></label>
      <div className="form-wide button-row"><button type="button" className="secondary" disabled={busy||aiBusy||itemName.trim().length<2} onClick={()=>void suggest()}>{aiBusy?"AI Analyzing…":"Suggest Posting Accounts"}</button><button type="submit" disabled={busy||aiBusy} style={(busy||aiBusy) ? { opacity: 0.6, cursor: "not-allowed", filter: "grayscale(1)" } : undefined}>{busy?"Saving…":"Save Item"}</button></div>
    </form>
  </>;
}
