"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { notifyFlowDataChanged } from "@/app/components/flow-navigation";

export type MasterType = "customer" | "supplier" | "project";

export type CreatedMasterRow = {
  customerId?: string;
  customerName?: string;
  supplierId?: string;
  supplierName?: string;
  projectId?: string;
  projectName?: string;
  [key: string]: unknown;
};

type Props = {
  isOpen: boolean;
  type: MasterType;
  defaultCustomerId?: string;
  customers?: Array<{ customerId: string; customerName: string }>;
  onClose: () => void;
  onSuccess: (type: MasterType, record: CreatedMasterRow) => void;
};

export default function QuickMasterModal({
  isOpen,
  type,
  defaultCustomerId = "",
  customers = [],
  onClose,
  onSuccess,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    setSaving(false);
    const timer = setTimeout(() => {
      nameInputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [isOpen, type]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const title = type === "customer"
    ? "Create New Customer"
    : type === "supplier"
      ? "Create New Supplier"
      : "Create New Project";

  const subtitle = type === "customer"
    ? "Enter customer details. Once saved, it is immediately selected in your transaction draft."
    : type === "supplier"
      ? "Enter supplier details. Once saved, it is immediately selected in your transaction draft."
      : "Enter project details. Once saved, it is immediately selected in your transaction draft.";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setError("");
    setSaving(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const record = Object.fromEntries(formData.entries());

    try {
      const response = await fetch("/api/erp/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: "masters",
          body: {
            type,
            mode: "create",
            record,
          },
        }),
      });

      const body = await response.json();
      if (!response.ok || !body.ok) {
        throw new Error(body.error || "Failed to save master record");
      }

      const row = (body.row || body.result?.row || {}) as CreatedMasterRow;
      const id = String(row.customerId || row.supplierId || row.projectId || "");
      notifyFlowDataChanged(type, id);

      onSuccess(type, row);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save master record");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="quick-modal-backdrop" onClick={onClose}>
      <div className="quick-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="quick-modal-header">
          <div>
            <h3 className="quick-modal-title">{title}</h3>
            <p className="quick-modal-subtitle">{subtitle}</p>
          </div>
          <button
            type="button"
            className="quick-modal-close"
            onClick={onClose}
            disabled={saving}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {error && <div className="quick-modal-error">{error}</div>}

        <form onSubmit={handleSubmit} className="quick-modal-form">
          {type === "customer" && (
            <div className="form-grid">
              <label className="form-wide">
                Customer Name *
                <input
                  ref={nameInputRef}
                  name="customerName"
                  required
                  placeholder="e.g. Acme Corporation"
                  disabled={saving}
                  autoComplete="off"
                />
              </label>
              <label>
                Contact Person
                <input
                  name="contactPerson"
                  placeholder="e.g. John Doe"
                  disabled={saving}
                  autoComplete="off"
                />
              </label>
              <label>
                Phone
                <input
                  name="phone"
                  placeholder="e.g. +675 7000 1234"
                  disabled={saving}
                  autoComplete="off"
                />
              </label>
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  placeholder="e.g. accounts@acme.com"
                  disabled={saving}
                  autoComplete="off"
                />
              </label>
              <label>
                Tax ID / TIN
                <input
                  name="taxId"
                  placeholder="e.g. TIN-998822"
                  disabled={saving}
                  autoComplete="off"
                />
              </label>
              <label>
                Credit Terms (days)
                <input
                  name="creditTermsDays"
                  type="number"
                  min="0"
                  defaultValue="30"
                  disabled={saving}
                />
              </label>
              <label>
                Credit Limit
                <input
                  name="creditLimit"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue="0"
                  disabled={saving}
                />
              </label>
              <label className="form-wide">
                Address
                <textarea
                  name="address"
                  rows={2}
                  placeholder="Physical or mailing address"
                  disabled={saving}
                />
              </label>
            </div>
          )}

          {type === "supplier" && (
            <div className="form-grid">
              <label className="form-wide">
                Supplier Name *
                <input
                  ref={nameInputRef}
                  name="supplierName"
                  required
                  placeholder="e.g. Pacific Logistics Ltd"
                  disabled={saving}
                  autoComplete="off"
                />
              </label>
              <label>
                Contact Person
                <input
                  name="contactPerson"
                  placeholder="e.g. Jane Smith"
                  disabled={saving}
                  autoComplete="off"
                />
              </label>
              <label>
                Phone
                <input
                  name="phone"
                  placeholder="e.g. +675 7111 5678"
                  disabled={saving}
                  autoComplete="off"
                />
              </label>
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  placeholder="e.g. billing@pacificlogistics.com"
                  disabled={saving}
                  autoComplete="off"
                />
              </label>
              <label>
                Tax ID / TIN
                <input
                  name="taxId"
                  placeholder="e.g. TIN-445566"
                  disabled={saving}
                  autoComplete="off"
                />
              </label>
              <label>
                Payment Terms (days)
                <input
                  name="paymentTermsDays"
                  type="number"
                  min="0"
                  defaultValue="30"
                  disabled={saving}
                />
              </label>
              <label className="form-wide">
                Address
                <textarea
                  name="address"
                  rows={2}
                  placeholder="Physical or office address"
                  disabled={saving}
                />
              </label>
            </div>
          )}

          {type === "project" && (
            <div className="form-grid">
              <label className="form-wide">
                Project Name *
                <input
                  ref={nameInputRef}
                  name="projectName"
                  required
                  placeholder="e.g. Highway Upgrade Phase 1"
                  disabled={saving}
                  autoComplete="off"
                />
              </label>
              <label>
                Customer
                <select
                  name="customerId"
                  defaultValue={defaultCustomerId || ""}
                  disabled={saving}
                >
                  <option value="">No Customer / Internal Project</option>
                  {customers.map((c) => (
                    <option key={c.customerId} value={c.customerId}>
                      {c.customerName} ({c.customerId})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select name="status" defaultValue="OPEN" disabled={saving}>
                  <option value="OPEN">OPEN</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="ON HOLD">ON HOLD</option>
                  <option value="COMPLETED">COMPLETED</option>
                </select>
              </label>
              <label>
                Start Date
                <input name="startDate" type="date" disabled={saving} />
              </label>
              <label>
                End Date
                <input name="endDate" type="date" disabled={saving} />
              </label>
              <label>
                Contract Net Amount
                <input
                  name="contractNet"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue="0"
                  disabled={saving}
                />
              </label>
              <label>
                GST Amount
                <input
                  name="gstAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue="0"
                  disabled={saving}
                />
              </label>
              <label>
                Project Manager
                <input
                  name="projectManager"
                  placeholder="e.g. Mark Roberts"
                  disabled={saving}
                  autoComplete="off"
                />
              </label>
            </div>
          )}

          <div className="quick-modal-actions">
            <button
              type="button"
              className="secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={saving ? { opacity: 0.6, cursor: "not-allowed", filter: "grayscale(1)" } : undefined}
            >
              {saving ? "Saving…" : "Save & Use in Form"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
