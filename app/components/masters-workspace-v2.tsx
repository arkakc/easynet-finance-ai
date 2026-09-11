"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlowCreateLink, FlowReturnPanel, notifyFlowDataChanged, useFlowDataRefresh } from "@/app/components/flow-navigation";

type Customer = {
  customerId: string;
  customerName: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  taxId?: string;
  creditTermsDays?: number | string;
  creditLimit?: number | string;
  createdAt?: string;
};

type Supplier = {
  supplierId: string;
  supplierName: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  taxId?: string;
  paymentTermsDays?: number | string;
  createdAt?: string;
};

type Project = {
  projectId: string;
  projectName: string;
  customerId: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  contractNet?: number | string;
  gstAmount?: number | string;
  contractTotal?: number | string;
  expectedCost?: number | string;
  projectManager?: string;
  createdAt?: string;
};

type Data = { customers: Customer[]; suppliers: Supplier[]; projects: Project[] };
type Tab = "customer" | "supplier" | "project";
const emptyData: Data = { customers: [], suppliers: [], projects: [] };

function formatDate(dateString?: string) {
  if (!dateString) return "—";
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return String(dateString);
  return new Intl.DateTimeFormat("en-PG", {
    timeZone: "Pacific/Port_Moresby",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export default function MastersWorkspaceV2() {
  const [data, setData] = useState<Data>(emptyData);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<Tab>("customer");
  const [savingType, setSavingType] = useState<Tab | "">("");
  const [lastSavedLabel, setLastSavedLabel] = useState("");

  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const [customerView, setCustomerView] = useState<"list" | "form">("list");
  const [supplierView, setSupplierView] = useState<"list" | "form">("list");
  const [projectView, setProjectView] = useState<"list" | "form">("list");

  const [deletingCustomerId, setDeletingCustomerId] = useState<string>("");
  const [deletingSupplierId, setDeletingSupplierId] = useState<string>("");
  const [deletingProjectId, setDeletingProjectId] = useState<string>("");

  const loadedScopes = useRef(new Set<Tab>());
  const busy = Boolean(savingType) || Boolean(deletingCustomerId) || Boolean(deletingSupplierId) || Boolean(deletingProjectId);

  const customerOptions = useMemo(
    () => [...data.customers].sort((a, b) => a.customerName.localeCompare(b.customerName)),
    [data.customers]
  );

  const sortedCustomers = useMemo(() => {
    return [...data.customers].sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (timeB !== timeA) return timeB - timeA;
      return (b.customerId || "").localeCompare(a.customerId || "");
    });
  }, [data.customers]);

  const sortedSuppliers = useMemo(() => {
    return [...data.suppliers].sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (timeB !== timeA) return timeB - timeA;
      return (b.supplierId || "").localeCompare(a.supplierId || "");
    });
  }, [data.suppliers]);

  const sortedProjects = useMemo(() => {
    return [...data.projects].sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (timeB !== timeA) return timeB - timeA;
      return (b.projectId || "").localeCompare(a.projectId || "");
    });
  }, [data.projects]);

  const loadData = useCallback(async (scope: Tab, showLoading = true, force = false) => {
    if (loadedScopes.current.has(scope) && !force) {
      if (showLoading) setLoading(false);
      return;
    }
    if (showLoading) setLoading(true);
    try {
      const response = await fetch(`/api/masters/scoped?scope=${encodeURIComponent(scope)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Failed to load master data");
      setData(current => ({
        customers: Array.isArray(body.customers) ? body.customers : current.customers,
        suppliers: Array.isArray(body.suppliers) ? body.suppliers : current.suppliers,
        projects: Array.isArray(body.projects) ? body.projects : current.projects,
      }));
      loadedScopes.current.add(scope);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Master-data load failed");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("tab");
    const initial: Tab = requested === "supplier" || requested === "project" || requested === "customer" ? requested : "customer";
    setTab(initial);
    const frame = window.requestAnimationFrame(() => { void loadData(initial, true); });
    return () => window.cancelAnimationFrame(frame);
  }, [loadData]);

  useFlowDataRefresh(() => {
    loadedScopes.current.delete(tab);
    void loadData(tab, false, true);
  });

  async function submitRecord(type: Tab, record: Record<string, unknown>, mode: "create" | "update") {
    if (busy) return false;
    setSavingType(type);
    setMessage("Saving...");
    setLastSavedLabel("");
    try {
      const response = await fetch("/api/erp/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "masters", body: { type, mode, record } }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Save failed");
      const label = type === "customer" ? "Customer" : type === "supplier" ? "Supplier" : "Project";
      const row = body.row || body.result?.row || {};
      const id = String(row.customerId || row.supplierId || row.projectId || "");
      setMessage(`${label} saved successfully${id ? ` · ${id}` : ""}.`);
      setLastSavedLabel(label);
      notifyFlowDataChanged(type, id);
      loadedScopes.current.delete(type);
      await loadData(type, false, true);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
      return false;
    } finally {
      setSavingType("");
    }
  }

  async function submitCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const record = Object.fromEntries(new FormData(form).entries());
    const mode = editingCustomer ? "update" : "create";
    if (editingCustomer) record.customerId = editingCustomer.customerId;
    const ok = await submitRecord("customer", record, mode);
    if (ok) {
      setEditingCustomer(null);
      form.reset();
      setCustomerView("list");
    }
  }

  async function deleteCustomer(customer: Customer) {
    if (busy || deletingCustomerId) return;
    const ok = window.confirm(
      `Are you sure you want to delete customer "${customer.customerName}" (${customer.customerId})?\n\nNote: If this customer has accounts ledger entries or transactions (invoices, quotes, payments, projects), deletion will be blocked.`
    );
    if (!ok) return;
    setDeletingCustomerId(customer.customerId);
    setMessage("Checking accounts ledger and deleting customer...");
    try {
      const response = await fetch("/api/erp/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: "masters",
          body: { type: "customer", mode: "delete", record: { customerId: customer.customerId } },
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        throw new Error(body.error || "Failed to delete customer");
      }
      setMessage(`Customer "${customer.customerName}" deleted successfully.`);
      loadedScopes.current.delete("customer");
      await loadData("customer", false, true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Customer delete failed");
    } finally {
      setDeletingCustomerId("");
    }
  }

  async function submitSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const record = Object.fromEntries(new FormData(form).entries());
    const mode = editingSupplier ? "update" : "create";
    if (editingSupplier) record.supplierId = editingSupplier.supplierId;
    const ok = await submitRecord("supplier", record, mode);
    if (ok) {
      setEditingSupplier(null);
      form.reset();
      setSupplierView("list");
    }
  }

  async function deleteSupplier(supplier: Supplier) {
    if (busy || deletingSupplierId) return;
    const ok = window.confirm(
      `Are you sure you want to delete supplier "${supplier.supplierName}" (${supplier.supplierId})?\n\nNote: If this supplier has accounts ledger entries or transactions (bills, orders, quotes, payments, expenses), deletion will be blocked.`
    );
    if (!ok) return;
    setDeletingSupplierId(supplier.supplierId);
    setMessage("Checking accounts ledger and deleting supplier...");
    try {
      const response = await fetch("/api/erp/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: "masters",
          body: { type: "supplier", mode: "delete", record: { supplierId: supplier.supplierId } },
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        throw new Error(body.error || "Failed to delete supplier");
      }
      setMessage(`Supplier "${supplier.supplierName}" deleted successfully.`);
      loadedScopes.current.delete("supplier");
      await loadData("supplier", false, true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Supplier delete failed");
    } finally {
      setDeletingSupplierId("");
    }
  }

  async function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const record = Object.fromEntries(new FormData(form).entries());
    const mode = editingProject ? "update" : "create";
    if (editingProject) record.projectId = editingProject.projectId;
    const ok = await submitRecord("project", record, mode);
    if (ok) {
      setEditingProject(null);
      form.reset();
      setProjectView("list");
    }
  }

  async function deleteProject(project: Project) {
    if (busy || deletingProjectId) return;
    const ok = window.confirm(
      `Are you sure you want to delete project "${project.projectName}" (${project.projectId})?\n\nNote: If this project has accounts ledger entries or transactions (invoices, bills, orders, quotes, payments, expenses, stock movements), deletion will be blocked.`
    );
    if (!ok) return;
    setDeletingProjectId(project.projectId);
    setMessage("Checking accounts ledger and deleting project...");
    try {
      const response = await fetch("/api/erp/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: "masters",
          body: { type: "project", mode: "delete", record: { projectId: project.projectId } },
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        throw new Error(body.error || "Failed to delete project");
      }
      setMessage(`Project "${project.projectName}" deleted successfully.`);
      loadedScopes.current.delete("project");
      await loadData("project", false, true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Project delete failed");
    } finally {
      setDeletingProjectId("");
    }
  }

  function switchTab(next: Tab) {
    if (busy) return;
    setTab(next);
    setMessage("");
    setLastSavedLabel("");
    setLoading(!loadedScopes.current.has(next));
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
    if (!loadedScopes.current.has(next)) {
      window.requestAnimationFrame(() => { void loadData(next, true); });
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Business Entity Masters</h2>
          <p className="small">Centralized master database for Customers, Suppliers, and Job Costing Projects.</p>
        </div>
        <div className="page-head-actions">
          {message && (
            <details className="system-notice-tab">
              <summary>
                <span>ℹ️ System Notice</span>
                <span className="notice-arrow">▾</span>
              </summary>
              <div className="system-notice-dropdown">
                <strong>Master status:</strong> {message}
              </div>
            </details>
          )}
          <span className="badge">Master Records</span>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="label">Customers</div>
          <div className="value">{data.customers.length}</div>
        </div>
        <div className="card">
          <div className="label">Suppliers</div>
          <div className="value">{data.suppliers.length}</div>
        </div>
        <div className="card">
          <div className="label">Active Projects</div>
          <div className="value">{data.projects.length}</div>
        </div>
        <div className="card">
          <div className="label">Active Scope</div>
          <div className="value small-value" style={{ textTransform: "capitalize" }}>{tab}s</div>
        </div>
      </div>

      <FlowReturnPanel savedLabel={lastSavedLabel} />
      <div className="tabs">
        <button disabled={busy} className={tab === "customer" ? "tab active" : "tab"} onClick={() => switchTab("customer")}>Customers</button>
        <button disabled={busy} className={tab === "supplier" ? "tab active" : "tab"} onClick={() => switchTab("supplier")}>Suppliers</button>
        <button disabled={busy} className={tab === "project" ? "tab active" : "tab"} onClick={() => switchTab("project")}>Projects</button>
      </div>
      {loading && <section className="panel"><p className="small">Loading live {tab} data…</p></section>}

      {/* CUSTOMER TAB */}
      {tab === "customer" && (
        <>
          <div style={{ display: "flex", gap: "10px", marginBottom: "16px", alignItems: "center" }}>
            <button
              type="button"
              disabled={busy}
              className={customerView === "list" ? "tab active" : "tab"}
              onClick={() => { if (!busy) { setCustomerView("list"); setEditingCustomer(null); } }}
              style={{ minHeight: "38px" }}
            >
              📋 View Existing Customers ({data.customers.length})
            </button>
            <button
              type="button"
              disabled={busy}
              className={customerView === "form" ? "tab active" : "tab"}
              onClick={() => { if (!busy) { setCustomerView("form"); } }}
              style={{ minHeight: "38px" }}
            >
              {editingCustomer ? `✏️ Edit Customer: ${editingCustomer.customerName}` : "➕ Create New Customer"}
            </button>
          </div>

          {customerView === "form" && (
            <form key={editingCustomer?.customerId || "new-customer"} className="panel form-grid" onSubmit={submitCustomer}>
              <div className="form-wide form-title-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <h3 className="form-title">{editingCustomer ? `Edit Customer: ${editingCustomer.customerName}` : "Create New Customer"}</h3>
                  <p className="small">Master record will be immediately available across sales quotations, sales invoices, and customer payments.</p>
                </div>
                <button type="button" className="secondary" disabled={busy} onClick={() => { setEditingCustomer(null); setCustomerView("list"); }}>
                  ← Back to View Existing Customers
                </button>
              </div>
              <label>Customer ID<input value={editingCustomer?.customerId || "Auto-generated on save"} readOnly disabled /></label>
              <label>Customer Name<input name="customerName" required defaultValue={editingCustomer?.customerName || ""} disabled={busy} /></label>
              <label>Contact Person<input name="contactPerson" defaultValue={editingCustomer?.contactPerson || ""} disabled={busy} /></label>
              <label>Phone<input name="phone" defaultValue={editingCustomer?.phone || ""} disabled={busy} /></label>
              <label>Email<input name="email" type="email" defaultValue={editingCustomer?.email || ""} disabled={busy} /></label>
              <label>Tax ID<input name="taxId" defaultValue={editingCustomer?.taxId || ""} disabled={busy} /></label>
              <label>Credit Terms (days)<input name="creditTermsDays" type="number" min="0" defaultValue={editingCustomer?.creditTermsDays ?? 0} disabled={busy} /></label>
              <label>Credit Limit<input name="creditLimit" type="number" min="0" step="0.01" defaultValue={editingCustomer?.creditLimit ?? 0} disabled={busy} /></label>
              <label className="form-wide">Address<textarea name="address" rows={2} defaultValue={editingCustomer?.address || ""} disabled={busy} /></label>
              <div className="form-wide button-row">
                <button
                  type="submit"
                  disabled={busy}
                  style={busy ? { opacity: 0.6, cursor: "not-allowed", filter: "grayscale(1)" } : undefined}
                >
                  {savingType === "customer" ? "Saving..." : editingCustomer ? "Save Changes" : "Save Customer"}
                </button>
                <button type="button" className="secondary" disabled={busy} onClick={() => { setEditingCustomer(null); setCustomerView("list"); }}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          {customerView === "list" && (
            <section className="panel table-wrap">
              <div className="form-title-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div>
                  <h3 className="form-title">Existing Customers</h3>
                  <p className="small">Sorted by newest creation date first. Click Edit to update or Delete to remove unused customers.</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { setEditingCustomer(null); setCustomerView("form"); }}
                >
                  + Create New Customer
                </button>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Customer</th>
                    <th>Created Date</th>
                    <th>Contact</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>Terms</th>
                    <th>Credit Limit</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCustomers.map(row => (
                    <tr key={row.customerId}>
                      <td>{row.customerId}</td>
                      <td><strong>{row.customerName}</strong></td>
                      <td>{formatDate(row.createdAt)}</td>
                      <td>{row.contactPerson || "—"}</td>
                      <td>{row.phone || "—"}</td>
                      <td>{row.email || "—"}</td>
                      <td>{row.creditTermsDays || 0} days</td>
                      <td>K{Number(row.creditLimit || 0).toLocaleString()}</td>
                      <td>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            type="button"
                            className="secondary"
                            disabled={busy}
                            onClick={() => { setEditingCustomer(row); setCustomerView("form"); }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            style={{ color: "#dc2626", borderColor: "#fca5a5" }}
                            disabled={busy || deletingCustomerId === row.customerId}
                            onClick={() => void deleteCustomer(row)}
                          >
                            {deletingCustomerId === row.customerId ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!loading && !data.customers.length && <tr><td colSpan={9}>No customers found.</td></tr>}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      {/* SUPPLIER TAB */}
      {tab === "supplier" && (
        <>
          <div style={{ display: "flex", gap: "10px", marginBottom: "16px", alignItems: "center" }}>
            <button
              type="button"
              disabled={busy}
              className={supplierView === "list" ? "tab active" : "tab"}
              onClick={() => { if (!busy) { setSupplierView("list"); setEditingSupplier(null); } }}
              style={{ minHeight: "38px" }}
            >
              📋 View Existing Suppliers ({data.suppliers.length})
            </button>
            <button
              type="button"
              disabled={busy}
              className={supplierView === "form" ? "tab active" : "tab"}
              onClick={() => { if (!busy) { setSupplierView("form"); } }}
              style={{ minHeight: "38px" }}
            >
              {editingSupplier ? `✏️ Edit Supplier: ${editingSupplier.supplierName}` : "➕ Create New Supplier"}
            </button>
          </div>

          {supplierView === "form" && (
            <form key={editingSupplier?.supplierId || "new-supplier"} className="panel form-grid" onSubmit={submitSupplier}>
              <div className="form-wide form-title-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <h3 className="form-title">{editingSupplier ? `Edit Supplier: ${editingSupplier.supplierName}` : "Create New Supplier"}</h3>
                  <p className="small">Master record will be available across purchase quotations, purchase orders, bills and expense entries.</p>
                </div>
                <button type="button" className="secondary" disabled={busy} onClick={() => { setEditingSupplier(null); setSupplierView("list"); }}>
                  ← Back to View Existing Suppliers
                </button>
              </div>
              <label>Supplier ID<input value={editingSupplier?.supplierId || "Auto-generated on save"} readOnly disabled /></label>
              <label>Supplier Name<input name="supplierName" required defaultValue={editingSupplier?.supplierName || ""} disabled={busy} /></label>
              <label>Contact Person<input name="contactPerson" defaultValue={editingSupplier?.contactPerson || ""} disabled={busy} /></label>
              <label>Phone<input name="phone" defaultValue={editingSupplier?.phone || ""} disabled={busy} /></label>
              <label>Email<input name="email" type="email" defaultValue={editingSupplier?.email || ""} disabled={busy} /></label>
              <label>Tax ID<input name="taxId" defaultValue={editingSupplier?.taxId || ""} disabled={busy} /></label>
              <label>Payment Terms (days)<input name="paymentTermsDays" type="number" min="0" defaultValue={editingSupplier?.paymentTermsDays ?? 0} disabled={busy} /></label>
              <label className="form-wide">Address<textarea name="address" rows={2} defaultValue={editingSupplier?.address || ""} disabled={busy} /></label>
              <div className="form-wide button-row">
                <button
                  type="submit"
                  disabled={busy}
                  style={busy ? { opacity: 0.6, cursor: "not-allowed", filter: "grayscale(1)" } : undefined}
                >
                  {savingType === "supplier" ? "Saving..." : editingSupplier ? "Save Changes" : "Save Supplier"}
                </button>
                <button type="button" className="secondary" disabled={busy} onClick={() => { setEditingSupplier(null); setSupplierView("list"); }}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          {supplierView === "list" && (
            <section className="panel table-wrap">
              <div className="form-title-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div>
                  <h3 className="form-title">Existing Suppliers</h3>
                  <p className="small">Sorted by newest creation date first. Click Edit to update or Delete to remove unused suppliers.</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { setEditingSupplier(null); setSupplierView("form"); }}
                >
                  + Create New Supplier
                </button>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Supplier</th>
                    <th>Created Date</th>
                    <th>Contact</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>Terms</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSuppliers.map(row => (
                    <tr key={row.supplierId}>
                      <td>{row.supplierId}</td>
                      <td><strong>{row.supplierName}</strong></td>
                      <td>{formatDate(row.createdAt)}</td>
                      <td>{row.contactPerson || "—"}</td>
                      <td>{row.phone || "—"}</td>
                      <td>{row.email || "—"}</td>
                      <td>{row.paymentTermsDays || 0} days</td>
                      <td>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            type="button"
                            className="secondary"
                            disabled={busy}
                            onClick={() => { setEditingSupplier(row); setSupplierView("form"); }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            style={{ color: "#dc2626", borderColor: "#fca5a5" }}
                            disabled={busy || deletingSupplierId === row.supplierId}
                            onClick={() => void deleteSupplier(row)}
                          >
                            {deletingSupplierId === row.supplierId ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!loading && !data.suppliers.length && <tr><td colSpan={8}>No suppliers found.</td></tr>}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      {/* PROJECT TAB */}
      {tab === "project" && (
        <>
          <div style={{ display: "flex", gap: "10px", marginBottom: "16px", alignItems: "center" }}>
            <button
              type="button"
              disabled={busy}
              className={projectView === "list" ? "tab active" : "tab"}
              onClick={() => { if (!busy) { setProjectView("list"); setEditingProject(null); } }}
              style={{ minHeight: "38px" }}
            >
              📋 View Existing Projects ({data.projects.length})
            </button>
            <button
              type="button"
              disabled={busy}
              className={projectView === "form" ? "tab active" : "tab"}
              onClick={() => { if (!busy) { setProjectView("form"); } }}
              style={{ minHeight: "38px" }}
            >
              {editingProject ? `✏️ Edit Project: ${editingProject.projectName}` : "➕ Create New Project"}
            </button>
          </div>

          {projectView === "form" && (
            <form key={editingProject?.projectId || "new-project"} className="panel form-grid" onSubmit={submitProject}>
              <div className="form-wide form-title-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <h3 className="form-title">{editingProject ? `Edit Project: ${editingProject.projectName}` : "Create New Project"}</h3>
                  <p className="small">If the Customer does not exist yet, create it in a separate tab; this Project form remains open and Customer choices refresh when you return.</p>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <FlowCreateLink target="customer" label="Create Customer in New Tab" returnLabel="New Project" />
                  <button type="button" className="secondary" disabled={busy} onClick={() => { setEditingProject(null); setProjectView("list"); }}>
                    ← Back to View Existing Projects
                  </button>
                </div>
              </div>
              <label>Project ID<input value={editingProject?.projectId || "Auto-generated on save"} readOnly disabled /></label>
              <label>Project Name<input name="projectName" required defaultValue={editingProject?.projectName || ""} disabled={busy} /></label>
              <label>
                Customer
                <select name="customerId" defaultValue={editingProject?.customerId || ""} disabled={busy}>
                  <option value="">No Customer / Internal Project</option>
                  {customerOptions.map(customer => (
                    <option key={customer.customerId} value={customer.customerId}>
                      {customer.customerName} ({customer.customerId})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select name="status" defaultValue={editingProject?.status || "OPEN"} disabled={busy}>
                  <option>OPEN</option>
                  <option>ACTIVE</option>
                  <option>ON HOLD</option>
                  <option>COMPLETED</option>
                  <option>CANCELLED</option>
                </select>
              </label>
              <label>Start Date<input name="startDate" type="date" defaultValue={editingProject?.startDate || ""} disabled={busy} /></label>
              <label>End Date<input name="endDate" type="date" defaultValue={editingProject?.endDate || ""} disabled={busy} /></label>
              <label>Contract Net<input name="contractNet" type="number" min="0" step="0.01" defaultValue={editingProject?.contractNet ?? 0} disabled={busy} /></label>
              <label>GST Amount<input name="gstAmount" type="number" min="0" step="0.01" defaultValue={editingProject?.gstAmount ?? 0} disabled={busy} /></label>
              <label>Contract Total<input name="contractTotal" type="number" min="0" step="0.01" defaultValue={editingProject?.contractTotal ?? 0} disabled={busy} /></label>
              <label>Expected Cost<input name="expectedCost" type="number" min="0" step="0.01" defaultValue={editingProject?.expectedCost ?? 0} disabled={busy} /></label>
              <label>Project Manager<input name="projectManager" defaultValue={editingProject?.projectManager || ""} disabled={busy} /></label>
              <div className="form-wide button-row">
                <button
                  type="submit"
                  disabled={busy}
                  style={busy ? { opacity: 0.6, cursor: "not-allowed", filter: "grayscale(1)" } : undefined}
                >
                  {savingType === "project" ? "Saving..." : editingProject ? "Save Changes" : "Save Project"}
                </button>
                <button type="button" className="secondary" disabled={busy} onClick={() => { setEditingProject(null); setProjectView("list"); }}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          {projectView === "list" && (
            <section className="panel table-wrap">
              <div className="form-title-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div>
                  <h3 className="form-title">Existing Projects</h3>
                  <p className="small">Sorted by newest creation date first. Click Edit to update or Delete to remove unused projects.</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { setEditingProject(null); setProjectView("form"); }}
                >
                  + Create New Project
                </button>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Project</th>
                    <th>Created Date</th>
                    <th>Customer</th>
                    <th>Status</th>
                    <th>Contract Total</th>
                    <th>Expected Cost</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedProjects.map(row => {
                    const customer = data.customers.find(c => c.customerId === row.customerId);
                    return (
                      <tr key={row.projectId}>
                        <td>{row.projectId}</td>
                        <td><strong>{row.projectName}</strong></td>
                        <td>{formatDate(row.createdAt)}</td>
                        <td>{customer ? `${customer.customerName} (${row.customerId})` : row.customerId || "Internal"}</td>
                        <td><span className="badge">{row.status || "OPEN"}</span></td>
                        <td>K{Number(row.contractTotal || 0).toLocaleString()}</td>
                        <td>K{Number(row.expectedCost || 0).toLocaleString()}</td>
                        <td>
                          <div style={{ display: "flex", gap: "6px" }}>
                            <button
                              type="button"
                              className="secondary"
                              disabled={busy}
                              onClick={() => { setEditingProject(row); setProjectView("form"); }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              style={{ color: "#dc2626", borderColor: "#fca5a5" }}
                              disabled={busy || deletingProjectId === row.projectId}
                              onClick={() => void deleteProject(row)}
                            >
                              {deletingProjectId === row.projectId ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!loading && !data.projects.length && <tr><td colSpan={8}>No projects found.</td></tr>}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </>
  );
}
