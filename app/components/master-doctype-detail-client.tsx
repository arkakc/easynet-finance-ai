"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { notifyFlowDataChanged } from "@/app/components/flow-navigation";
import type { MasterType } from "@/app/components/quick-master-modal";

type MasterRow = Record<string, unknown>;

type Props = {
  type: MasterType;
  recordId: string;
};

const CONFIG: Record<MasterType, {
  title: string;
  scope: string;
  rowsKey: "customers" | "suppliers" | "projects";
  idKey: string;
  nameKey: string;
  listHref: string;
}> = {
  customer: { title: "Customer", scope: "customer", rowsKey: "customers", idKey: "customerId", nameKey: "customerName", listHref: "/customers" },
  supplier: { title: "Supplier", scope: "supplier", rowsKey: "suppliers", idKey: "supplierId", nameKey: "supplierName", listHref: "/suppliers" },
  project: { title: "Project", scope: "project", rowsKey: "projects", idKey: "projectId", nameKey: "projectName", listHref: "/projects/master" },
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function dateValue(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? String(parsed) : "0";
}

function activeText(value: unknown) {
  return value === false || String(value).toLowerCase() === "false" ? "Inactive" : "Active";
}

function displayDate(value: unknown) {
  const raw = text(value);
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("en-PG");
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-PG",{style:"currency",currency:"PGK",minimumFractionDigits:2}).format(Number(value||0));
}

export default function MasterDoctypeDetailClient({ type, recordId }: Props) {
  const router = useRouter();
  const config = CONFIG[type];
  const [record, setRecord] = useState<MasterRow | null>(null);
  const [customers, setCustomers] = useState<Array<{ customerId: string; customerName: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [financial, setFinancial] = useState<any | null>(null);
  const [financialLoading, setFinancialLoading] = useState(false);
  const [documentSearch, setDocumentSearch] = useState("");
  const [documentType, setDocumentType] = useState("ALL");
  const [documentStatus, setDocumentStatus] = useState("ALL");
  const [documentPage, setDocumentPage] = useState(1);
  const DOCUMENT_PAGE_SIZE = 25;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/masters/scoped?scope=${encodeURIComponent(config.scope)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || `${config.title} load failed`);
      const rows = Array.isArray(body[config.rowsKey]) ? body[config.rowsKey] as MasterRow[] : [];
      const found = rows.find((row) => {
        const publicId = text(row[config.idKey]);
        const internalId = text(row[`internal${config.title}Id`]);
        const code = text(row[`${type}Code`]);
        return [publicId, internalId, code].some((value) => value && value.toLowerCase() === recordId.toLowerCase());
      });
      if (!found) throw new Error(`${config.title} ${recordId} was not found`);
      setRecord(found);
      if(type==="customer"||type==="supplier"){
        setFinancialLoading(true);
        try{
          const partyId=text(found[config.idKey]);
          const financialResponse=await fetch(`/api/erp/party-financial-summary?type=${encodeURIComponent(type)}&partyId=${encodeURIComponent(partyId)}`,{cache:"no-store"});
          const financialBody=await financialResponse.json();
          if(financialResponse.ok&&financialBody.ok)setFinancial(financialBody);else setFinancial(null);
        }catch{setFinancial(null);}finally{setFinancialLoading(false);}
      }else setFinancial(null);
      if (Array.isArray(body.customers)) {
        setCustomers(body.customers.map((row: MasterRow) => ({
          customerId: text(row.customerId),
          customerName: text(row.customerName || row.customerId),
        })).filter((row: { customerId: string }) => row.customerId));
      }
    } catch (reason) {
      setRecord(null);
      setError(reason instanceof Error ? reason.message : `${config.title} load failed`);
    } finally {
      setLoading(false);
    }
  }, [config, recordId, type]);

  useEffect(() => {
    void load();
  }, [load]);

  const pageTitle = useMemo(() => record ? `${config.title}: ${text(record[config.nameKey]) || text(record[config.idKey])}` : `${config.title} Detail`, [config, record]);

  const documentTypes = useMemo(() => Array.from(new Set((financial?.documents||[]).map((row:any)=>String(row.kind||"")).filter(Boolean))).sort(), [financial]);
  const documentStatuses = useMemo(() => Array.from(new Set((financial?.documents||[]).map((row:any)=>String(row.status||"")).filter(Boolean))).sort(), [financial]);
  const filteredDocuments = useMemo(() => {
    const query=documentSearch.trim().toLowerCase();
    return (financial?.documents||[]).filter((row:any)=>{
      if(documentType!=="ALL"&&String(row.kind||"")!==documentType)return false;
      if(documentStatus!=="ALL"&&String(row.status||"")!==documentStatus)return false;
      if(!query)return true;
      return [row.kind,row.number,row.status,row.amount,row.outstanding].some((value)=>String(value??"").toLowerCase().includes(query));
    });
  },[financial,documentSearch,documentType,documentStatus]);
  const documentPageCount=Math.max(1,Math.ceil(filteredDocuments.length/DOCUMENT_PAGE_SIZE));
  const pagedDocuments=useMemo(()=>filteredDocuments.slice((documentPage-1)*DOCUMENT_PAGE_SIZE,documentPage*DOCUMENT_PAGE_SIZE),[filteredDocuments,documentPage]);

  useEffect(()=>{setDocumentPage(1);},[documentSearch,documentType,documentStatus]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!record || saving) return;
    setSaving(true);
    setError("");
    setMessage("Saving changes…");
    const formData = new FormData(event.currentTarget);
    const formRecord = Object.fromEntries(formData.entries());
    try {
      const response = await fetch("/api/erp/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: "masters",
          body: {
            type,
            mode: "update",
            record: formRecord,
          },
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || `${config.title} update failed`);
      notifyFlowDataChanged(type, text(formRecord[config.idKey]));
      setMessage("Modified Successfully.");
      await load();
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `${config.title} update failed`);
      setMessage("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>{pageTitle}</h2>
          <p className="small">Full doctype view. Review, edit, and click Modify to save changes to the database.</p>
        </div>
        <div className="page-head-actions">
          <Link className="button-link secondary-link" href={config.listHref}>← Back to list</Link>
          <button type="button" className="secondary" onClick={() => void load()} disabled={loading || saving}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && <div className="status-banner error">{error}</div>}
      {message && <div className="status-banner success">{message}</div>}

      {(type==="customer"||type==="supplier")&&<section className="panel party-financial-audit">
        <div className="form-title-row">
          <div>
            <h3>{type==="customer"?"Customer Financial Position":"Supplier Financial Position"}</h3>
            <p className="small">{type==="customer"?"Posted receivables, available customer advances and linked sales documents in one audit view. Draft/unposted documents are shown in history but do not change the financial balances.":"Posted payables, available supplier prepayments and linked purchase documents in one audit view. Draft/unposted documents are shown in history but do not change the financial balances."}</p>
          </div>
          <span className="auto-badge">{financialLoading?"Loading…":"LIVE"}</span>
        </div>
        {financial&&<>
          <div className="document-meta party-financial-summary">
            <div><span>{type==="customer"?"Outstanding Receivable":"Outstanding Payable"}</span><strong>{money(financial.summary?.outstanding)}</strong></div>
            <div><span>{type==="customer"?"Customer Advance Available":"Supplier Advance Available"}</span><strong>{money(financial.summary?.advanceBalance)}</strong></div>
            <div><span>Net Commercial Exposure</span><strong>{money(financial.summary?.netExposure)}</strong><small className="small">{Number(financial.summary?.netExposure||0)>=0?(type==="customer"?"Receivable remaining after considering available advance":"Payable remaining after considering supplier prepayment"):(type==="customer"?"Available customer advance exceeds posted receivable":"Supplier prepayment exceeds posted payable")}. Informational only; balances remain separate in the ledger.</small></div>
          </div>
          <div className="grid party-document-counts">
            {type==="customer"?<>
              <div className="card"><div className="label">Sales Quotations</div><div className="value">{financial.summary?.salesQuotes||0}</div></div>
              <div className="card"><div className="label">Sales Orders</div><div className="value">{financial.summary?.salesOrders||0}</div></div>
              <div className="card"><div className="label">Deliveries</div><div className="value">{financial.summary?.deliveries||0}</div></div>
              <div className="card"><div className="label">Sales Invoices</div><div className="value">{financial.summary?.invoices||0}</div><div className="small">{financial.summary?.recognizedInvoiceCount||0} accounting-recognized</div></div>
              <div className="card"><div className="label">Payment Entries</div><div className="value">{financial.summary?.payments||0}</div></div>
            </>:<>
              <div className="card"><div className="label">Supplier Quotations</div><div className="value">{financial.summary?.supplierQuotes||0}</div></div>
              <div className="card"><div className="label">Purchase Orders</div><div className="value">{financial.summary?.purchaseOrders||0}</div></div>
              <div className="card"><div className="label">Purchase Receipts</div><div className="value">{financial.summary?.receipts||0}</div></div>
              <div className="card"><div className="label">Supplier Invoices</div><div className="value">{financial.summary?.invoices||0}</div><div className="small">{financial.summary?.recognizedInvoiceCount||0} accounting-recognized</div></div>
              <div className="card"><div className="label">Payment Entries</div><div className="value">{financial.summary?.payments||0}</div></div>
            </>}
          </div>
          <div className="party-document-explorer" style={{marginTop:18}}>
            <div className="form-title-row party-document-explorer-head">
              <div>
                <h4>Linked Document Explorer</h4>
                <p className="small">Search and filter the full document history. Only 25 rows are shown at a time.</p>
              </div>
              <span className="auto-badge">{filteredDocuments.length} OF {financial.documents?.length||0}</span>
            </div>

            <div className="party-document-toolbar">
              <input
                aria-label="Search linked documents"
                placeholder="Search document no., type, status or amount…"
                value={documentSearch}
                onChange={(event)=>setDocumentSearch(event.target.value)}
              />
              <select aria-label="Filter by document type" value={documentType} onChange={(event)=>setDocumentType(event.target.value)}>
                <option value="ALL">All document types</option>
                {documentTypes.map((value)=><option key={value} value={value}>{value}</option>)}
              </select>
              <select aria-label="Filter by status" value={documentStatus} onChange={(event)=>setDocumentStatus(event.target.value)}>
                <option value="ALL">All statuses</option>
                {documentStatuses.map((value)=><option key={value} value={value}>{value}</option>)}
              </select>
              {(documentSearch||documentType!=="ALL"||documentStatus!=="ALL")&&
                <button type="button" className="secondary" onClick={()=>{setDocumentSearch("");setDocumentType("ALL");setDocumentStatus("ALL");}}>Clear filters</button>}
            </div>

            <div className="table-wrap party-document-table">
              <table className="data-table">
                <thead><tr><th>Document Type</th><th>Document</th><th>Status</th><th>Amount</th><th>Outstanding</th></tr></thead>
                <tbody>
                  {pagedDocuments.length
                    ? pagedDocuments.map((row:any,index:number)=><tr key={\`\${row.kind}-\${row.number}-\${(documentPage-1)*DOCUMENT_PAGE_SIZE+index}\`}>
                        <td>{row.kind}</td>
                        <td><Link href={row.href}><strong>{row.number}</strong></Link></td>
                        <td><span className="party-doc-status">{row.status||"—"}</span></td>
                        <td>{row.amount===null||row.amount===undefined?"—":money(row.amount)}</td>
                        <td>{row.outstanding===undefined?"—":money(row.outstanding)}</td>
                      </tr>)
                    : <tr><td colSpan={5}>No linked documents match the current filters.</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="party-document-pagination">
              <span className="small">
                {filteredDocuments.length
                  ? \`Showing \${(documentPage-1)*DOCUMENT_PAGE_SIZE+1}–\${Math.min(documentPage*DOCUMENT_PAGE_SIZE,filteredDocuments.length)} of \${filteredDocuments.length}\`
                  : "No results"}
              </span>
              <div className="button-row">
                <button type="button" className="secondary" disabled={documentPage<=1} onClick={()=>setDocumentPage((page)=>Math.max(1,page-1))}>Previous</button>
                <span className="auto-badge">Page {documentPage} / {documentPageCount}</span>
                <button type="button" className="secondary" disabled={documentPage>=documentPageCount} onClick={()=>setDocumentPage((page)=>Math.min(documentPageCount,page+1))}>Next</button>
              </div>
            </div>
          </div>        </>}
      </section>}

      <section className="panel">
        {loading && <p className="small">Loading {config.title.toLowerCase()}…</p>}
        {!loading && record && (
          <form className="form-grid" onSubmit={save}>
            <h3 className="form-wide">{config.title} master record</h3>
            <label>
              Record ID
              <input name={config.idKey} value={text(record[config.idKey])} readOnly disabled />
              <input type="hidden" name={config.idKey} value={text(record[config.idKey])} />
            </label>
            <label>
              Created Date
              <input value={displayDate(record.createdAt)} readOnly disabled />
            </label>

            {type === "customer" && (
              <>
                <label className="form-wide">Customer Name *<input name="customerName" defaultValue={text(record.customerName)} required disabled={saving} /></label>
                <label>Contact Person<input name="contactPerson" defaultValue={text(record.contactPerson)} disabled={saving} /></label>
                <label>Phone<input name="phone" defaultValue={text(record.phone)} disabled={saving} /></label>
                <label>Email<input name="email" type="email" defaultValue={text(record.email)} disabled={saving} /></label>
                <label>Tax ID / TIN<input name="taxId" defaultValue={text(record.taxId)} disabled={saving} /></label>
                <label>Credit Terms (days)<input name="creditTermsDays" type="number" min="0" defaultValue={numberValue(record.creditTermsDays)} disabled={saving} /></label>
                <label>Credit Limit<input name="creditLimit" type="number" min="0" step="0.01" defaultValue={numberValue(record.creditLimit)} disabled={saving} /></label>
                <label>Status<input value={activeText(record.active)} readOnly disabled /></label>
                <label className="form-wide">Address<textarea name="address" rows={3} defaultValue={text(record.address)} disabled={saving} /></label>
              </>
            )}

            {type === "supplier" && (
              <>
                <label className="form-wide">Supplier Name *<input name="supplierName" defaultValue={text(record.supplierName)} required disabled={saving} /></label>
                <label>Contact Person<input name="contactPerson" defaultValue={text(record.contactPerson)} disabled={saving} /></label>
                <label>Phone<input name="phone" defaultValue={text(record.phone)} disabled={saving} /></label>
                <label>Email<input name="email" type="email" defaultValue={text(record.email)} disabled={saving} /></label>
                <label>Tax ID / TIN<input name="taxId" defaultValue={text(record.taxId)} disabled={saving} /></label>
                <label>Payment Terms (days)<input name="paymentTermsDays" type="number" min="0" defaultValue={numberValue(record.paymentTermsDays)} disabled={saving} /></label>
                <label>Status<input value={activeText(record.active)} readOnly disabled /></label>
                <label className="form-wide">Address<textarea name="address" rows={3} defaultValue={text(record.address)} disabled={saving} /></label>
              </>
            )}

            {type === "project" && (
              <>
                <label className="form-wide">Project Name *<input name="projectName" defaultValue={text(record.projectName)} required disabled={saving} /></label>
                <label>
                  Customer
                  <select name="customerId" defaultValue={text(record.customerId)} disabled={saving}>
                    <option value="">No Customer / Internal Project</option>
                    {customers.map((customer) => (
                      <option key={customer.customerId} value={customer.customerId}>{customer.customerName} ({customer.customerId})</option>
                    ))}
                  </select>
                </label>
                <label>
                  Status
                  <select name="status" defaultValue={text(record.status) || "ACTIVE"} disabled={saving}>
                    <option value="PLANNING">PLANNING</option>
                    <option value="OPEN">OPEN</option>
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="ON_HOLD">ON HOLD</option>
                    <option value="COMPLETED">COMPLETED</option>
                    <option value="CANCELLED">CANCELLED</option>
                  </select>
                </label>
                <label>Start Date<input name="startDate" type="date" defaultValue={dateValue(record.startDate)} disabled={saving} /></label>
                <label>End Date<input name="endDate" type="date" defaultValue={dateValue(record.endDate)} disabled={saving} /></label>
                <label>Contract Net Amount<input name="contractNet" type="number" min="0" step="0.01" defaultValue={numberValue(record.contractNet)} disabled={saving} /></label>
                <label>GST Amount<input name="gstAmount" type="number" min="0" step="0.01" defaultValue={numberValue(record.gstAmount)} disabled={saving} /></label>
                <label>Contract Total<input name="contractTotal" type="number" min="0" step="0.01" defaultValue={numberValue(record.contractTotal)} disabled={saving} /></label>
                <label>Expected Cost<input name="expectedCost" type="number" min="0" step="0.01" defaultValue={numberValue(record.expectedCost)} disabled={saving} /></label>
                <label>Project Manager<input name="projectManager" defaultValue={text(record.projectManager)} disabled={saving} /></label>
              </>
            )}

            <div className="form-wide button-row">
              <button type="submit" disabled={saving} style={saving ? { opacity: 0.6, cursor: "not-allowed", filter: "grayscale(1)" } : undefined}>
                {saving ? "Modifying…" : "Modify"}
              </button>
              <Link className="button-link secondary-link" href={config.listHref}>Cancel</Link>
            </div>
          </form>
        )}
      </section>
    </>
  );
}
