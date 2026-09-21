"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AdjustableDataTable, { type AdjustableColumn } from "@/app/components/adjustable-data-table";
import QuickMasterModal, { type CreatedMasterRow, type MasterType } from "@/app/components/quick-master-modal";

type MasterRow = Record<string, unknown>;

type Props = {
  type: MasterType;
  title: string;
  description: string;
  createLabel: string;
};

const TYPE_CONFIG: Record<MasterType, {
  scope: string;
  rowsKey: "customers" | "suppliers" | "projects";
  idKey: string;
  nameKey: string;
  detailBasePath: string;
  columns: Array<{ key: string; label: string; value: (row: MasterRow) => string; sortValue?: (row: MasterRow) => string | number; mandatory?: boolean; defaultWidth?: number }>;
}> = {
  customer: {
    scope: "customer",
    rowsKey: "customers",
    idKey: "customerId",
    nameKey: "customerName",
    detailBasePath: "/customers",
    columns: [
      { key: "customerName", label: "Customer Name", value: (row) => String(row.customerName || "—"), mandatory: true, defaultWidth: 230 },
      { key: "contactPerson", label: "Contact", value: (row) => String(row.contactPerson || "—") },
      { key: "phone", label: "Phone", value: (row) => String(row.phone || "—") },
      { key: "email", label: "Email", value: (row) => String(row.email || "—"), defaultWidth: 220 },
      { key: "creditLimit", label: "Credit Limit", value: (row) => money(row.creditLimit), sortValue: (row) => Number(row.creditLimit || 0) },
      { key: "status", label: "Status", value: (row) => activeLabel(row.active) },
    ],
  },
  supplier: {
    scope: "supplier",
    rowsKey: "suppliers",
    idKey: "supplierId",
    nameKey: "supplierName",
    detailBasePath: "/suppliers",
    columns: [
      { key: "supplierName", label: "Supplier Name", value: (row) => String(row.supplierName || "—"), mandatory: true, defaultWidth: 230 },
      { key: "contactPerson", label: "Contact", value: (row) => String(row.contactPerson || "—") },
      { key: "phone", label: "Phone", value: (row) => String(row.phone || "—") },
      { key: "email", label: "Email", value: (row) => String(row.email || "—"), defaultWidth: 220 },
      { key: "paymentTermsDays", label: "Payment Terms", value: (row) => `${Number(row.paymentTermsDays || 0)} days`, sortValue: (row) => Number(row.paymentTermsDays || 0) },
      { key: "status", label: "Status", value: (row) => activeLabel(row.active) },
    ],
  },
  project: {
    scope: "project",
    rowsKey: "projects",
    idKey: "projectId",
    nameKey: "projectName",
    detailBasePath: "/projects/master",
    columns: [
      { key: "projectName", label: "Project Name", value: (row) => String(row.projectName || "—"), mandatory: true, defaultWidth: 240 },
      { key: "customerId", label: "Customer", value: (row) => String(row.customerId || "Internal / no customer"), defaultWidth: 220 },
      { key: "status", label: "Status", value: (row) => String(row.status || "OPEN"), mandatory: true },
      { key: "startDate", label: "Start", value: (row) => formatDate(row.startDate), sortValue: (row) => String(row.startDate || "") },
      { key: "endDate", label: "End", value: (row) => formatDate(row.endDate), sortValue: (row) => String(row.endDate || "") },
      { key: "contractTotal", label: "Contract Total", value: (row) => money(row.contractTotal), sortValue: (row) => Number(row.contractTotal || 0) },
    ],
  },
};

function money(value: unknown) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-PG", {
    style: "currency",
    currency: "PGK",
    minimumFractionDigits: 2,
  }).format(amount);
}

function activeLabel(value: unknown) {
  if (value === false || String(value).toLowerCase() === "false") return "Inactive";
  return "Active";
}

function rowId(row: MasterRow, idKey: string, fallback: number) {
  return String(row[idKey] || row.id || row.code || fallback);
}

function formatDate(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "—";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString("en-PG", { year: "numeric", month: "short", day: "2-digit" });
}

export default function MasterDoctypeClient({ type, title, description, createLabel }: Props) {
  const router = useRouter();
  const config = TYPE_CONFIG[type];
  const [rows, setRows] = useState<MasterRow[]>([]);
  const [customers, setCustomers] = useState<Array<{ customerId: string; customerName: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/masters/scoped?scope=${encodeURIComponent(config.scope)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || `${title} load failed`);
      setRows(Array.isArray(body[config.rowsKey]) ? body[config.rowsKey] : []);
      if (Array.isArray(body.customers)) {
        setCustomers(body.customers.map((row: MasterRow) => ({
          customerId: String(row.customerId || ""),
          customerName: String(row.customerName || row.customerId || ""),
        })).filter((row: { customerId: string }) => row.customerId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `${title} load failed`);
    } finally {
      setLoading(false);
    }
  }, [config.rowsKey, config.scope, title]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const activeCount = useMemo(() => rows.filter((row) => activeLabel(row.active) === "Active").length, [rows]);

  const tableColumns = useMemo<AdjustableColumn<MasterRow>[]>(() => [
    {
      key: "id",
      label: "ID",
      mandatory: true,
      defaultWidth: 190,
      sortValue: (row) => rowId(row, config.idKey, 0),
      value: (row, index) => (
        <>
          <strong>{rowId(row, config.idKey, index)}</strong>
          <br />
          <span className="small">Record ID</span>
        </>
      ),
    },
    {
      key: "createdAt",
      label: "Created Date",
      mandatory: true,
      defaultWidth: 170,
      sortValue: (row) => String(row.createdAt || ""),
      value: (row) => formatDate(row.createdAt),
    },
    ...config.columns.map((column) => ({
      key: column.key,
      label: column.label,
      mandatory: column.mandatory,
      defaultWidth: column.defaultWidth,
      sortValue: column.sortValue,
      value: (row: MasterRow) => column.value(row),
    })),
  ], [config]);

  function handleCreated(_createdType: MasterType, _record: CreatedMasterRow) {
    void loadRows();
  }

  function openRecord(row: MasterRow, index: number) {
    const id = rowId(row, config.idKey, index);
    if (!id) return;
    router.push(`${config.detailBasePath}/${encodeURIComponent(id)}`);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>{title}</h2>
          <p className="small">{description}</p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="secondary" onClick={() => void loadRows()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" onClick={() => setModalOpen(true)}>
            {createLabel}
          </button>
        </div>
      </div>

      {error && <div className="status-banner error">{error}</div>}

      <div className="grid">
        <div className="card">
          <div className="label">Total records</div>
          <div className="value">{rows.length}</div>
        </div>
        <div className="card">
          <div className="label">Active records</div>
          <div className="value">{activeCount}</div>
        </div>
      </div>

      <section className="panel table-wrap">
        <div className="form-title-row">
          <div>
            <h3>Existing {title}</h3>
            <p className="small">Direct doctype view for sales and purchase workflow reference.</p>
          </div>
          <span className="auto-badge">{loading ? "Loading" : `${rows.length} records`}</span>
        </div>
        <AdjustableDataTable
          rows={rows}
          columns={tableColumns}
          loading={loading}
          emptyMessage={`No ${title.toLowerCase()} found.`}
          loadingMessage={`Loading ${title.toLowerCase()}…`}
          rowKey={(row, index) => rowId(row, config.idKey, index)}
          onRowClick={openRecord}
          rowAriaLabel={(row, index) => `Open ${String(row[config.nameKey] || rowId(row, config.idKey, index))}`}
        />
      </section>

      <QuickMasterModal
        isOpen={modalOpen}
        type={type}
        customers={customers}
        onClose={() => setModalOpen(false)}
        onSuccess={handleCreated}
      />
    </>
  );
}
