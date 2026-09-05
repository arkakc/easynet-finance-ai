"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

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
};

type Data = {
  customers: Customer[];
  suppliers: Supplier[];
  projects: Project[];
};

const emptyData: Data = { customers: [], suppliers: [], projects: [] };

export default function MastersPage() {
  const [data, setData] = useState<Data>(emptyData);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [secret, setSecret] = useState("");
  const [tab, setTab] = useState<"customer" | "supplier" | "project">("customer");

  const customerOptions = useMemo(
    () => [...data.customers].sort((a, b) => a.customerName.localeCompare(b.customerName)),
    [data.customers],
  );

  async function loadData() {
    setLoading(true);
    try {
      const response = await fetch("/api/masters", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Failed to load master data");
      setData({
        customers: body.customers || [],
        suppliers: body.suppliers || [],
        projects: body.projects || [],
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Master-data load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function submitRecord(type: "customer" | "supplier" | "project", record: Record<string, unknown>) {
    setMessage("Saving...");
    try {
      const response = await fetch("/api/masters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, type, record }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Save failed");
      setMessage(`${type} saved successfully.`);
      await loadData();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
      return false;
    }
  }

  async function submitCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const ok = await submitRecord("customer", Object.fromEntries(form.entries()));
    if (ok) formElement.reset();
  }

  async function submitSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const ok = await submitRecord("supplier", Object.fromEntries(form.entries()));
    if (ok) formElement.reset();
  }

  async function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const ok = await submitRecord("project", Object.fromEntries(form.entries()));
    if (ok) formElement.reset();
  }

  return (
    <>
      <h2>Business Masters</h2>
      <p className="small">Create and review customers, suppliers and projects stored in the live Google Sheets backend.</p>

      <section className="panel">
        <label htmlFor="master-secret">APP_SECRET for write actions</label>
        <input
          id="master-secret"
          type="password"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          autoComplete="off"
          placeholder="Required only when saving records"
        />
      </section>

      <div className="tabs">
        <button className={tab === "customer" ? "tab active" : "tab"} onClick={() => setTab("customer")}>Customers</button>
        <button className={tab === "supplier" ? "tab active" : "tab"} onClick={() => setTab("supplier")}>Suppliers</button>
        <button className={tab === "project" ? "tab active" : "tab"} onClick={() => setTab("project")}>Projects</button>
      </div>

      {message && <section className="panel"><strong>Status:</strong> {message}</section>}

      {tab === "customer" && (
        <>
          <form className="panel form-grid" onSubmit={submitCustomer}>
            <h3 className="form-title">New Customer</h3>
            <label>Customer ID<input name="customerId" placeholder="Optional, auto-generated if blank" /></label>
            <label>Customer Name<input name="customerName" required /></label>
            <label>Contact Person<input name="contactPerson" /></label>
            <label>Phone<input name="phone" /></label>
            <label>Email<input name="email" type="email" /></label>
            <label>Tax ID<input name="taxId" /></label>
            <label>Credit Terms (days)<input name="creditTermsDays" type="number" min="0" defaultValue="0" /></label>
            <label>Credit Limit<input name="creditLimit" type="number" min="0" step="0.01" defaultValue="0" /></label>
            <label className="form-wide">Address<textarea name="address" rows={2} /></label>
            <div className="form-wide"><button type="submit">Save Customer</button></div>
          </form>

          <section className="panel table-wrap">
            <table className="data-table">
              <thead><tr><th>ID</th><th>Customer</th><th>Contact</th><th>Phone</th><th>Email</th><th>Terms</th><th>Limit</th></tr></thead>
              <tbody>
                {data.customers.map((row) => (
                  <tr key={row.customerId}><td>{row.customerId}</td><td>{row.customerName}</td><td>{row.contactPerson || "—"}</td><td>{row.phone || "—"}</td><td>{row.email || "—"}</td><td>{row.creditTermsDays || 0} days</td><td>{row.creditLimit || 0}</td></tr>
                ))}
                {!loading && !data.customers.length && <tr><td colSpan={7}>No customers found.</td></tr>}
              </tbody>
            </table>
          </section>
        </>
      )}

      {tab === "supplier" && (
        <>
          <form className="panel form-grid" onSubmit={submitSupplier}>
            <h3 className="form-title">New Supplier</h3>
            <label>Supplier ID<input name="supplierId" placeholder="Optional, auto-generated if blank" /></label>
            <label>Supplier Name<input name="supplierName" required /></label>
            <label>Contact Person<input name="contactPerson" /></label>
            <label>Phone<input name="phone" /></label>
            <label>Email<input name="email" type="email" /></label>
            <label>Tax ID<input name="taxId" /></label>
            <label>Payment Terms (days)<input name="paymentTermsDays" type="number" min="0" defaultValue="0" /></label>
            <label className="form-wide">Address<textarea name="address" rows={2} /></label>
            <div className="form-wide"><button type="submit">Save Supplier</button></div>
          </form>

          <section className="panel table-wrap">
            <table className="data-table">
              <thead><tr><th>ID</th><th>Supplier</th><th>Contact</th><th>Phone</th><th>Email</th><th>Terms</th></tr></thead>
              <tbody>
                {data.suppliers.map((row) => (
                  <tr key={row.supplierId}><td>{row.supplierId}</td><td>{row.supplierName}</td><td>{row.contactPerson || "—"}</td><td>{row.phone || "—"}</td><td>{row.email || "—"}</td><td>{row.paymentTermsDays || 0} days</td></tr>
                ))}
                {!loading && !data.suppliers.length && <tr><td colSpan={6}>No suppliers found.</td></tr>}
              </tbody>
            </table>
          </section>
        </>
      )}

      {tab === "project" && (
        <>
          <form className="panel form-grid" onSubmit={submitProject}>
            <h3 className="form-title">New Project</h3>
            <label>Project ID<input name="projectId" placeholder="Example: PJ-01-2026" /></label>
            <label>Project Name<input name="projectName" required /></label>
            <label>Customer
              <select name="customerId" required defaultValue="">
                <option value="" disabled>Select customer</option>
                {customerOptions.map((customer) => <option key={customer.customerId} value={customer.customerId}>{customer.customerName} ({customer.customerId})</option>)}
              </select>
            </label>
            <label>Status<select name="status" defaultValue="OPEN"><option>OPEN</option><option>ACTIVE</option><option>ON HOLD</option><option>COMPLETED</option><option>CANCELLED</option></select></label>
            <label>Start Date<input name="startDate" type="date" /></label>
            <label>End Date<input name="endDate" type="date" /></label>
            <label>Contract Net<input name="contractNet" type="number" min="0" step="0.01" defaultValue="0" /></label>
            <label>GST Amount<input name="gstAmount" type="number" min="0" step="0.01" defaultValue="0" /></label>
            <label>Contract Total<input name="contractTotal" type="number" min="0" step="0.01" defaultValue="0" /></label>
            <label>Expected Cost<input name="expectedCost" type="number" min="0" step="0.01" defaultValue="0" /></label>
            <label>Project Manager<input name="projectManager" /></label>
            <div className="form-wide"><button type="submit">Save Project</button></div>
          </form>

          <section className="panel table-wrap">
            <table className="data-table">
              <thead><tr><th>ID</th><th>Project</th><th>Customer</th><th>Status</th><th>Net</th><th>GST</th><th>Total</th><th>Expected Cost</th></tr></thead>
              <tbody>
                {data.projects.map((row) => (
                  <tr key={row.projectId}><td>{row.projectId}</td><td>{row.projectName}</td><td>{row.customerId}</td><td>{row.status || "—"}</td><td>{row.contractNet || 0}</td><td>{row.gstAmount || 0}</td><td>{row.contractTotal || 0}</td><td>{row.expectedCost || 0}</td></tr>
                ))}
                {!loading && !data.projects.length && <tr><td colSpan={8}>No projects found.</td></tr>}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}
