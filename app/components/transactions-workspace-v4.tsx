"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PurchasePaymentStaged from "@/app/components/purchase-payment-staged";
import SalesPaymentStaged from "@/app/components/sales-payment-staged";
import TransactionItemLines, {
  emptyTransactionLine,
  type TransactionDraftLine,
  type TransactionItemMaster,
} from "@/app/components/transaction-item-lines";
import styles from "@/app/transactions/transactions.module.css";

type Module = "sales" | "purchase" | "expense";
type Tab = "salesQuote" | "salesInvoice" | "salesPayment" | "supplierQuote" | "purchaseOrder" | "supplierInvoice" | "purchasePayment" | "expense";
type SectionMode = "menu" | "create" | "list";
type RecordType = "quote" | "invoice" | "purchaseOrder" | "supplierBill" | "payment" | "expense";
type Master = { customers: any[]; suppliers: any[]; projects: any[] };
type TxData = { quotes: any[]; supplierQuotes: any[]; purchaseOrders: any[]; invoices: any[]; supplierBills: any[]; payments: any[]; expenses: any[] };
type SectionMeta = { title: string; createLabel: string; listLabel: string; existingTitle: string };
type ReceiptState = { ordered: number; received: number; remaining: number; hasStock: boolean; hasRemaining: boolean; partial: boolean; fullyReceived: boolean };

const emptyMaster: Master = { customers: [], suppliers: [], projects: [] };
const emptyTx: TxData = { quotes: [], supplierQuotes: [], purchaseOrders: [], invoices: [], supplierBills: [], payments: [], expenses: [] };
const money = (value: unknown) => `K${Number(value || 0).toFixed(2)}`;
const paymentEligible = (value: unknown) => ["POSTED", "PARTLY_PAID"].includes(String(value || "").toUpperCase());
const poInvoiceEligible = (value: unknown) => ["APPROVED", "PART_RECEIVED", "RECEIVED", "PART_BILLED", "CONVERTED", "BILL_CREATED", "BILLED"].includes(String(value || "").toUpperCase());

const SECTION_META: Record<Tab, SectionMeta> = {
  salesQuote: { title: "Sales Quotation", createLabel: "Create New Sales Quotation", listLabel: "View Existing Quotations", existingTitle: "Existing Sales Quotations" },
  salesInvoice: { title: "Sales Invoice", createLabel: "Create New Sales Invoice", listLabel: "View Existing Sales Invoices", existingTitle: "Existing Sales Invoices" },
  salesPayment: { title: "Sales Payment Entry / Receipt", createLabel: "Create New Sales Payment Entry / Receipt", listLabel: "View Existing Sales Payments / Receipts", existingTitle: "Existing Sales Payments / Receipts" },
  supplierQuote: { title: "Supplier Quotation", createLabel: "Create New Supplier Quotation", listLabel: "View Existing Supplier Quotations", existingTitle: "Existing Supplier Quotations" },
  purchaseOrder: { title: "Purchase Order", createLabel: "Create New Purchase Order", listLabel: "View Existing Purchase Orders", existingTitle: "Existing Purchase Orders" },
  supplierInvoice: { title: "Supplier Invoice", createLabel: "Create New Supplier Invoice", listLabel: "View Existing Supplier Invoices", existingTitle: "Existing Supplier Invoices" },
  purchasePayment: { title: "Purchase Payment Entry / Receipt", createLabel: "Create New Purchase Payment Entry / Receipt", listLabel: "View Existing Purchase Payments / Receipts", existingTitle: "Existing Purchase Payments / Receipts" },
  expense: { title: "Expense", createLabel: "Create New Expense", listLabel: "View Existing Expenses", existingTitle: "Existing Expenses" },
};

const numberMeta: Partial<Record<Tab, { label: string; action: string; partyType?: string }>> = {
  salesQuote: { label: "Auto Quotation No", action: "createQuote" },
  salesInvoice: { label: "Auto Sales Invoice No", action: "createInvoice" },
  supplierQuote: { label: "Auto Supplier Quotation No", action: "createSupplierQuote" },
  purchaseOrder: { label: "Auto Purchase Order No", action: "createPurchaseOrder" },
};
const MODULE_TABS: Record<Module, Tab[]> = { sales: ["salesQuote", "salesInvoice", "salesPayment"], purchase: ["supplierQuote", "purchaseOrder", "supplierInvoice", "purchasePayment"], expense: ["expense"] };
function defaultTab(module: Module): Tab { return module === "purchase" ? "supplierQuote" : module === "expense" ? "expense" : "salesQuote"; }
function localDate(plusDays = 0) {
  const date = new Date(); date.setDate(date.getDate() + plusDays);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Pacific/Port_Moresby", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function partyId(row: any) { return String(row.customerId || row.supplierId || ""); }
function partyName(row: any) { return String(row.customerName || row.supplierName || partyId(row)); }
function partyDisplay(row: any) { const id = partyId(row), name = partyName(row); return id && name !== id ? `${name} (${id})` : name; }
function resolveParty(options: any[], input: string) {
  const query = input.trim().toLowerCase(); if (!query) return null;
  return options.find((row) => partyDisplay(row).toLowerCase() === query)
    || options.find((row) => partyId(row).toLowerCase() === query)
    || options.find((row) => partyName(row).toLowerCase() === query) || null;
}
function createdValue(row: any) {
  const value = row.createdAt || row.creation || row.created || row.updatedAt || row.quoteDate || row.invoiceDate || row.poDate || row.billDate || row.paymentDate || row.expenseDate || "";
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}
function createdLabel(row: any) {
  const value = row.createdAt || row.creation || row.created || row.updatedAt || "";
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-PG", { timeZone: "Pacific/Port_Moresby", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
}
function ascending<T>(rows: T[]) { return [...rows].sort((a: any, b: any) => createdValue(b) - createdValue(a)); }

export default function TransactionsWorkspaceV4() {
  const router = useRouter();
  const [initialized, setInitialized] = useState(false);
  const [module, setModule] = useState<Module>("sales");
  const [tab, setTab] = useState<Tab>("salesQuote");
  const [sectionMode, setSectionMode] = useState<SectionMode>("menu");
  const [masters, setMasters] = useState<Master>(emptyMaster);
  const [mastersLoaded, setMastersLoaded] = useState(false);
  const [items, setItems] = useState<TransactionItemMaster[]>([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [tx, setTx] = useState<TxData>(emptyTx);
  const [existingLoaded, setExistingLoaded] = useState(false);
  const [existingLoading, setExistingLoading] = useState(false);
  const [receiptStates, setReceiptStates] = useState<Record<string, ReceiptState>>({});
  const [receiptStatesLoaded, setReceiptStatesLoaded] = useState(false);
  const [receiptStatesLoading, setReceiptStatesLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [selectedParty, setSelectedParty] = useState("");
  const [partyInput, setPartyInput] = useState("");
  const [expenseSupplier, setExpenseSupplier] = useState("");
  const [expenseSupplierInput, setExpenseSupplierInput] = useState("");
  const [lines, setLines] = useState<TransactionDraftLine[]>([emptyTransactionLine()]);
  const [gstRate, setGstRate] = useState("10");
  const [nextDocumentNo, setNextDocumentNo] = useState("AUTO");
  const [saving, setSaving] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState("");
  const [conversionBusy, setConversionBusy] = useState("");

  function syncUrl(nextModule: Module, nextTab: Tab, nextMode: SectionMode) {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search); params.set("module", nextModule); params.set("tab", nextTab); params.set("mode", nextMode);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
  }

  async function loadMasters() {
    if (mastersLoaded) return;
    try {
      const body = await fetch("/api/masters", { cache: "no-store" }).then((response) => response.json());
      if (!body.ok) throw new Error(body.error || "Master-data load failed");
      setMasters({ customers: body.customers || [], suppliers: body.suppliers || [], projects: body.projects || [] }); setMastersLoaded(true);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Master-data load failed"); }
  }
  async function loadItems() {
    if (itemsLoaded) return;
    try {
      const response = await fetch("/api/stock?scope=items", { cache: "no-store" }); const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Item Master load failed"); setItems(body.items || []); setItemsLoaded(true);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Item Master load failed"); }
  }
  async function loadTransactions(force = false) {
    if (existingLoaded && !force) return tx;
    setExistingLoading(true);
    try {
      const body = await fetch("/api/erp/transactions", { cache: "no-store" }).then((response) => response.json());
      if (!body.ok) throw new Error(body.error || "Transaction load failed");
      const next = { quotes: body.quotes || [], supplierQuotes: body.supplierQuotes || [], purchaseOrders: body.purchaseOrders || [], invoices: body.invoices || [], supplierBills: body.supplierBills || [], payments: body.payments || [], expenses: body.expenses || [] };
      setTx(next); setExistingLoaded(true); return next;
    } catch (error) { setStatus(error instanceof Error ? error.message : "Transaction load failed"); return null; }
    finally { setExistingLoading(false); }
  }
  async function loadReceiptStates(force = false) {
    if (receiptStatesLoaded && !force) return receiptStates;
    setReceiptStatesLoading(true);
    try {
      const response = await fetch("/api/stock", { cache: "no-store" }); const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Purchase receipt status load failed");
      const itemMap = new Map<string, any>((body.items || []).map((item: any) => [String(item.itemId || item.itemCode || ""), item]));
      const movements = Array.isArray(body.movements) ? body.movements : [];
      const poLines = Array.isArray(body.poLines) ? body.poLines : [];
      const result: Record<string, ReceiptState> = {};
      for (const po of body.purchaseOrders || []) {
        const poId = String(po.poId || "");
        let ordered = 0, received = 0, hasStock = false;
        for (const line of poLines.filter((row: any) => String(row.poId || "") === poId)) {
          const item = itemMap.get(String(line.itemId || ""));
          if (String(item?.itemType || "").toUpperCase() !== "STOCK") continue;
          hasStock = true;
          const itemId = String(line.itemId || "");
          ordered += Number(line.qty || 0);
          received += movements.filter((movement: any) => String(movement.sourceDocumentId || "") === poId && String(movement.itemId || "") === itemId && String(movement.movementType || "") === "PURCHASE_RECEIPT").reduce((sum: number, movement: any) => sum + Number(movement.qtyIn || 0), 0);
        }
        const remaining = Math.max(0, ordered - received);
        result[poId] = { ordered, received, remaining, hasStock, hasRemaining: hasStock && remaining > 0.0001, partial: received > 0.0001 && remaining > 0.0001, fullyReceived: hasStock && ordered > 0.0001 && remaining <= 0.0001 };
      }
      setReceiptStates(result); setReceiptStatesLoaded(true); return result;
    } catch (error) { setStatus(error instanceof Error ? error.message : "Purchase receipt status load failed"); return {}; }
    finally { setReceiptStatesLoading(false); }
  }
  async function loadNextDocumentNo(currentTab: Tab) {
    const meta = numberMeta[currentTab]; if (!meta) { setNextDocumentNo(""); return; }
    setNextDocumentNo("Loading…");
    try { const params = new URLSearchParams({ nextNumberFor: meta.action }); if (meta.partyType) params.set("partyType", meta.partyType); const response = await fetch(`/api/erp/transactions?${params}`, { cache: "no-store" }); const body = await response.json(); setNextDocumentNo(response.ok && body.ok ? body.nextNumber || "AUTO" : "AUTO"); }
    catch { setNextDocumentNo("AUTO"); }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedModule = params.get("module"); const resolvedModule: Module = requestedModule === "purchase" || requestedModule === "expense" ? requestedModule : "sales";
    const requestedTab = params.get("tab") as Tab | null; const resolvedTab = requestedTab && MODULE_TABS[resolvedModule].includes(requestedTab) ? requestedTab : defaultTab(resolvedModule);
    const requestedMode = params.get("mode"); const resolvedMode: SectionMode = requestedMode === "create" || requestedMode === "list" ? requestedMode : "menu";
    setModule(resolvedModule); setTab(resolvedTab); setSectionMode(resolvedMode); syncUrl(resolvedModule, resolvedTab, resolvedMode); setInitialized(true);
  }, []);

  useEffect(() => {
    if (!initialized) return;
    if (sectionMode === "list") {
      if (!existingLoaded) void loadTransactions();
      if (!mastersLoaded) void loadMasters();
      if (tab === "purchaseOrder" && !receiptStatesLoaded) void loadReceiptStates();
    }
    if (sectionMode === "create") {
      if (["salesQuote", "salesInvoice", "supplierQuote", "purchaseOrder", "supplierInvoice", "expense"].includes(tab) && !mastersLoaded) void loadMasters();
      if (["salesQuote", "salesInvoice", "supplierQuote", "purchaseOrder"].includes(tab) && !itemsLoaded) void loadItems();
      if (tab === "supplierInvoice" && !existingLoaded) void loadTransactions();
      if (numberMeta[tab]) void loadNextDocumentNo(tab);
    }
  }, [initialized, sectionMode, tab]);

  const salesSide = module === "sales";
  const commercial = ["salesQuote", "salesInvoice", "supplierQuote", "purchaseOrder"].includes(tab);
  const supplierQuotation = tab === "supplierQuote";
  const partyOptions = salesSide ? masters.customers : masters.suppliers;
  const projectOptions = useMemo(() => {
    if (!salesSide || !selectedParty) return masters.projects;
    const linked = masters.projects.filter((project) => String(project.customerId || "") === selectedParty); return linked.length ? linked : masters.projects;
  }, [salesSide, selectedParty, masters.projects]);
  const subtotal = useMemo(() => lines.reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.rate) || 0), 0), [lines]);
  const gstAmount = useMemo(() => subtotal * ((Number(gstRate) || 0) / 100), [subtotal, gstRate]);
  const netTotal = subtotal + gstAmount;
  const supplierInvoiceReadyPos = useMemo(() => tx.purchaseOrders.filter((row: any) => !String(row.poNumber || "").toUpperCase().startsWith("SUPQ-") && poInvoiceEligible(row.status)), [tx.purchaseOrders]);
  const globallyBusy = saving || Boolean(approvalBusy) || Boolean(conversionBusy);

  function customerLabel(id: unknown) {
    const key = String(id || "");
    if (!key) return "—";
    const row = masters.customers.find((item) => String(item.customerId || "") === key);
    const name = String(row?.customerName || key);
    return name !== key ? `${name} (${key})` : key;
  }
  function supplierLabel(id: unknown) {
    const key = String(id || "");
    if (!key) return "—";
    const row = masters.suppliers.find((item) => String(item.supplierId || "") === key);
    const name = String(row?.supplierName || key);
    return name !== key ? `${name} (${key})` : key;
  }
  function projectLabel(id: unknown) {
    const key = String(id || "");
    if (!key) return "No project";
    const row = masters.projects.find((item) => String(item.projectId || "") === key);
    const name = String(row?.projectName || key);
    return name !== key ? `${name} (${key})` : key;
  }

  function resetSectionState() { setStatus(""); setSelectedParty(""); setPartyInput(""); setExpenseSupplier(""); setExpenseSupplierInput(""); setLines([emptyTransactionLine()]); }
  function changeTab(value: Tab) { if (globallyBusy) return; resetSectionState(); setTab(value); setSectionMode("menu"); syncUrl(module, value, "menu"); }
  function openMode(mode: Exclude<SectionMode, "menu">) { if (globallyBusy) return; resetSectionState(); setSectionMode(mode); syncUrl(module, tab, mode); }
  function backToSection() { if (globallyBusy) return; resetSectionState(); setSectionMode("menu"); syncUrl(module, tab, "menu"); }
  function returnQuery(mode: SectionMode) { return `returnModule=${encodeURIComponent(module)}&returnTab=${encodeURIComponent(tab)}&returnMode=${encodeURIComponent(mode)}`; }
  function documentHref(type: string, id: string, mode: SectionMode = "list") { return `/transactions/${type}/${encodeURIComponent(id)}?${returnQuery(mode)}`; }
  function handlePartyInput(value: string, options = partyOptions) { setPartyInput(value); const match = resolveParty(options, value); setSelectedParty(match ? partyId(match) : ""); }
  function handleExpenseSupplierInput(value: string) { setExpenseSupplierInput(value); const match = resolveParty(masters.suppliers, value); setExpenseSupplier(match ? partyId(match) : ""); }
  function validateParty(options: any[], input: string, selected: string, label: string) { if (selected) return selected; const match = resolveParty(options, input); if (!match) throw new Error(`Select a valid ${label} from the suggestions`); return partyId(match); }

  async function call(action: string, payload: unknown) {
    const response = await fetch("/api/erp/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }) }); const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "Transaction failed");
    if (existingLoaded) await loadTransactions(true);
    if (itemsLoaded && body.result?.itemLinking?.created) { setItemsLoaded(false); await loadItems(); }
    if (numberMeta[tab]) await loadNextDocumentNo(tab); return body.result;
  }
  async function approve(recordType: RecordType, recordId: string) {
    if (globallyBusy) return;
    setApprovalBusy(recordId); setStatus("Approving…");
    try { const response = await fetch("/api/erp/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: "approvals", body: { payload: { recordType, recordId, decision: "APPROVE", note: "Transaction list" } } }) }); const body = await response.json(); if (!response.ok || !body.ok) throw new Error(body.error || "Approval failed"); setStatus(`Document approved. Final status: ${body.status || "APPROVED"}`); await loadTransactions(true); if (recordType === "purchaseOrder") { setReceiptStatesLoaded(false); await loadReceiptStates(true); } }
    catch (error) { setStatus(error instanceof Error ? error.message : "Approval failed"); }
    finally { setApprovalBusy(""); }
  }
  function editAction(recordType: RecordType, id: string, rowStatus: string) {
    const normalized = String(rowStatus || "DRAFT").toUpperCase();
    if (normalized !== "DRAFT") return <button type="button" disabled>Edit Locked</button>;
    const href = recordType === "invoice" ? `/transactions/invoice/${encodeURIComponent(id)}/edit` : `/transactions/${recordType}/${encodeURIComponent(id)}/edit`;
    return <Link prefetch={false} className="button-link" href={href}>Edit</Link>;
  }
  function workflowActions(recordType: RecordType, id: string, rowStatus: string) {
    const normalized = String(rowStatus || "DRAFT").toUpperCase();
    return <>{editAction(recordType, id, normalized)}{normalized === "DRAFT" && <button type="button" disabled={globallyBusy} onClick={() => void approve(recordType, id)}>{approvalBusy === id ? "Approving…" : "Approve"}</button>}
      {recordType === "supplierBill" && paymentEligible(normalized) && <a className="button-link" href={`/transactions?module=purchase&tab=purchasePayment&mode=create&sourceBill=${encodeURIComponent(id)}`}>Create Payment Entry</a>}
    </>;
  }

  async function submitCommercial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (globallyBusy) return;
    const saveName = supplierQuotation ? "Supplier Quotation" : SECTION_META[tab].title;
    setSaving(true); setStatus(`Saving ${saveName}…`);
    try {
      const form = new FormData(event.currentTarget); const resolvedParty = validateParty(partyOptions, partyInput, selectedParty, salesSide ? "Customer" : "Supplier");
      const payload = { documentNumber: "", partyId: resolvedParty, projectId: form.get("projectId") ?? "", documentDate: form.get("documentDate"), dueDate: form.get("dueDate") ?? "", expiryDate: form.get("expiryDate") ?? "", gstRate: Number(form.get("gstRate") || 0) / 100, accountId: form.get("accountId") ?? "", poId: "", lines: lines.map((line) => ({ itemId: line.itemId, itemCode: line.itemId, itemName: line.itemName, itemType: line.itemType, description: line.itemName || line.description, qty: Number(line.qty), uom: line.uom, rate: Number(line.rate) })) };
      const action = tab === "salesQuote" ? "createQuote" : tab === "salesInvoice" ? "createInvoice" : tab === "supplierQuote" ? "createSupplierQuote" : "createPurchaseOrder";
      const result = await call(action, payload); const detail = tab === "salesQuote" ? "quote" : tab === "salesInvoice" ? "invoice" : "purchaseOrder"; router.push(documentHref(detail, result.recordId, "create"));
    } catch (error) { setStatus(error instanceof Error ? error.message : "Save failed"); }
    finally { setSaving(false); }
  }

  async function createSupplierInvoiceFromPo(po: any, returnMode: SectionMode = "create") {
    const poId = String(po.poId || ""); if (!poId || globallyBusy) return;
    setConversionBusy(`bill:${poId}`); setStatus("Saving Supplier Invoice from currently billable PO quantity…");
    try {
      const response = await fetch("/api/erp/conversions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "poToBill", payload: { poId, billDate: localDate(), dueDate: localDate(30), costAccountId: "ACC-5100" } }) });
      const body = await response.json(); if (!response.ok || !body.ok) throw new Error(body.error || "Supplier Invoice conversion failed"); await loadTransactions(true); router.push(documentHref("supplierBill", body.createdId, returnMode));
    } catch (error) { setStatus(error instanceof Error ? error.message : "Supplier Invoice conversion failed"); }
    finally { setConversionBusy(""); }
  }

  async function submitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (globallyBusy) return;
    setSaving(true); setStatus("Saving Expense…");
    try { const form = new FormData(event.currentTarget); const supplierId = expenseSupplierInput.trim() ? validateParty(masters.suppliers, expenseSupplierInput, expenseSupplier, "Supplier") : ""; const result = await call("createExpense", { ...Object.fromEntries(form.entries()), supplierId, expenseNumber: "" }); router.push(documentHref("expense", result.recordId, "create")); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Save failed"); }
    finally { setSaving(false); }
  }

  const tabButton = (value: Tab, label: string) => <button type="button" key={value} disabled={globallyBusy} className={tab === value ? "tab active" : "tab"} onClick={() => changeTab(value)}>{label}</button>;
  const view = (type: string, id: string) => <Link prefetch={false} className="button-link secondary-link" href={documentHref(type, id, "list")}>View / Print</Link>;
  const section = SECTION_META[tab];
  const title = module === "sales" ? "Sales Transactions" : module === "purchase" ? "Purchase Transactions" : "Expenses";
  const numberLabel = numberMeta[tab]?.label || "Auto Document No";
  const partyListId = salesSide ? "customer-suggestions" : "supplier-suggestions";

  function existingCount() {
    if (tab === "salesQuote") return tx.quotes.length; if (tab === "salesInvoice") return tx.invoices.length; if (tab === "salesPayment") return tx.payments.filter((row) => row.partyType === "Customer").length; if (tab === "supplierQuote") return tx.supplierQuotes.length; if (tab === "purchaseOrder") return tx.purchaseOrders.length; if (tab === "supplierInvoice") return tx.supplierBills.length; if (tab === "purchasePayment") return tx.payments.filter((row) => row.partyType === "Supplier").length; return tx.expenses.length;
  }
  function existingRows() {
    if (tab === "salesQuote") return ascending(tx.quotes).map((row) => <tr key={row.quoteId}><td><Link prefetch={false} href={documentHref("quote", row.quoteId, "list")}><strong>{row.quoteNumber}</strong></Link></td><td>{createdLabel(row)}</td><td>{customerLabel(row.customerId)}<br/><span className="small">{projectLabel(row.projectId)}</span></td><td>{money(row.totalAmount)}</td><td>{row.status}</td><td><div className="row-actions">{view("quote", row.quoteId)}{workflowActions("quote", row.quoteId, row.status)}</div></td></tr>);
    if (tab === "salesInvoice") return ascending(tx.invoices).map((row) => <tr key={row.invoiceId} className={Number(row.outstandingAmount || 0) > 0 ? styles.outstandingRow : ""}><td><Link prefetch={false} href={documentHref("invoice", row.invoiceId, "list")}><strong>{row.invoiceNumber}</strong></Link></td><td>{createdLabel(row)}</td><td>{customerLabel(row.customerId)}<br/><span className="small">{projectLabel(row.projectId)}</span></td><td>{money(row.totalAmount)}<br/><span className="small">Outstanding {money(row.outstandingAmount)}</span></td><td>{row.status}</td><td><div className="row-actions">{view("invoice", row.invoiceId)}{workflowActions("invoice", row.invoiceId, row.status)}</div></td></tr>);
    if (tab === "supplierQuote") return ascending(tx.supplierQuotes).map((row) => {
      const convertedPo = tx.purchaseOrders.find((po) => String(po.sourceDocumentId || "") === String(row.poId || ""));
      const approved = String(row.status || "").toUpperCase() === "APPROVED";
      return <tr key={row.poId}><td><Link prefetch={false} href={documentHref("purchaseOrder", row.poId, "list")}><strong>{row.poNumber}</strong></Link></td><td>{createdLabel(row)}</td><td>{supplierLabel(row.supplierId)}<br/><span className="small">{projectLabel(row.projectId)}</span></td><td>{money(row.totalAmount)}</td><td>{convertedPo ? "CONVERTED" : row.status}{convertedPo?<><br/><span className="small">→ {convertedPo.poNumber || convertedPo.poId}</span></>:null}</td><td><div className="row-actions">{view("purchaseOrder", row.poId)}{editAction("purchaseOrder", row.poId, row.status)}{String(row.status || "").toUpperCase()==="DRAFT"&&<button type="button" disabled={globallyBusy} onClick={() => void approve("purchaseOrder", row.poId)}>{approvalBusy===row.poId?"Approving…":"Approve"}</button>}{convertedPo?<Link prefetch={false} className="button-link" href={documentHref("purchaseOrder", convertedPo.poId, "list")}>Open Purchase Order</Link>:approved?<Link prefetch={false} className="button-link" href={documentHref("purchaseOrder", row.poId, "list")}>Prepare Items / Create PO</Link>:null}</div></td></tr>;
    });
    if (tab === "purchaseOrder") return ascending(tx.purchaseOrders).map((row) => {
      const receipt = receiptStates[String(row.poId || "")];
      const rowClass = receipt?.partial ? styles.partialReceiptRow : receipt?.fullyReceived ? styles.receiptCompleteRow : "";
      const eligible = poInvoiceEligible(row.status);
      return <tr key={row.poId} className={rowClass}><td><Link prefetch={false} href={documentHref("purchaseOrder", row.poId, "list")}><strong>{row.poNumber}</strong></Link>{receipt?.hasStock && <><br/><span className="small">Received {receipt.received.toLocaleString()} / {receipt.ordered.toLocaleString()} · Remaining {receipt.remaining.toLocaleString()}</span></>}</td><td>{createdLabel(row)}</td><td>{supplierLabel(row.supplierId)}<br/><span className="small">{projectLabel(row.projectId)}</span></td><td>{money(row.totalAmount)}</td><td>{row.status}{receipt?.partial ? <><br/><span className="small"><strong>PARTIAL RECEIPT</strong></span></> : null}{receipt?.fullyReceived ? <><br/><span className="small">Goods fully received</span></> : null}</td><td><div className="row-actions">{view("purchaseOrder", row.poId)}{workflowActions("purchaseOrder", row.poId, row.status)}{eligible && receipt?.hasStock && <>{receipt.hasRemaining ? <Link prefetch={false} className="button-link" href={`/stock?mode=movement&sourcePo=${encodeURIComponent(row.poId)}`}>Create Purchase Receipt / GRN</Link> : <button type="button" disabled>Purchase Receipt Complete</button>}</>}{eligible && <button type="button" disabled={globallyBusy} onClick={() => void createSupplierInvoiceFromPo(row, "list")}>{conversionBusy === `bill:${row.poId}` ? "Saving…" : "Create Supplier Invoice"}</button>}</div></td></tr>;
    });
    if (tab === "supplierInvoice") return ascending(tx.supplierBills).map((row) => { const outstanding = Number(row.outstandingAmount ?? row.totalAmount ?? 0); const partialPaid = String(row.status || "").toUpperCase() === "PARTLY_PAID"; return <tr key={row.billId} className={outstanding > 0 ? (partialPaid ? styles.partialPaidRow : styles.outstandingRow) : ""}><td><Link prefetch={false} href={documentHref("supplierBill", row.billId, "list")}><strong>{row.billNumber || row.billId}</strong></Link></td><td>{createdLabel(row)}</td><td>{supplierLabel(row.supplierId)}<br/><span className="small">{projectLabel(row.projectId)}</span></td><td>{money(row.totalAmount)}<br/><span className="small"><strong>Outstanding {money(outstanding)}</strong></span></td><td>{row.status}</td><td><div className="row-actions">{view("supplierBill", row.billId)}{workflowActions("supplierBill", row.billId, row.status)}</div></td></tr>; });
    if (tab === "salesPayment") return ascending(tx.payments.filter((row) => row.partyType === "Customer")).map((row) => <tr key={row.paymentId}><td><Link prefetch={false} href={documentHref("payment", row.paymentId, "list")}><strong>{row.paymentNumber}</strong></Link></td><td>{createdLabel(row)}</td><td>{customerLabel(row.partyId)}<br/><span className="small">{projectLabel(row.projectId)}</span></td><td>{money(row.amount)}</td><td>{row.status}{row.journalId?<><br/><span className="small">Finalized</span></>:null}</td><td><div className="row-actions">{view("payment", row.paymentId)}{editAction("payment",row.paymentId,row.status)}</div></td></tr>);
    if (tab === "purchasePayment") return ascending(tx.payments.filter((row) => row.partyType === "Supplier")).map((row) => <tr key={row.paymentId}><td><Link prefetch={false} href={documentHref("payment", row.paymentId, "list")}><strong>{row.paymentNumber}</strong></Link></td><td>{createdLabel(row)}</td><td>{supplierLabel(row.partyId)}<br/><span className="small">{projectLabel(row.projectId)}</span></td><td>{money(row.amount)}</td><td>{row.status}{row.journalId?<><br/><span className="small">Finalized</span></>:null}</td><td><div className="row-actions">{view("payment", row.paymentId)}{editAction("payment",row.paymentId,row.status)}{row.journalId&&<Link prefetch={false} className="button-link" href={`/journals/${encodeURIComponent(row.journalId)}`}>View Journal</Link>}</div></td></tr>);
    return ascending(tx.expenses).map((row) => <tr key={row.expenseId}><td><Link prefetch={false} href={documentHref("expense", row.expenseId, "list")}><strong>{row.expenseNumber}</strong></Link></td><td>{createdLabel(row)}</td><td>{supplierLabel(row.supplierId)}<br/><span className="small">{projectLabel(row.projectId)}</span></td><td>{money(row.totalAmount)}</td><td>{row.status}</td><td><div className="row-actions">{view("expense", row.expenseId)}{workflowActions("expense", row.expenseId, row.status)}</div></td></tr>);
  }

  return <>
    <div className="page-heading"><div><h2>{title}</h2><p className="small">Create and existing-document workspaces stay separate. Linked master data is shown as Name (ID).</p></div></div>
    {module === "sales" && <div className="tabs wrap-tabs">{tabButton("salesQuote", "Sales Quotation")}{tabButton("salesInvoice", "Sales Invoice")}{tabButton("salesPayment", "Sales Payment Entry / Receipt")}</div>}
    {module === "purchase" && <div className="tabs wrap-tabs">{tabButton("supplierQuote", "Supplier Quotation")}{tabButton("purchaseOrder", "Purchase Order")}{tabButton("supplierInvoice", "Supplier Invoice")}{tabButton("purchasePayment", "Purchase Payment Entry / Receipt")}</div>}
    {status && <section className="panel status-banner">{status}</section>}

    {sectionMode === "menu" && <section className={`panel ${styles.chooser}`}><div className={styles.chooserHeader}><h3>{section.title}</h3><p className="small">Select one workspace.</p></div><div className={styles.chooserGrid}><button type="button" disabled={globallyBusy} className={styles.ctaCard} onClick={() => openMode("create")}><span className={styles.ctaTitle}>{section.createLabel}</span><span className={styles.ctaCopy}>Open the new-document workflow.</span></button><button type="button" disabled={globallyBusy} className={`secondary ${styles.ctaCard}`} onClick={() => openMode("list")}><span className={styles.ctaTitle}>{section.listLabel}</span><span className={styles.ctaCopy}>Show only saved documents.</span></button></div></section>}
    {sectionMode !== "menu" && <section className={`panel ${styles.contextBar}`}><button type="button" disabled={globallyBusy} className="secondary" onClick={backToSection}>← Back to {section.title}</button><span className={styles.contextTitle}>{sectionMode === "create" ? section.createLabel : section.listLabel}</span></section>}

    {sectionMode === "create" && commercial && <form className="panel" onSubmit={submitCommercial}>
      <div className="form-title-row"><div><h3>{section.createLabel}</h3><p className="small">{supplierQuotation ? "Select an existing Item or type a temporary supplier item. After approval, every TEMP line must be reviewed and saved permanently in Item Master before PO conversion." : "All rows are Item Master linked. Stock Sales Invoices use controlled Update Stock and moving-average COGS on approval."}</p></div><span className="auto-badge">Document No: {nextDocumentNo || "AUTO"}</span></div>
      <div className="form-grid"><label>{salesSide ? "Customer" : "Supplier"}<input list={partyListId} value={partyInput} onChange={(event) => handlePartyInput(event.target.value)} placeholder={`Type ${salesSide ? "customer" : "supplier"} name or ID`} autoComplete="off" required disabled={saving}/><datalist id={partyListId}>{partyOptions.map((row) => <option key={partyId(row)} value={partyDisplay(row)}/>)}</datalist></label><label>Project<select name="projectId" defaultValue="" disabled={saving}><option value="">No project</option>{projectOptions.map((row) => <option key={row.projectId} value={row.projectId}>{row.projectName} ({row.projectId})</option>)}</select></label><label>{numberLabel}<input value={nextDocumentNo || "AUTO"} readOnly/></label><div></div><label>Date<input name="documentDate" type="date" required defaultValue={localDate()} disabled={saving}/></label>{tab === "salesInvoice" && <label>Due Date<input name="dueDate" type="date" defaultValue={localDate(30)} disabled={saving}/></label>}{(tab === "salesQuote" || tab === "supplierQuote") && <label>Valid Till<input name="expiryDate" type="date" defaultValue={localDate(7)} disabled={saving}/></label>}<label>GST %<input name="gstRate" type="number" min="0" max="100" step="0.01" value={gstRate} onChange={(event) => setGstRate(event.target.value)} disabled={saving}/></label>{tab === "salesInvoice" && <label>Revenue Account Override<input name="accountId" placeholder="Normally from Item Master" disabled={saving}/><span className="small">Item Master account has priority.</span></label>}</div>
      <h4>Items</h4><TransactionItemLines lines={lines} items={items} supplierQuotation={supplierQuotation} onChange={saving ? () => undefined : setLines}/>
      <div style={{display:"flex",justifyContent:"flex-end",marginTop:18}}><div style={{width:"min(420px,100%)",border:"1px solid #e5ebf2",borderRadius:10,overflow:"hidden",background:"#fff"}}><div style={{display:"flex",justifyContent:"space-between",padding:"12px 14px"}}><span>Sub Total</span><strong>{money(subtotal)}</strong></div><div style={{display:"flex",justifyContent:"space-between",padding:"12px 14px"}}><span>GST {Number(gstRate||0).toFixed(2)}%</span><strong>{money(gstAmount)}</strong></div><div style={{display:"flex",justifyContent:"space-between",padding:14,background:"#f8fafc",fontSize:18}}><strong>Net Total</strong><strong>{money(netTotal)}</strong></div></div></div><div className="button-row"><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save Draft"}</button></div>
    </form>}

    {sectionMode === "create" && tab === "salesPayment" && <SalesPaymentStaged/>}
    {sectionMode === "create" && tab === "supplierInvoice" && <><section className="panel"><div className="form-title-row"><div><h3>Create New Supplier Invoice</h3><p className="small">Partial billing is allowed. Stock lines become billable only after Purchase Receipt; service/non-stock lines use remaining ordered quantity.</p></div><span className="auto-badge">{existingLoading ? "Loading…" : `${supplierInvoiceReadyPos.length} PO Available`}</span></div></section><section className="panel table-wrap"><table className="data-table"><thead><tr><th>Purchase Order</th><th>Supplier</th><th>Project</th><th>Total</th><th>Lifecycle</th><th>Action</th></tr></thead><tbody>{!existingLoading && supplierInvoiceReadyPos.length === 0 && <tr><td colSpan={6}>No approved/part-received Purchase Orders are available for billing.</td></tr>}{ascending(supplierInvoiceReadyPos).map((po) => <tr key={po.poId}><td><Link prefetch={false} href={documentHref("purchaseOrder", po.poId, "create")}><strong>{po.poNumber || po.poId}</strong></Link></td><td>{supplierLabel(po.supplierId)}</td><td>{projectLabel(po.projectId)}</td><td>{money(po.totalAmount)}</td><td>{po.status}</td><td><button type="button" disabled={globallyBusy} onClick={() => void createSupplierInvoiceFromPo(po)}>{conversionBusy === `bill:${po.poId}` ? "Saving…" : "Create Supplier Invoice"}</button></td></tr>)}</tbody></table></section></>}
    {sectionMode === "create" && tab === "purchasePayment" && <PurchasePaymentStaged/>}
    {sectionMode === "create" && tab === "expense" && <form className="panel form-grid" onSubmit={submitExpense}><h3 className="form-title">Create New Expense</h3><label>Date<input name="expenseDate" type="date" required defaultValue={localDate()} disabled={saving}/></label><label>Supplier<input list="expense-supplier-suggestions" value={expenseSupplierInput} onChange={(event) => handleExpenseSupplierInput(event.target.value)} disabled={saving}/><datalist id="expense-supplier-suggestions">{masters.suppliers.map((row) => <option key={partyId(row)} value={partyDisplay(row)}/>)}</datalist></label><label>Project<select name="projectId" defaultValue="" disabled={saving}><option value="">No project</option>{masters.projects.map((row) => <option key={row.projectId} value={row.projectId}>{row.projectName} ({row.projectId})</option>)}</select></label><label>Expense Account<input name="expenseAccountId" defaultValue="ACC-6600" required disabled={saving}/></label><label>Net Amount<input name="netAmount" type="number" min="0" step="0.01" required disabled={saving}/></label><label>GST Amount<input name="gstAmount" type="number" min="0" step="0.01" defaultValue="0" disabled={saving}/></label><label>Payment Method<select name="paymentMethod" disabled={saving}><option>Cash</option><option>Bank Transfer</option><option>Card</option></select></label><label>Cash / Bank Account<input name="cashBankAccountId" defaultValue="ACC-1110" required disabled={saving}/></label><label className="form-wide">Description<input name="description" required disabled={saving}/></label><div className="form-wide"><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save Draft"}</button></div></form>}

    {sectionMode === "list" && <section className="panel table-wrap"><div className="form-title-row"><h3>{section.existingTitle}</h3><span className="auto-badge">{existingLoading || (tab === "purchaseOrder" && receiptStatesLoading) ? "Loading…" : `${existingCount()} Documents · Newest first`}</span></div><table className="data-table"><thead><tr><th>ID / Number</th><th>Creation Date & Time</th><th>Party / Project</th><th>Total / Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>{!existingLoading && existingCount() === 0 && <tr><td colSpan={6}>No existing documents found in this section.</td></tr>}{existingRows()}</tbody></table></section>}
  </>;
}
