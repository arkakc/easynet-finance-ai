"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PurchasePaymentStaged from "@/app/components/purchase-payment-staged";
import styles from "./transactions.module.css";

type Module = "sales" | "purchase" | "expense";
type Tab = "salesQuote" | "salesInvoice" | "salesPayment" | "supplierQuote" | "purchaseOrder" | "supplierInvoice" | "purchasePayment" | "expense";
type SectionMode = "menu" | "create" | "list";
type RecordType = "quote" | "invoice" | "purchaseOrder" | "supplierBill" | "payment" | "expense";
type Master = { customers: any[]; suppliers: any[]; projects: any[] };
type TxData = { quotes: any[]; supplierQuotes: any[]; purchaseOrders: any[]; invoices: any[]; supplierBills: any[]; payments: any[]; expenses: any[] };
type DraftLine = { description: string; qty: string; uom: string; rate: string };

type SectionMeta = { title: string; createLabel: string; listLabel: string; existingTitle: string };

const emptyMaster: Master = { customers: [], suppliers: [], projects: [] };
const emptyTx: TxData = { quotes: [], supplierQuotes: [], purchaseOrders: [], invoices: [], supplierBills: [], payments: [], expenses: [] };
const money = (value: unknown) => `K${Number(value || 0).toFixed(2)}`;
const normalizeDocNo = (value: unknown) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

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
  salesPayment: { label: "Auto Sales Payment / Receipt No", action: "createPayment", partyType: "Customer" },
  supplierQuote: { label: "Auto Supplier Quotation No", action: "createSupplierQuote" },
  purchaseOrder: { label: "Auto Purchase Order No", action: "createPurchaseOrder" },
};

const MODULE_TABS: Record<Module, Tab[]> = {
  sales: ["salesQuote", "salesInvoice", "salesPayment"],
  purchase: ["supplierQuote", "purchaseOrder", "supplierInvoice", "purchasePayment"],
  expense: ["expense"],
};

function defaultTab(module: Module): Tab {
  return module === "purchase" ? "supplierQuote" : module === "expense" ? "expense" : "salesQuote";
}

function localDate(plusDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + plusDays);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Pacific/Port_Moresby", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function partyId(row: any) { return String(row.customerId || row.supplierId || ""); }
function partyName(row: any) { return String(row.customerName || row.supplierName || partyId(row)); }
function partyDisplay(row: any) {
  const id = partyId(row), name = partyName(row);
  return id && name !== id ? `${name} (${id})` : name;
}
function resolveParty(options: any[], input: string) {
  const q = input.trim().toLowerCase();
  if (!q) return null;
  return options.find((r) => partyDisplay(r).toLowerCase() === q)
    || options.find((r) => partyId(r).toLowerCase() === q)
    || options.find((r) => partyName(r).toLowerCase() === q)
    || null;
}

export default function TransactionsPage() {
  const router = useRouter();
  const [initialized, setInitialized] = useState(false);
  const [module, setModule] = useState<Module>("sales");
  const [tab, setTab] = useState<Tab>("salesQuote");
  const [sectionMode, setSectionMode] = useState<SectionMode>("menu");
  const [masters, setMasters] = useState<Master>(emptyMaster);
  const [mastersLoaded, setMastersLoaded] = useState(false);
  const [tx, setTx] = useState<TxData>(emptyTx);
  const [existingLoaded, setExistingLoaded] = useState(false);
  const [existingLoading, setExistingLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [selectedParty, setSelectedParty] = useState("");
  const [partyInput, setPartyInput] = useState("");
  const [expenseSupplier, setExpenseSupplier] = useState("");
  const [expenseSupplierInput, setExpenseSupplierInput] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ description: "", qty: "1", uom: "Each", rate: "0" }]);
  const [gstRate, setGstRate] = useState("10");
  const [nextDocumentNo, setNextDocumentNo] = useState("AUTO");
  const [salesInvoiceSearch, setSalesInvoiceSearch] = useState("");
  const [searchedSalesInvoice, setSearchedSalesInvoice] = useState<any | null>(null);
  const [selectedSalesInvoice, setSelectedSalesInvoice] = useState<any | null>(null);
  const [conversionBusy, setConversionBusy] = useState(false);

  function syncUrl(nextModule: Module, nextTab: Tab, nextMode: SectionMode) {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.set("module", nextModule);
    params.set("tab", nextTab);
    params.set("mode", nextMode);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
  }

  async function loadMasters() {
    if (mastersLoaded) return;
    try {
      const b = await fetch("/api/masters", { cache: "no-store" }).then(r => r.json());
      if (!b.ok) throw new Error(b.error || "Master-data load failed");
      setMasters({ customers: b.customers || [], suppliers: b.suppliers || [], projects: b.projects || [] });
      setMastersLoaded(true);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Master-data load failed");
    }
  }

  async function loadTransactions(force = false) {
    if (existingLoaded && !force) return tx;
    setExistingLoading(true);
    try {
      const b = await fetch("/api/erp/transactions", { cache: "no-store" }).then(r => r.json());
      if (!b.ok) throw new Error(b.error || "Transaction load failed");
      const next = {
        quotes: b.quotes || [],
        supplierQuotes: b.supplierQuotes || [],
        purchaseOrders: b.purchaseOrders || [],
        invoices: b.invoices || [],
        supplierBills: b.supplierBills || [],
        payments: b.payments || [],
        expenses: b.expenses || [],
      };
      setTx(next);
      setExistingLoaded(true);
      return next;
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Transaction load failed");
      return null;
    } finally {
      setExistingLoading(false);
    }
  }

  async function loadNextDocumentNo(currentTab: Tab) {
    const meta = numberMeta[currentTab];
    if (!meta) { setNextDocumentNo(""); return; }
    setNextDocumentNo("Loading…");
    try {
      const p = new URLSearchParams({ nextNumberFor: meta.action });
      if (meta.partyType) p.set("partyType", meta.partyType);
      const r = await fetch(`/api/erp/transactions?${p}`, { cache: "no-store" });
      const b = await r.json();
      if (!r.ok || !b.ok) throw new Error();
      setNextDocumentNo(b.nextNumber || "AUTO");
    } catch {
      setNextDocumentNo("AUTO");
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedModule = params.get("module");
    const resolvedModule: Module = requestedModule === "purchase" || requestedModule === "expense" ? requestedModule : "sales";
    const requestedTab = params.get("tab") as Tab | null;
    const resolvedTab = requestedTab && MODULE_TABS[resolvedModule].includes(requestedTab) ? requestedTab : defaultTab(resolvedModule);
    const requestedMode = params.get("mode");
    const resolvedMode: SectionMode = requestedMode === "create" || requestedMode === "list" ? requestedMode : "menu";
    setModule(resolvedModule);
    setTab(resolvedTab);
    setSectionMode(resolvedMode);
    syncUrl(resolvedModule, resolvedTab, resolvedMode);
    setInitialized(true);
  }, []);

  useEffect(() => {
    if (!initialized) return;
    if (sectionMode === "list" && !existingLoaded) void loadTransactions();
    if (sectionMode === "create") {
      if (["salesQuote", "salesInvoice", "supplierQuote", "purchaseOrder", "expense"].includes(tab) && !mastersLoaded) void loadMasters();
      if ((tab === "salesPayment" || tab === "supplierInvoice") && !existingLoaded) void loadTransactions();
      if (numberMeta[tab]) void loadNextDocumentNo(tab);
    }
  }, [initialized, sectionMode, tab]);

  const salesSide = module === "sales";
  const commercial = ["salesQuote", "salesInvoice", "supplierQuote", "purchaseOrder"].includes(tab);
  const partyOptions = salesSide ? masters.customers : masters.suppliers;
  const projectOptions = useMemo(() => {
    if (!salesSide || !selectedParty) return masters.projects;
    const linked = masters.projects.filter(p => String(p.customerId || "") === selectedParty);
    return linked.length ? linked : masters.projects;
  }, [salesSide, selectedParty, masters.projects]);
  const subtotal = useMemo(() => lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0), [lines]);
  const gstAmount = useMemo(() => subtotal * ((Number(gstRate) || 0) / 100), [subtotal, gstRate]);
  const netTotal = subtotal + gstAmount;
  const approvedInvoices = useMemo(() => tx.invoices.filter(r => String(r.status || "").toUpperCase() === "APPROVED" && Number(r.outstandingAmount ?? r.totalAmount ?? 0) > 0), [tx.invoices]);
  const billedPoIds = useMemo(() => new Set(tx.supplierBills.flatMap((b: any) => [String(b.poId || ""), String(b.sourceDocumentId || "")]).filter(Boolean)), [tx.supplierBills]);
  const approvedPurchaseOrders = useMemo(() => tx.purchaseOrders.filter((r: any) => {
    const status = String(r.status || "").toUpperCase();
    const no = String(r.poNumber || "").toUpperCase();
    return status === "APPROVED" && !no.startsWith("SUPQ-") && !billedPoIds.has(String(r.poId));
  }), [tx.purchaseOrders, billedPoIds]);

  function resetSectionState() {
    setStatus("");
    setSelectedParty("");
    setPartyInput("");
    setExpenseSupplier("");
    setExpenseSupplierInput("");
    setSalesInvoiceSearch("");
    setSearchedSalesInvoice(null);
    setSelectedSalesInvoice(null);
  }

  function changeTab(v: Tab) {
    resetSectionState();
    setTab(v);
    setSectionMode("menu");
    syncUrl(module, v, "menu");
  }

  function openMode(mode: Exclude<SectionMode, "menu">) {
    resetSectionState();
    setSectionMode(mode);
    syncUrl(module, tab, mode);
  }

  function backToSection() {
    resetSectionState();
    setSectionMode("menu");
    syncUrl(module, tab, "menu");
  }

  function returnQuery(mode: SectionMode) {
    return `returnModule=${encodeURIComponent(module)}&returnTab=${encodeURIComponent(tab)}&returnMode=${encodeURIComponent(mode)}`;
  }

  function documentHref(type: string, id: string, mode: SectionMode = "list") {
    return `/transactions/${type}/${encodeURIComponent(id)}?${returnQuery(mode)}`;
  }

  function handlePartyInput(value: string, options = partyOptions) {
    setPartyInput(value);
    const m = resolveParty(options, value);
    setSelectedParty(m ? partyId(m) : "");
  }
  function handleExpenseSupplierInput(value: string) {
    setExpenseSupplierInput(value);
    const m = resolveParty(masters.suppliers, value);
    setExpenseSupplier(m ? partyId(m) : "");
  }
  function validateParty(options: any[], input: string, selected: string, label: string) {
    if (selected) return selected;
    const m = resolveParty(options, input);
    if (!m) throw new Error(`Select a valid ${label} from the suggestions`);
    return partyId(m);
  }
  function setLine(i: number, f: keyof DraftLine, v: string) { setLines(c => c.map((l, x) => x === i ? { ...l, [f]: v } : l)); }
  function addLine() { setLines(c => [...c, { description: "", qty: "1", uom: "Each", rate: "0" }]); }
  function removeLine(i: number) { setLines(c => c.length === 1 ? c : c.filter((_, x) => x !== i)); }

  async function call(action: string, payload: unknown) {
    setStatus("Saving…");
    const r = await fetch("/api/erp/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }) });
    const b = await r.json();
    if (!r.ok || !b.ok) throw new Error(b.error || "Transaction failed");
    if (existingLoaded) await loadTransactions(true);
    if (numberMeta[tab]) await loadNextDocumentNo(tab);
    return b.result;
  }

  async function approve(recordType: RecordType, recordId: string) {
    try {
      setStatus("Approving…");
      const r = await fetch("/api/erp/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: "approvals", body: { payload: { recordType, recordId, decision: "APPROVE", note: "Transaction list" } } }) });
      const b = await r.json();
      if (!r.ok || !b.ok) throw new Error(b.error || "Approval failed");
      setStatus("Document approved.");
      await loadTransactions(true);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Approval failed");
    }
  }

  function workflowActions(recordType: RecordType, id: string, rowStatus: string) {
    const s = String(rowStatus || "DRAFT").toUpperCase();
    return <>{s === "DRAFT" && <button type="button" onClick={() => void approve(recordType, id)}>Approve</button>}</>;
  }

  async function submitCommercial(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const f = new FormData(e.currentTarget);
      const resolved = validateParty(partyOptions, partyInput, selectedParty, salesSide ? "Customer" : "Supplier");
      const payload = {
        documentNumber: "",
        partyId: resolved,
        projectId: f.get("projectId") ?? "",
        documentDate: f.get("documentDate"),
        dueDate: f.get("dueDate") ?? "",
        expiryDate: f.get("expiryDate") ?? "",
        gstRate: Number(f.get("gstRate") || 0) / 100,
        accountId: f.get("accountId") ?? "",
        poId: "",
        lines: lines.map(l => ({ ...l, qty: Number(l.qty), rate: Number(l.rate) })),
      };
      const action = tab === "salesQuote" ? "createQuote" : tab === "salesInvoice" ? "createInvoice" : tab === "supplierQuote" ? "createSupplierQuote" : "createPurchaseOrder";
      const result = await call(action, payload);
      const detail = tab === "salesQuote" ? "quote" : tab === "salesInvoice" ? "invoice" : "purchaseOrder";
      router.push(documentHref(detail, result.recordId, "create"));
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function saveSalesPaymentDraft(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedSalesInvoice) return;
    setConversionBusy(true);
    try {
      const f = new FormData(e.currentTarget);
      const amount = Number(f.get("amount") || 0);
      if (!(amount > 0)) throw new Error("Payment amount must be greater than zero");
      const result = await call("createPayment", {
        paymentNumber: "",
        paymentType: "RECEIVE",
        partyType: "Customer",
        partyId: selectedSalesInvoice.customerId,
        projectId: selectedSalesInvoice.projectId || "",
        paymentDate: f.get("paymentDate"),
        amount,
        paymentMethod: f.get("paymentMethod"),
        cashBankAccountId: f.get("cashBankAccountId"),
        reference: f.get("reference") || "",
        againstDocumentType: "Sales Invoice",
        againstDocumentId: selectedSalesInvoice.invoiceId,
      });
      router.push(documentHref("payment", result.recordId, "create"));
      router.refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Payment draft save failed");
    } finally {
      setConversionBusy(false);
    }
  }

  function selectInvoiceForPayment(invoice: any) {
    setSelectedSalesInvoice(invoice);
    setSearchedSalesInvoice(invoice);
    setStatus("");
    window.setTimeout(() => document.getElementById("sales-payment-draft-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  async function searchApprovedSalesInvoice() {
    let invoices = tx.invoices;
    if (!existingLoaded) {
      const b = await loadTransactions();
      invoices = b?.invoices || [];
    }
    const q = normalizeDocNo(salesInvoiceSearch);
    if (!q) { setSearchedSalesInvoice(null); setStatus("Enter a Sales Invoice number"); return; }
    const approved = invoices.filter((r: any) => String(r.status || "").toUpperCase() === "APPROVED" && Number(r.outstandingAmount ?? r.totalAmount ?? 0) > 0);
    const m = approved.find((r: any) => normalizeDocNo(r.invoiceNumber) === q || normalizeDocNo(r.invoiceId) === q)
      || approved.find((r: any) => normalizeDocNo(r.invoiceNumber).includes(q) || normalizeDocNo(r.invoiceId).includes(q));
    if (!m) { setSearchedSalesInvoice(null); setStatus(`Approved Sales Invoice with outstanding amount not found: ${salesInvoiceSearch}`); return; }
    setStatus("");
    setSearchedSalesInvoice(m);
  }

  async function createSupplierInvoiceFromPo(po: any) {
    setConversionBusy(true);
    setStatus("Creating Supplier Invoice…");
    try {
      const response = await fetch("/api/erp/conversions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "poToBill", payload: { poId: po.poId, billDate: localDate(), dueDate: localDate(30), costAccountId: "ACC-5100" } }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Supplier Invoice conversion failed");
      if (existingLoaded) await loadTransactions(true);
      router.push(documentHref("supplierBill", body.createdId, "create"));
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Supplier Invoice conversion failed");
    } finally {
      setConversionBusy(false);
    }
  }

  async function submitExpense(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const f = new FormData(e.currentTarget);
      const supplierId = expenseSupplierInput.trim() ? validateParty(masters.suppliers, expenseSupplierInput, expenseSupplier, "Supplier") : "";
      const result = await call("createExpense", { ...Object.fromEntries(f.entries()), supplierId, expenseNumber: "" });
      router.push(documentHref("expense", result.recordId, "create"));
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Save failed");
    }
  }

  const tabButton = (v: Tab, l: string) => <button type="button" key={v} className={tab === v ? "tab active" : "tab"} onClick={() => changeTab(v)}>{l}</button>;
  const view = (type: string, id: string) => <Link prefetch={false} className="button-link secondary-link" href={documentHref(type, id, "list")}>View / Print</Link>;
  const section = SECTION_META[tab];
  const title = module === "sales" ? "Sales Transactions" : module === "purchase" ? "Purchase Transactions" : "Expenses";
  const numberLabel = numberMeta[tab]?.label || "Auto Document No";
  const partyListId = salesSide ? "customer-suggestions" : "supplier-suggestions";

  function existingCount() {
    if (tab === "salesQuote") return tx.quotes.length;
    if (tab === "salesInvoice") return tx.invoices.length;
    if (tab === "salesPayment") return tx.payments.filter(r => r.partyType === "Customer").length;
    if (tab === "supplierQuote") return tx.supplierQuotes.length;
    if (tab === "purchaseOrder") return tx.purchaseOrders.length;
    if (tab === "supplierInvoice") return tx.supplierBills.length;
    if (tab === "purchasePayment") return tx.payments.filter(r => r.partyType === "Supplier").length;
    return tx.expenses.length;
  }

  function existingRows() {
    if (tab === "salesQuote") return tx.quotes.map(r => <tr key={r.quoteId}><td><Link prefetch={false} href={documentHref("quote", r.quoteId, "list")}><strong>{r.quoteNumber}</strong></Link></td><td>{r.customerId}<br />{r.projectId}</td><td>{money(r.totalAmount)}</td><td>{r.status}</td><td><div className="row-actions">{view("quote", r.quoteId)}{workflowActions("quote", r.quoteId, r.status)}</div></td></tr>);
    if (tab === "salesInvoice") return tx.invoices.map(r => <tr key={r.invoiceId}><td><Link prefetch={false} href={documentHref("invoice", r.invoiceId, "list")}><strong>{r.invoiceNumber}</strong></Link></td><td>{r.customerId}<br />{r.projectId}</td><td>{money(r.totalAmount)}<br /><span className="small">Outstanding {money(r.outstandingAmount)}</span></td><td>{r.status}</td><td><div className="row-actions">{view("invoice", r.invoiceId)}{workflowActions("invoice", r.invoiceId, r.status)}</div></td></tr>);
    if (tab === "supplierQuote") return tx.supplierQuotes.map(r => <tr key={r.poId}><td><Link prefetch={false} href={documentHref("purchaseOrder", r.poId, "list")}><strong>{r.poNumber}</strong></Link></td><td>{r.supplierId}<br />{r.projectId}</td><td>{money(r.totalAmount)}</td><td>{r.status}</td><td><div className="row-actions">{view("purchaseOrder", r.poId)}{workflowActions("purchaseOrder", r.poId, r.status)}</div></td></tr>);
    if (tab === "purchaseOrder") return tx.purchaseOrders.map(r => <tr key={r.poId}><td><Link prefetch={false} href={documentHref("purchaseOrder", r.poId, "list")}><strong>{r.poNumber}</strong></Link></td><td>{r.supplierId}<br />{r.projectId}</td><td>{money(r.totalAmount)}</td><td>{r.status}</td><td><div className="row-actions">{view("purchaseOrder", r.poId)}{workflowActions("purchaseOrder", r.poId, r.status)}</div></td></tr>);
    if (tab === "supplierInvoice") return tx.supplierBills.map(r => <tr key={r.billId}><td><Link prefetch={false} href={documentHref("supplierBill", r.billId, "list")}><strong>{r.billNumber || r.billId}</strong></Link></td><td>{r.supplierId}<br />{r.projectId}</td><td>{money(r.totalAmount)}<br /><span className="small">Outstanding {money(r.outstandingAmount ?? r.totalAmount)}</span></td><td>{r.status}</td><td><div className="row-actions">{view("supplierBill", r.billId)}{workflowActions("supplierBill", r.billId, r.status)}</div></td></tr>);
    if (tab === "salesPayment") return tx.payments.filter(r => r.partyType === "Customer").map(r => <tr key={r.paymentId}><td><Link prefetch={false} href={documentHref("payment", r.paymentId, "list")}><strong>{r.paymentNumber}</strong></Link></td><td>Customer: {r.partyId}<br />{r.projectId}</td><td>{money(r.amount)}</td><td>{r.status}{r.journalId ? <><br /><span className="small">Finalized</span></> : null}</td><td><div className="row-actions">{view("payment", r.paymentId)}{workflowActions("payment", r.paymentId, r.status)}</div></td></tr>);
    if (tab === "purchasePayment") return tx.payments.filter(r => r.partyType === "Supplier").map(r => <tr key={r.paymentId}><td><Link prefetch={false} href={documentHref("payment", r.paymentId, "list")}><strong>{r.paymentNumber}</strong></Link></td><td>Supplier: {r.partyId}<br />{r.projectId}</td><td>{money(r.amount)}</td><td>{r.status}{r.journalId ? <><br /><span className="small">Finalized</span></> : null}</td><td><div className="row-actions">{view("payment", r.paymentId)}{workflowActions("payment", r.paymentId, r.status)}</div></td></tr>);
    return tx.expenses.map(r => <tr key={r.expenseId}><td><Link prefetch={false} href={documentHref("expense", r.expenseId, "list")}><strong>{r.expenseNumber}</strong></Link></td><td>{r.supplierId}<br />{r.projectId}</td><td>{money(r.totalAmount)}</td><td>{r.status}</td><td><div className="row-actions">{view("expense", r.expenseId)}{workflowActions("expense", r.expenseId, r.status)}</div></td></tr>);
  }

  return <>
    <div className="page-heading"><div><h2>{title}</h2><p className="small">Choose a transaction section, then create a new document or work only with the existing document list.</p></div></div>

    {module === "sales" && <div className="tabs wrap-tabs">{tabButton("salesQuote", "Sales Quotation")}{tabButton("salesInvoice", "Sales Invoice")}{tabButton("salesPayment", "Sales Payment Entry / Receipt")}</div>}
    {module === "purchase" && <div className="tabs wrap-tabs">{tabButton("supplierQuote", "Supplier Quotation")}{tabButton("purchaseOrder", "Purchase Order")}{tabButton("supplierInvoice", "Supplier Invoice")}{tabButton("purchasePayment", "Purchase Payment Entry / Receipt")}</div>}

    {status && <section className="panel status-banner">{status}</section>}

    {sectionMode === "menu" && <section className={`panel ${styles.chooser}`}>
      <div className={styles.chooserHeader}><h3>{section.title}</h3><p className="small">Select one workspace. Create and existing-document views are kept separate so they never compete on the same screen.</p></div>
      <div className={styles.chooserGrid}>
        <button type="button" className={styles.ctaCard} onClick={() => openMode("create")}>
          <span className={styles.ctaTitle}>{section.createLabel}</span>
          <span className={styles.ctaCopy}>Open the new-document workflow for this section.</span>
        </button>
        <button type="button" className={`secondary ${styles.ctaCard}`} onClick={() => openMode("list")}>
          <span className={styles.ctaTitle}>{section.listLabel}</span>
          <span className={styles.ctaCopy}>Show only saved documents. Open any row to view, print or continue its workflow.</span>
        </button>
      </div>
    </section>}

    {sectionMode !== "menu" && <section className={`panel ${styles.contextBar}`}>
      <button type="button" className="secondary" onClick={backToSection}>← Back to {section.title}</button>
      <span className={styles.contextTitle}>{sectionMode === "create" ? section.createLabel : section.listLabel}</span>
    </section>}

    {sectionMode === "create" && commercial && <form className="panel" onSubmit={submitCommercial}>
      <div className="form-title-row"><h3>{section.createLabel}</h3><span className="auto-badge">Document No: {nextDocumentNo || "AUTO"}</span></div>
      <div className="form-grid">
        <label>{salesSide ? "Customer" : "Supplier"}<input list={partyListId} value={partyInput} onChange={e => handlePartyInput(e.target.value)} placeholder={`Type ${salesSide ? "customer" : "supplier"} name or ID`} autoComplete="off" required /><datalist id={partyListId}>{partyOptions.map(p => <option key={partyId(p)} value={partyDisplay(p)} />)}</datalist></label>
        <label>Project<select name="projectId" defaultValue=""><option value="">No project</option>{projectOptions.map(p => <option key={p.projectId} value={p.projectId}>{p.projectName} ({p.projectId})</option>)}</select></label>
        <label>{numberLabel}<input value={nextDocumentNo || "AUTO"} readOnly /></label><div></div>
        <label>Date<input name="documentDate" type="date" required defaultValue={localDate()} /></label>
        {tab === "salesInvoice" && <label>Due Date<input name="dueDate" type="date" defaultValue={localDate(30)} /></label>}
        {(tab === "salesQuote" || tab === "supplierQuote") && <label>Valid Till<input name="expiryDate" type="date" defaultValue={localDate(7)} /></label>}
        <label>GST %<input name="gstRate" type="number" min="0" max="100" step="0.01" value={gstRate} onChange={e => setGstRate(e.target.value)} /></label>
        {tab === "salesInvoice" && <label>Revenue Account<input name="accountId" placeholder="ACC-4100" /></label>}
      </div>
      <h4>Lines</h4>
      <div className="table-wrap"><table className="data-table" style={{ minWidth: 920 }}><thead><tr><th style={{ width: "42%" }}>Item Description</th><th>QTY</th><th>UOM</th><th>Unit Price</th><th>Total Price</th><th></th></tr></thead><tbody>{lines.map((l, i) => <tr key={i}><td><input value={l.description} onChange={e => setLine(i, "description", e.target.value)} required /></td><td><input type="number" min="0.0001" step="0.0001" value={l.qty} onChange={e => setLine(i, "qty", e.target.value)} /></td><td><input value={l.uom} onChange={e => setLine(i, "uom", e.target.value)} /></td><td><input type="number" min="0" step="0.01" value={l.rate} onChange={e => setLine(i, "rate", e.target.value)} /></td><td><strong>{money((Number(l.qty) || 0) * (Number(l.rate) || 0))}</strong></td><td><button type="button" className="secondary" onClick={() => removeLine(i)}>Remove</button></td></tr>)}</tbody></table></div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}><div style={{ width: "min(420px,100%)", border: "1px solid #e5ebf2", borderRadius: 10, overflow: "hidden", background: "#fff" }}><div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px" }}><span>Sub Total</span><strong>{money(subtotal)}</strong></div><div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px" }}><span>GST {Number(gstRate || 0).toFixed(2)}%</span><strong>{money(gstAmount)}</strong></div><div style={{ display: "flex", justifyContent: "space-between", padding: 14, background: "#f8fafc", fontSize: 18 }}><strong>Net Total</strong><strong>{money(netTotal)}</strong></div></div></div>
      <div className="button-row"><button type="button" className="secondary" onClick={addLine}>Add Line</button><button type="submit">Save Draft</button></div>
    </form>}

    {sectionMode === "create" && tab === "salesPayment" && <>
      <section className={`panel ${styles.sourcePanel}`}><div className="form-title-row"><div><h3>Create New Sales Payment Entry / Receipt</h3><p className="small">Select an approved Sales Invoice with an outstanding balance. This source list is only for creating the payment; existing Payment Entries are kept in the separate list CTA.</p></div><span className="auto-badge">Next Payment No: {nextDocumentNo || "AUTO"}</span></div></section>
      <section className="panel table-wrap"><div className="form-title-row"><h3>Approved Sales Invoices Pending Payment</h3><span className="auto-badge">{existingLoading ? "Loading…" : `${approvedInvoices.length} Pending`}</span></div><table className="data-table"><thead><tr><th>Sales Invoice</th><th>Customer</th><th>Project</th><th>Invoice Total</th><th>Outstanding</th><th>Action</th></tr></thead><tbody>{!existingLoading && approvedInvoices.length === 0 && <tr><td colSpan={6}>No approved Sales Invoices with outstanding balance.</td></tr>}{approvedInvoices.map(inv => <tr key={inv.invoiceId}><td><Link prefetch={false} href={documentHref("invoice", inv.invoiceId, "create")}><strong>{inv.invoiceNumber || inv.invoiceId}</strong></Link></td><td>{inv.customerId || "—"}</td><td>{inv.projectId || "—"}</td><td>{money(inv.totalAmount)}</td><td><strong>{money(inv.outstandingAmount ?? inv.totalAmount)}</strong></td><td><button type="button" onClick={() => selectInvoiceForPayment(inv)}>Convert Now</button></td></tr>)}</tbody></table></section>
      <section className="panel"><h3>Manual Search by Sales Invoice No</h3><div className="form-grid" style={{ marginTop: 16 }}><label>Sales Invoice No<input value={salesInvoiceSearch} onChange={e => setSalesInvoiceSearch(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void searchApprovedSalesInvoice(); } }} placeholder="e.g. SI-2026-00001" autoComplete="off" /></label><div style={{ display: "flex", alignItems: "end" }}><button type="button" style={{ width: "100%", height: 52 }} onClick={() => void searchApprovedSalesInvoice()} disabled={existingLoading}>{existingLoading ? "Searching…" : "Search"}</button></div></div>{searchedSalesInvoice && <div style={{ marginTop: 20 }}><div className="document-meta"><div><span>Sales Invoice</span><strong><Link prefetch={false} href={documentHref("invoice", searchedSalesInvoice.invoiceId, "create")}>{searchedSalesInvoice.invoiceNumber || searchedSalesInvoice.invoiceId}</Link></strong></div><div><span>Customer</span><strong>{searchedSalesInvoice.customerId || "—"}</strong></div><div><span>Project</span><strong>{searchedSalesInvoice.projectId || "—"}</strong></div><div><span>Invoice Total</span><strong>{money(searchedSalesInvoice.totalAmount)}</strong></div><div><span>Outstanding</span><strong>{money(searchedSalesInvoice.outstandingAmount ?? searchedSalesInvoice.totalAmount)}</strong></div><div><span>Status</span><strong>{searchedSalesInvoice.status}</strong></div></div><div className="button-row" style={{ marginTop: 18 }}><button type="button" onClick={() => selectInvoiceForPayment(searchedSalesInvoice)}>Convert to Payment Entry</button></div></div>}</section>
      {selectedSalesInvoice && <form id="sales-payment-draft-form" className="panel form-grid" onSubmit={saveSalesPaymentDraft}><h3 className="form-title">New Sales Payment Entry / Receipt</h3><label>Sales Invoice<input value={selectedSalesInvoice.invoiceNumber || selectedSalesInvoice.invoiceId} readOnly /></label><label>Customer<input value={selectedSalesInvoice.customerId || ""} readOnly /></label><label>Project<input value={selectedSalesInvoice.projectId || "No project"} readOnly /></label><label>Auto Sales Payment / Receipt No<input value={nextDocumentNo || "AUTO"} readOnly /></label><label>Invoice Total<input value={money(selectedSalesInvoice.totalAmount)} readOnly /></label><label>Outstanding<input value={money(selectedSalesInvoice.outstandingAmount ?? selectedSalesInvoice.totalAmount)} readOnly /></label><label>Payment Date<input name="paymentDate" type="date" defaultValue={localDate()} required /></label><label>Amount<input name="amount" type="number" min="0.01" max={Number(selectedSalesInvoice.outstandingAmount ?? selectedSalesInvoice.totalAmount ?? 0)} step="0.01" defaultValue={Number(selectedSalesInvoice.outstandingAmount ?? selectedSalesInvoice.totalAmount ?? 0)} required /></label><label>Payment Method<select name="paymentMethod" defaultValue="" required><option value="">Select payment method</option><option>Cash</option><option>Bank Transfer</option><option>Card</option><option>Cheque</option></select></label><label>Cash / Bank Account<input name="cashBankAccountId" placeholder="Select / enter cash or bank account" required /></label><label className="form-wide">Reference<input name="reference" placeholder="Bank reference / receipt reference" /></label><div className="form-wide button-row"><button type="button" className="secondary" onClick={() => setSelectedSalesInvoice(null)}>Cancel</button><button type="submit" disabled={conversionBusy}>{conversionBusy ? "Saving Draft…" : "Save Draft"}</button></div></form>}
    </>}

    {sectionMode === "create" && tab === "supplierInvoice" && <>
      <section className="panel"><div className="form-title-row"><div><h3>Create New Supplier Invoice</h3><p className="small">Supplier Invoices are created from approved Purchase Orders so the source document and three-way-match controls remain linked.</p></div><span className="auto-badge">{existingLoading ? "Loading…" : `${approvedPurchaseOrders.length} PO Ready`}</span></div></section>
      <section className="panel table-wrap"><table className="data-table"><thead><tr><th>Purchase Order</th><th>Supplier</th><th>Project</th><th>Total</th><th>Status</th><th>Action</th></tr></thead><tbody>{!existingLoading && approvedPurchaseOrders.length === 0 && <tr><td colSpan={6}>No approved Purchase Orders are currently pending Supplier Invoice conversion.</td></tr>}{approvedPurchaseOrders.map(po => <tr key={po.poId}><td><Link prefetch={false} href={documentHref("purchaseOrder", po.poId, "create")}><strong>{po.poNumber || po.poId}</strong></Link></td><td>{po.supplierId || "—"}</td><td>{po.projectId || "—"}</td><td>{money(po.totalAmount)}</td><td>{po.status}</td><td><button type="button" disabled={conversionBusy} onClick={() => void createSupplierInvoiceFromPo(po)}>{conversionBusy ? "Creating…" : "Create Supplier Invoice"}</button></td></tr>)}</tbody></table></section>
    </>}

    {sectionMode === "create" && tab === "purchasePayment" && <PurchasePaymentStaged />}

    {sectionMode === "create" && tab === "expense" && <form className="panel form-grid" onSubmit={submitExpense}><h3 className="form-title">Create New Expense</h3><label>Date<input name="expenseDate" type="date" required defaultValue={localDate()} /></label><label>Supplier<input list="expense-supplier-suggestions" value={expenseSupplierInput} onChange={e => handleExpenseSupplierInput(e.target.value)} /><datalist id="expense-supplier-suggestions">{masters.suppliers.map(p => <option key={partyId(p)} value={partyDisplay(p)} />)}</datalist></label><label>Project<select name="projectId" defaultValue=""><option value="">No project</option>{masters.projects.map(p => <option key={p.projectId} value={p.projectId}>{p.projectName}</option>)}</select></label><label>Expense Account<input name="expenseAccountId" defaultValue="ACC-6600" required /></label><label>Net Amount<input name="netAmount" type="number" min="0" step="0.01" required /></label><label>GST Amount<input name="gstAmount" type="number" min="0" step="0.01" defaultValue="0" /></label><label>Payment Method<select name="paymentMethod"><option>Cash</option><option>Bank Transfer</option><option>Card</option></select></label><label>Cash / Bank Account<input name="cashBankAccountId" defaultValue="ACC-1110" required /></label><label className="form-wide">Description<input name="description" required /></label><div className="form-wide"><button type="submit">Save Draft</button></div></form>}

    {sectionMode === "list" && <section className="panel table-wrap"><div className="form-title-row"><h3>{section.existingTitle}</h3><span className="auto-badge">{existingLoading ? "Loading…" : `${existingCount()} Documents`}</span></div><table className="data-table"><thead><tr><th>ID / Number</th><th>Party / Project</th><th>Total / Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>{!existingLoading && existingCount() === 0 && <tr><td colSpan={5}>No existing documents found in this section.</td></tr>}{existingRows()}</tbody></table></section>}
  </>;
}
