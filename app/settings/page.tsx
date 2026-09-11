"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Setting = { key: string; value: string; notes: string; updatedAt?: string };

type RetainedDocument = {
  id: string;
  code: string;
  name: string;
  type: string;
  documentType: string | null;
  fileUrl: string | null;
  createdAt: string;
};

type TransactionSummary = {
  journalHeaders: number;
  journalLines: number;
  invoices: number;
  invoiceLines: number;
  quotes: number;
  quoteLines: number;
  creditNotes: number;
  creditNoteLines: number;
  purchaseOrders: number;
  poLines: number;
  goodsReceipts: number;
  supplierBills: number;
  billLines: number;
  payments: number;
  refunds: number;
  expenses: number;
  bankTransactions: number;
  reconciliations: number;
  stockMovements: number;
  payrollRuns: number;
  payrollItems: number;
  posSessions: number;
  landedCostVouchers: number;
  landedCostItems: number;
  loans: number;
  loanEvents: number;
  fixedAssets: number;
  taxReports: number;
  timeEntries: number;
  approvalRequests: number;
  transactionalDocuments: number;
  totalTransactions: number;
};

type MasterDataSummary = {
  chartOfAccounts: number;
  customers: number;
  suppliers: number;
  contacts: number;
  items: number;
  bankAccounts: number;
  taxCodes: number;
  currencies: number;
  employees: number;
  projects: number;
  globalSettings: number;
  users: number;
  totalMasterRecords: number;
};

// Base Currencies
const BASE_CURRENCIES = [
  { code: "PGK", label: "PGK — Papua New Guinea Kina (K)", symbol: "K", default: true },
  { code: "USD", label: "USD — United States Dollar ($)", symbol: "$" },
  { code: "AUD", label: "AUD — Australian Dollar (A$)", symbol: "A$" },
  { code: "EUR", label: "EUR — Euro (€)", symbol: "€" },
  { code: "GBP", label: "GBP — British Pound (£)", symbol: "£" },
  { code: "NZD", label: "NZD — New Zealand Dollar (NZ$)", symbol: "NZ$" },
  { code: "SGD", label: "SGD — Singapore Dollar (S$)", symbol: "S$" },
  { code: "JPY", label: "JPY — Japanese Yen (¥)", symbol: "¥" },
];

// Papua New Guinea Financial Year Periods (IRC Calendar Year Standard: Jan 1 - Dec 31)
const FINANCIAL_YEAR_PERIODS = [
  { value: "FY 2026 (01 Jan 2026 - 31 Dec 2026)", label: "FY 2026 (01 Jan 2026 - 31 Dec 2026) — Current PNG Financial Year", isCurrent: true },
  { value: "FY 2025 (01 Jan 2025 - 31 Dec 2025)", label: "FY 2025 (01 Jan 2025 - 31 Dec 2025) — Prior Financial Year" },
  { value: "FY 2027 (01 Jan 2027 - 31 Dec 2027)", label: "FY 2027 (01 Jan 2027 - 31 Dec 2027) — Next Financial Year" },
  { value: "FY 2024 (01 Jan 2024 - 31 Dec 2024)", label: "FY 2024 (01 Jan 2024 - 31 Dec 2024) — Historical" },
];

// GST Statuses
const GST_STATUSES = [
  { value: "UNVERIFIED", label: "UNVERIFIED — Registration not yet verified against IRC registry" },
  { value: "REGISTERED", label: "REGISTERED — Registered for GST (Standard registered taxpayer)" },
  { value: "VERIFIED", label: "VERIFIED — Formally Verified (Requires GST No + Retained GST_REGISTRATION doc)" },
  { value: "NOT_REGISTERED", label: "NOT_REGISTERED — Turnover below K100,000 threshold or non-GST business" },
  { value: "EXEMPT", label: "EXEMPT — Statutory exemption under PNG tax legislation" },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [existingDocs, setExistingDocs] = useState<RetainedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatusText, setSaveStatusText] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState("");
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);

  // Form Fields
  const [companyName, setCompanyName] = useState("");
  const [companyShortName, setCompanyShortName] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("PGK");
  const [financialYearPeriod, setFinancialYearPeriod] = useState("FY 2026 (01 Jan 2026 - 31 Dec 2026)");
  const [gstStatus, setGstStatus] = useState("UNVERIFIED");
  const [gstNumber, setGstNumber] = useState("");
  const [evidenceNotes, setEvidenceNotes] = useState("");
  const [retainedDocName, setRetainedDocName] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  // Banking Details
  const [bankName, setBankName] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [bankBsb, setBankBsb] = useState("");

  // Danger Zone - ERPNext Transaction Deletion State
  const [dangerSummary, setDangerSummary] = useState<TransactionSummary | null>(null);
  const [loadingDangerSummary, setLoadingDangerSummary] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [resetStockLevels, setResetStockLevels] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);
  const [deletedCounts, setDeletedCounts] = useState<TransactionSummary | null>(null);

  // Danger Zone - Master Data Deletion (Factory Reset) State
  const [masterSummary, setMasterSummary] = useState<MasterDataSummary | null>(null);
  const [loadingMasterSummary, setLoadingMasterSummary] = useState(false);
  const [isMasterDeleteModalOpen, setIsMasterDeleteModalOpen] = useState(false);
  const [masterAdminPassword, setMasterAdminPassword] = useState("");
  const [showMasterAdminPassword, setShowMasterAdminPassword] = useState(false);
  const [masterConfirmationPhrase, setMasterConfirmationPhrase] = useState("");
  const [preserveAdminAccount, setPreserveAdminAccount] = useState(true);
  const [isMasterDeleting, setIsMasterDeleting] = useState(false);
  const [masterDeleteError, setMasterDeleteError] = useState("");
  const [masterDeleteSuccess, setMasterDeleteSuccess] = useState<string | null>(null);
  const [deletedMasterCounts, setDeletedMasterCounts] = useState<MasterDataSummary | null>(null);

  // Track initial values to detect unsaved changes
  const [initialSnapshot, setInitialSnapshot] = useState<string>("");

  const loadTransactionSummary = async () => {
    setLoadingDangerSummary(true);
    try {
      const res = await fetch("/api/company/transactions", { cache: "no-store" });
      const data = await res.json();
      if (res.ok && data.ok) {
        setDangerSummary(data.summary);
      }
    } catch {
      // Ignored for non-admin sessions
    } finally {
      setLoadingDangerSummary(false);
    }
  };

  const loadMasterSummary = async () => {
    setLoadingMasterSummary(true);
    try {
      const res = await fetch("/api/company/master-data", { cache: "no-store" });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMasterSummary(data.summary);
      }
    } catch {
      // Ignored
    } finally {
      setLoadingMasterSummary(false);
    }
  };

  const handleDeleteAllTransactions = async () => {
    if (!adminPassword.trim()) {
      setDeleteError("Administrator password is required for re-authentication.");
      return;
    }
    const expectedName = (companyName || "Easynet IT Solutions Limited").trim();
    const entered = confirmationText.trim();
    if (
      entered.toLowerCase() !== expectedName.toLowerCase() &&
      entered.toUpperCase() !== "DELETE ALL TRANSACTIONS"
    ) {
      setDeleteError(`Confirmation prompt requires typing "${expectedName}" or "DELETE ALL TRANSACTIONS" exactly.`);
      return;
    }

    setIsDeleting(true);
    setDeleteError("");
    setDeleteSuccess(null);

    try {
      const res = await fetch("/api/company/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: adminPassword,
          companyNameConfirmation: confirmationText,
          resetStockQuantities: resetStockLevels,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to delete company transactions");
      }

      setDeleteSuccess(data.message || "All company transactions have been deleted successfully.");
      setDeletedCounts(data.wiped);
      setAdminPassword("");
      setConfirmationText("");
      await loadTransactionSummary();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Deletion failed");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteAllMasterData = async () => {
    if (!masterAdminPassword.trim()) {
      setMasterDeleteError("Administrator password is required for re-authentication.");
      return;
    }
    if (masterConfirmationPhrase.trim().toUpperCase() !== "WIPE ALL MASTER DATA") {
      setMasterDeleteError('Confirmation prompt requires typing "WIPE ALL MASTER DATA" exactly.');
      return;
    }

    setIsMasterDeleting(true);
    setMasterDeleteError("");
    setMasterDeleteSuccess(null);

    try {
      const res = await fetch("/api/company/master-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: masterAdminPassword,
          confirmationPhrase: masterConfirmationPhrase,
          preserveAdminUser: preserveAdminAccount,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to wipe company master data");
      }

      setMasterDeleteSuccess(data.message || "All company master data and records have been deleted.");
      setDeletedMasterCounts(data.wiped);
      setMasterAdminPassword("");
      setMasterConfirmationPhrase("");
      await loadMasterSummary();
      await loadTransactionSummary();
      await loadSettings();
    } catch (err) {
      setMasterDeleteError(err instanceof Error ? err.message : "Master data deletion failed");
    } finally {
      setIsMasterDeleting(false);
    }
  };

  const loadSettings = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to load finance settings");

      const rows: Setting[] = data.settings || [];
      setSettings(rows);
      setExistingDocs(data.documents || []);

      const val = (k: string) => rows.find((r) => r.key === k)?.value || "";
      const desc = (k: string) => rows.find((r) => r.key === k)?.notes || "";

      const cName = val("company_name") || "Easynet IT Solutions Limited";
      const cShort = val("company_short_name") || "Easynet PNG";
      const bCurr = val("base_currency") || val("currency") || "PGK";
      const fyPeriod = val("financial_year_period") || "FY 2026 (01 Jan 2026 - 31 Dec 2026)";
      const gStatus = (val("gst_status") || "UNVERIFIED").toUpperCase();
      const gNumber = val("gst_number") || val("company_tin") || "";
      const bName = val("company_bank_name") || "Bank South Pacific (BSP)";
      const bAcc = val("company_bank_account") || "";
      const bBsb = val("company_bank_bsb") || "";
      const notes = desc("gst_status") || "";

      setCompanyName(cName);
      setCompanyShortName(cShort);
      setBaseCurrency(bCurr);
      setFinancialYearPeriod(fyPeriod);
      setGstStatus(gStatus);
      setGstNumber(gNumber);
      setBankName(bName);
      setBankAccount(bAcc);
      setBankBsb(bBsb);
      setEvidenceNotes(notes);

      if (data.documents && data.documents.length > 0) {
        setRetainedDocName(data.documents[0].name);
      }

      const snapshot = JSON.stringify({ cName, cShort, bCurr, fyPeriod, gStatus, gNumber, bName, bAcc, bBsb, notes });
      setInitialSnapshot(snapshot);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Settings load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
    void loadTransactionSummary();
    void loadMasterSummary();
  }, []);

  // Unsaved changes detection
  const currentSnapshot = JSON.stringify({
    cName: companyName,
    cShort: companyShortName,
    bCurr: baseCurrency,
    fyPeriod: financialYearPeriod,
    gStatus: gstStatus,
    gNumber: gstNumber,
    bName: bankName,
    bAcc: bankAccount,
    bBsb: bankBsb,
    notes: evidenceNotes,
  });
  const isDirty = initialSnapshot !== "" && currentSnapshot !== initialSnapshot;

  // Validation Rules
  const isGstVerified = gstStatus === "VERIFIED";
  const hasGstNumber = Boolean(gstNumber.trim());
  const hasGstEvidence = Boolean(
    retainedDocName.trim() ||
    uploadedFile ||
    existingDocs.length > 0 ||
    evidenceNotes.trim().length >= 5
  );

  // Strict VERIFIED check: blocked if missing either GST number or retained source evidence document
  const isVerifiedBlocked = isGstVerified && (!hasGstNumber || !hasGstEvidence);

  // Overall Mandatory setup completion check
  const isMandatoryComplete = Boolean(
    companyName.trim() &&
    baseCurrency.trim() &&
    financialYearPeriod.trim() &&
    gstStatus.trim() &&
    !isVerifiedBlocked
  );

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
      setRetainedDocName(file.name);
      if (!evidenceNotes) {
        setEvidenceNotes(`Retained official IRC GST Certificate: ${file.name} (Type: GST_REGISTRATION)`);
      }
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;

    // Hard block if VERIFIED without required criteria
    if (isGstVerified) {
      if (!hasGstNumber) {
        setErrorMessage("VERIFIED requires a recorded GST number. Please enter your official IRC TIN.");
        return;
      }
      if (!hasGstEvidence) {
        setErrorMessage(
          "VERIFIED requires a recorded GST number plus a retained source document with type GST_REGISTRATION. Save will be blocked if the evidence is missing."
        );
        return;
      }
    }

    setSaving(true);
    setSaveStatusText("Saving settings to database…");
    setErrorMessage("");

    try {
      const payloadSettings = [
        { key: "company_name", value: companyName.trim(), notes: "Company legal name" },
        { key: "company_short_name", value: companyShortName.trim(), notes: "Trading / brand name" },
        { key: "base_currency", value: baseCurrency.trim(), notes: "Primary base currency" },
        { key: "financial_year_period", value: financialYearPeriod.trim(), notes: "PNG statutory fiscal year" },
        { key: "gst_status", value: gstStatus.trim(), notes: evidenceNotes.trim() || "GST control status" },
        { key: "gst_number", value: gstNumber.trim(), notes: "IRC Tax Identification Number" },
        { key: "company_bank_name", value: bankName.trim(), notes: "Operating corporate bank" },
        { key: "company_bank_account", value: bankAccount.trim(), notes: "Bank account number" },
        { key: "company_bank_bsb", value: bankBsb.trim(), notes: "Branch BSB code" },
      ];

      const res = await fetch("/api/erp/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: "settings",
          body: {
            settings: payloadSettings,
            retainedDoc: retainedDocName
              ? { name: retainedDocName, documentType: "GST_REGISTRATION" }
              : undefined,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to save settings");
      }

      const nowStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setLastSavedTime(nowStr);
      setSaveStatusText(`All settings saved successfully at ${nowStr}`);
      setUploadedFile(null);
      await loadSettings();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to save configuration");
      setSaveStatusText("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleQuickFillDefaults = () => {
    setCompanyName("Easynet IT Solutions Limited");
    setCompanyShortName("Easynet PNG");
    setBaseCurrency("PGK");
    setFinancialYearPeriod("FY 2026 (01 Jan 2026 - 31 Dec 2026)");
    setGstNumber("TIN-50012389");
    setGstStatus("REGISTERED");
    setBankName("Bank South Pacific (BSP)");
    setBankAccount("1001234567");
    setBankBsb("088-301");
    setErrorMessage("");
  };

  return (
    <>
      {/* Page Header */}
      <div className="page-head">
        <div>
          <h2>Finance & ERP Configuration</h2>
          <p className="small">
            Controlled system variables, taxation compliance parameters, and company banking details.
          </p>
        </div>
        <div className="page-head-actions">
          {isMandatoryComplete ? (
            <span className="badge" style={{ background: "#dcfce7", color: "#166534", border: "1px solid #86efac" }}>
              ✅ System Initialized
            </span>
          ) : (
            <span className="badge" style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}>
              ⚠️ Mandatory Setup Required
            </span>
          )}
          <Link prefetch={false} className="button-link secondary-link" href="/setup/finance">
            Verify Initialization
          </Link>
          <span className="badge">System Settings</span>
        </div>
      </div>

      {/* Mandatory Requirement Alert Banner */}
      {!loading && !isMandatoryComplete && (
        <div className="settings-blocked-banner" style={{ marginBottom: "16px" }}>
          <span>⚠️</span>
          <div>
            <strong>Mandatory Setup Incomplete:</strong> You must configure and confirm your Base Currency, Papua New Guinea Financial Year Period, and GST Compliance before using the system for financial transactions.
          </div>
        </div>
      )}

      {/* Top Metric Cards */}
      <div className="grid">
        <div className="card">
          <div className="label">Company Name</div>
          <div className="value small-value">{loading ? "Loading…" : companyName || "—"}</div>
        </div>
        <div className="card">
          <div className="label">Base Currency</div>
          <div className="value" style={{ color: "#0052cc" }}>
            {loading ? "—" : baseCurrency}
          </div>
        </div>
        <div className="card">
          <div className="label">Financial Year Period</div>
          <div className="value small-value" style={{ fontSize: "13px", fontWeight: 700 }}>
            {loading ? "—" : financialYearPeriod.split("—")[0]}
          </div>
        </div>
        <div className="card">
          <div className="label">GST Control Status</div>
          <div className="value small-value">
            {loading ? (
              "—"
            ) : (
              <span
                className={`coa-badge-type ${
                  gstStatus === "VERIFIED"
                    ? "coa-type-asset"
                    : gstStatus === "REGISTERED"
                    ? "coa-type-revenue"
                    : "coa-type-liability"
                }`}
                style={{ fontSize: "11.5px" }}
              >
                {gstStatus}
              </span>
            )}
          </div>
        </div>
        <div className="card">
          <div className="label">GST / IRC TIN</div>
          <div className="value small-value" style={{ fontFamily: "var(--font-mono, monospace)" }}>
            {loading ? "—" : gstNumber || "—"}
          </div>
        </div>
      </div>

      {/* Main Configuration Form */}
      <form className="settings-form-container" onSubmit={handleSave}>
        {/* SECTION 1: General & Currency (Mandatory) */}
        <div className="settings-section-card">
          <div className="settings-section-header">
            <div className="settings-section-title-wrap">
              <span style={{ fontSize: "18px" }}>🏢</span>
              <h3 className="settings-section-title">General Company & Base Currency</h3>
            </div>
            <span className="settings-badge-mandatory">Mandatory Before Use</span>
          </div>

          <div className="settings-grid-2col">
            <label className="settings-field-label">
              Company Legal Registered Name *
              <input
                type="text"
                className="settings-input"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Easynet IT Solutions Limited"
                required
                disabled={loading || saving}
              />
              <span className="settings-field-hint">Legal entity name registered with IPA Papua New Guinea.</span>
            </label>

            <label className="settings-field-label">
              Trading / Short Name
              <input
                type="text"
                className="settings-input"
                value={companyShortName}
                onChange={(e) => setCompanyShortName(e.target.value)}
                placeholder="e.g. Easynet PNG"
                disabled={loading || saving}
              />
              <span className="settings-field-hint">Displayed on user headers and informal communications.</span>
            </label>

            <label className="settings-field-label" style={{ gridColumn: "1 / -1" }}>
              Base Operating Currency *
              <select
                className="settings-select"
                value={baseCurrency}
                onChange={(e) => setBaseCurrency(e.target.value)}
                required
                disabled={loading || saving}
                style={{ fontWeight: 600 }}
              >
                {BASE_CURRENCIES.map((curr) => (
                  <option key={curr.code} value={curr.code}>
                    {curr.label}
                  </option>
                ))}
              </select>
              <span className="settings-field-hint">
                All accounting ledger entries, journal vouchers, tax returns, and roll-ups are posted in this statutory currency.
              </span>
            </label>
          </div>
        </div>

        {/* SECTION 2: Financial Year Period (Mandatory - Papua New Guinea) */}
        <div className="settings-section-card">
          <div className="settings-section-header">
            <div className="settings-section-title-wrap">
              <span style={{ fontSize: "18px" }}>📅</span>
              <h3 className="settings-section-title">Papua New Guinea Financial Year Period</h3>
            </div>
            <span className="settings-badge-mandatory">Mandatory Before Use</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <label className="settings-field-label">
              Active Financial Year Period (Papua New Guinea) *
              <select
                className="settings-select"
                value={financialYearPeriod}
                onChange={(e) => setFinancialYearPeriod(e.target.value)}
                required
                disabled={loading || saving}
                style={{ fontWeight: 600 }}
              >
                {FINANCIAL_YEAR_PERIODS.map((fy) => (
                  <option key={fy.value} value={fy.value}>
                    {fy.label}
                  </option>
                ))}
              </select>
              <span className="settings-field-hint">
                Select the current operating financial year. In Papua New Guinea, IRC statutory tax periods run on the calendar year basis (01 January - 31 December).
              </span>
            </label>

            <div className="settings-info-banner">
              <span>🇵🇬</span>
              <div>
                <strong>Papua New Guinea IRC Standard:</strong> The default statutory accounting year starts on <strong>January 1</strong> and closes on <strong>December 31</strong>.
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 3: PNG GST & IRC Compliance (Mandatory) */}
        <div className="settings-section-card">
          <div className="settings-section-header">
            <div className="settings-section-title-wrap">
              <span style={{ fontSize: "18px" }}>⚖️</span>
              <h3 className="settings-section-title">Papua New Guinea GST & IRC Compliance</h3>
            </div>
            <span className="settings-badge-mandatory">Mandatory Before Use</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div className="settings-grid-2col">
              <label className="settings-field-label">
                GST Control Status *
                <select
                  className="settings-select"
                  value={gstStatus}
                  onChange={(e) => setGstStatus(e.target.value)}
                  required
                  disabled={loading || saving}
                  style={{
                    fontWeight: 700,
                    color: gstStatus === "VERIFIED" ? "#166534" : gstStatus === "REGISTERED" ? "#0052cc" : "#0f172a",
                  }}
                >
                  {GST_STATUSES.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
                <span className="settings-field-hint">
                  Defines whether 10% GST output/input tax posting is authorized on taxable sales and vendor bills.
                </span>
              </label>

              <label className="settings-field-label">
                GST / IRC Tax Identification Number (TIN) {isGstVerified ? "*" : ""}
                <input
                  type="text"
                  className="settings-input"
                  value={gstNumber}
                  onChange={(e) => setGstNumber(e.target.value)}
                  placeholder="e.g. TIN-50012389"
                  disabled={loading || saving}
                  style={{ fontFamily: "var(--font-mono, monospace)" }}
                />
                <span className="settings-field-hint">
                  Official 9-digit or TIN formatted registration number issued by PNG Internal Revenue Commission.
                </span>
              </label>
            </div>

            {/* Strict VERIFIED Status Verification Rules & Document Check */}
            {isGstVerified ? (
              isVerifiedBlocked ? (
                <div className="settings-blocked-banner">
                  <span>🚫</span>
                  <div>
                    <strong>Save Blocked:</strong> VERIFIED requires a recorded GST number plus a retained source document with type GST_REGISTRATION. Save will be blocked if the evidence is missing.
                    <div style={{ fontSize: "12px", marginTop: "4px", opacity: 0.9 }}>
                      Missing: {!hasGstNumber ? "• GST Number / TIN is required. " : ""}
                      {!hasGstEvidence ? "• Retained Certificate document or reference evidence is required." : ""}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="settings-success-banner">
                  <span>✅</span>
                  <div>
                    <strong>VERIFIED Criteria Satisfied:</strong> GST Number is recorded and retained source document evidence is confirmed. Save is authorized.
                  </div>
                </div>
              )
            ) : (
              <div className="settings-info-banner">
                <span>ℹ️</span>
                <div>
                  For status <strong>{gstStatus}</strong>, retaining a source document evidence is not required to save.
                </div>
              </div>
            )}

            {/* Retained Source Document Upload / Inspection */}
            <div className="settings-doc-box">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "#334155" }}>
                  Retained Source Document (Type: GST_REGISTRATION)
                </span>
                {retainedDocName || existingDocs.length > 0 ? (
                  <span className="coa-status-pill valid">Document Retained</span>
                ) : (
                  <span className="coa-status-pill invalid">No Document Attached</span>
                )}
              </div>

              {/* Show currently retained document if any */}
              {retainedDocName ? (
                <div className="settings-doc-active-chip">
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span>📄</span>
                    <span>
                      <strong>{retainedDocName}</strong> (Type: GST_REGISTRATION)
                    </span>
                  </div>
                  <button
                    type="button"
                    className="coa-action-pill"
                    onClick={() => {
                      setRetainedDocName("");
                      setUploadedFile(null);
                    }}
                    style={{ background: "#fee2e2", color: "#991b1b" }}
                  >
                    Remove
                  </button>
                </div>
              ) : existingDocs.length > 0 ? (
                <div className="settings-doc-active-chip">
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span>📄</span>
                    <span>
                      <strong>{existingDocs[0].name}</strong> (Type: GST_REGISTRATION — ID: {existingDocs[0].code})
                    </span>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: "12px", color: "#64748b" }}>
                  Attach your official Certificate of Registration issued by the Internal Revenue Commission (PDF, PNG, JPG).
                </div>
              )}

              {/* Upload Input */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px" }}>
                <input
                  type="file"
                  id="gst-cert-input"
                  accept=".pdf,image/png,image/jpeg"
                  style={{ display: "none" }}
                  onChange={handleFileUpload}
                  disabled={loading || saving}
                />
                <button
                  type="button"
                  className="coa-btn"
                  onClick={() => document.getElementById("gst-cert-input")?.click()}
                  disabled={loading || saving}
                >
                  <span>📎</span> {retainedDocName ? "Replace Certificate File" : "Upload GST Registration Certificate"}
                </button>
                {uploadedFile && (
                  <span style={{ fontSize: "12px", color: "#166534" }}>
                    Selected: {uploadedFile.name} ({(uploadedFile.size / 1024).toFixed(1)} KB)
                  </span>
                )}
              </div>
            </div>

            {/* Evidence & Compliance Notes */}
            <label className="settings-field-label">
              Evidence / Audit Reference Note
              <textarea
                className="settings-textarea"
                rows={2}
                value={evidenceNotes}
                onChange={(e) => setEvidenceNotes(e.target.value)}
                placeholder={
                  isGstVerified
                    ? "Required: IRC Certificate reference number, issuance date, or compliance audit notes."
                    : "Reason, certificate reference, or statutory note (optional for non-VERIFIED)."
                }
                disabled={loading || saving}
              />
              <span className="settings-field-hint">
                Permanently logged in the compliance audit trail for Internal Revenue Commission reviews.
              </span>
            </label>
          </div>
        </div>

        {/* SECTION 4: Company Banking Details (Optional) */}
        <div className="settings-section-card">
          <div className="settings-section-header">
            <div className="settings-section-title-wrap">
              <span style={{ fontSize: "18px" }}>🏦</span>
              <h3 className="settings-section-title">Company Banking Details (PNG Operations)</h3>
            </div>
            <span className="settings-badge-optional">Optional / Banking Reference</span>
          </div>

          <div className="settings-grid-2col">
            <label className="settings-field-label">
              Bank Name
              <input
                type="text"
                className="settings-input"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="e.g. Bank South Pacific (BSP) / Kina Bank"
                disabled={loading || saving}
              />
            </label>

            <label className="settings-field-label">
              Bank Account Number
              <input
                type="text"
                className="settings-input"
                value={bankAccount}
                onChange={(e) => setBankAccount(e.target.value)}
                placeholder="e.g. 1001234567"
                disabled={loading || saving}
                style={{ fontFamily: "var(--font-mono, monospace)" }}
              />
            </label>

            <label className="settings-field-label">
              Branch BSB Code
              <input
                type="text"
                className="settings-input"
                value={bankBsb}
                onChange={(e) => setBankBsb(e.target.value)}
                placeholder="e.g. 088-301"
                disabled={loading || saving}
                style={{ fontFamily: "var(--font-mono, monospace)" }}
              />
            </label>
          </div>
        </div>

        {/* Error Feedback */}
        {errorMessage && (
          <div className="settings-blocked-banner">
            <span>⚠️</span>
            <div>{errorMessage}</div>
          </div>
        )}

        {/* SECTION 5: Save Actions & Live Save Status */}
        <div className="settings-save-bar">
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span
              className={`settings-save-status ${
                saving ? "saving" : isVerifiedBlocked ? "blocked" : isDirty ? "unsaved" : "saved"
              }`}
            >
              {saving
                ? "⏳ Saving changes…"
                : isVerifiedBlocked
                ? "🚫 Save Blocked (Evidence Missing)"
                : isDirty
                ? "🟡 Unsaved Changes"
                : lastSavedTime
                ? `✅ Saved at ${lastSavedTime}`
                : "✅ All Settings Up to Date"}
            </span>
            {saveStatusText && <span style={{ fontSize: "12px", color: "#64748b" }}>({saveStatusText})</span>}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              type="button"
              className="coa-btn"
              onClick={handleQuickFillDefaults}
              disabled={loading || saving}
              title="Populate with Easynet PNG standard corporate profile"
            >
              Fill Easynet PNG Defaults
            </button>

            <button
              type="submit"
              className="coa-btn coa-btn-primary"
              disabled={loading || saving || isVerifiedBlocked}
              style={{ minWidth: "160px" }}
              title={
                isVerifiedBlocked
                  ? "Save blocked: VERIFIED requires GST number and retained source document."
                  : "Save all finance & ERP configurations"
              }
            >
              {saving ? "Saving…" : isVerifiedBlocked ? "Save Blocked" : "💾 Save Configuration"}
            </button>
          </div>
        </div>
      </form>

      {/* SECTION 6: Danger Zone - Delete Company Transactions (ERPNext Architecture) */}
      <div className="settings-danger-card">
        <div className="settings-danger-header">
          <div className="settings-danger-title-wrap">
            <span style={{ fontSize: "22px" }}>🚨</span>
            <div>
              <h3 className="settings-danger-title">Danger Zone: Delete Company Transactions</h3>
              <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#991b1b" }}>
                ERPNext Architecture Wipe: Permanently erase all company transactions while strictly preserving your master data.
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span className="settings-badge-danger">Administrator Only</span>
            <button
              type="button"
              className="coa-btn"
              onClick={loadTransactionSummary}
              disabled={loadingDangerSummary}
              style={{ fontSize: "12px", padding: "4px 10px" }}
            >
              {loadingDangerSummary ? "Refreshing…" : "🔄 Refresh Counts"}
            </button>
          </div>
        </div>

        <div className="danger-callout-box">
          <strong>⚠️ Irreversible Transaction Reset:</strong>
          <span>
            This administrative operation wipes <strong>all General Ledger vouchers, invoices, payments, purchase orders, bills, stock movements, and payroll records</strong>.
            Your <strong>Chart of Accounts, Customer Directory, Supplier Master, Item Catalog, Bank Account definitions, Tax Codes, and User Accounts</strong> remain fully intact.
          </span>
        </div>

        {/* Transaction Counts Grid */}
        <div className="danger-metric-grid">
          <div className={`danger-metric-box ${dangerSummary && dangerSummary.journalHeaders > 0 ? "has-data" : ""}`}>
            <span className="danger-metric-count">
              {loadingDangerSummary ? "…" : dangerSummary ? dangerSummary.journalHeaders : 0}
            </span>
            <span className="danger-metric-label">GL Journal Vouchers</span>
          </div>
          <div className={`danger-metric-box ${dangerSummary && dangerSummary.invoices > 0 ? "has-data" : ""}`}>
            <span className="danger-metric-count">
              {loadingDangerSummary ? "…" : dangerSummary ? dangerSummary.invoices : 0}
            </span>
            <span className="danger-metric-label">Sales Invoices</span>
          </div>
          <div className={`danger-metric-box ${dangerSummary && dangerSummary.supplierBills > 0 ? "has-data" : ""}`}>
            <span className="danger-metric-count">
              {loadingDangerSummary ? "…" : dangerSummary ? dangerSummary.supplierBills : 0}
            </span>
            <span className="danger-metric-label">Vendor Bills</span>
          </div>
          <div className={`danger-metric-box ${dangerSummary && dangerSummary.payments > 0 ? "has-data" : ""}`}>
            <span className="danger-metric-count">
              {loadingDangerSummary ? "…" : dangerSummary ? dangerSummary.payments : 0}
            </span>
            <span className="danger-metric-label">Payments & Receipts</span>
          </div>
          <div className={`danger-metric-box ${dangerSummary && dangerSummary.stockMovements > 0 ? "has-data" : ""}`}>
            <span className="danger-metric-count">
              {loadingDangerSummary ? "…" : dangerSummary ? dangerSummary.stockMovements : 0}
            </span>
            <span className="danger-metric-label">Stock Movements</span>
          </div>
          <div className={`danger-metric-box ${dangerSummary && dangerSummary.payrollRuns > 0 ? "has-data" : ""}`}>
            <span className="danger-metric-count">
              {loadingDangerSummary ? "…" : dangerSummary ? dangerSummary.payrollRuns : 0}
            </span>
            <span className="danger-metric-label">Payroll Runs</span>
          </div>
          <div className={`danger-metric-box ${dangerSummary && dangerSummary.totalTransactions > 0 ? "has-data" : ""}`}>
            <span className="danger-metric-count" style={{ color: "#b91c1c" }}>
              {loadingDangerSummary ? "…" : dangerSummary ? dangerSummary.totalTransactions : 0}
            </span>
            <span className="danger-metric-label" style={{ fontWeight: 800 }}>Total Transactions</span>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px", flexWrap: "wrap", gap: "12px" }}>
          <div style={{ fontSize: "12.5px", color: "#64748b" }}>
            🛡️ Requires administrator password re-authentication and exact company name confirmation.
          </div>
          <button
            type="button"
            className="danger-delete-btn"
            id="btn-delete-company-transactions"
            onClick={() => {
              setIsDeleteModalOpen(true);
              setDeleteError("");
              setDeleteSuccess(null);
            }}
          >
            <span>🗑️</span> Delete All Company Transactions
          </button>
        </div>
      </div>

      {/* SECTION 7: Danger Zone - Delete Company Master Data (Full Reset) */}
      <div className="settings-danger-card master-wipe">
        <div className="settings-danger-header">
          <div className="settings-danger-title-wrap">
            <span style={{ fontSize: "22px" }}>⚠️</span>
            <div>
              <h3 className="settings-danger-title">Danger Zone: Delete All Master Data & Company Records (Full Reset)</h3>
              <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#881337" }}>
                Complete Factory Reset: Permanently wipe Chart of Accounts, Customers, Suppliers, Products, Bank accounts, Tax codes, and Company Settings.
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span className="settings-badge-danger factory-reset">Factory Reset</span>
            <button
              type="button"
              className="coa-btn"
              onClick={loadMasterSummary}
              disabled={loadingMasterSummary}
              style={{ fontSize: "12px", padding: "4px 10px" }}
            >
              {loadingMasterSummary ? "Refreshing…" : "🔄 Refresh Master Counts"}
            </button>
          </div>
        </div>

        <div className="danger-callout-box" style={{ background: "#fff1f2", borderLeftColor: "#be123c", color: "#881337" }}>
          <strong>🚨 Complete Wipe Warning:</strong>
          <span>
            This operation will delete <strong>ALL Master Data and Company Records</strong>:
            Chart of Accounts ({masterSummary?.chartOfAccounts || 0}), Customers ({masterSummary?.customers || 0}), Suppliers ({masterSummary?.suppliers || 0}), Items ({masterSummary?.items || 0}), Bank Accounts ({masterSummary?.bankAccounts || 0}), Tax Codes ({masterSummary?.taxCodes || 0}), Employees ({masterSummary?.employees || 0}), and Company Profile Settings.
            All dependent transactions will also be purged to prevent database foreign key corruption.
          </span>
        </div>

        {/* Master Data Metric Grid */}
        <div className="danger-metric-grid">
          <div className={`danger-metric-box master ${masterSummary && masterSummary.chartOfAccounts > 0 ? "has-data" : ""}`}>
            <span className="danger-metric-count">
              {loadingMasterSummary ? "…" : masterSummary ? masterSummary.chartOfAccounts : 0}
            </span>
            <span className="danger-metric-label">Chart of Accounts</span>
          </div>
          <div className={`danger-metric-box master ${masterSummary && masterSummary.customers > 0 ? "has-data" : ""}`}>
            <span className="danger-metric-count">
              {loadingMasterSummary ? "…" : masterSummary ? masterSummary.customers : 0}
            </span>
            <span className="danger-metric-label">Customer Master</span>
          </div>
          <div className={`danger-metric-box master ${masterSummary && masterSummary.suppliers > 0 ? "has-data" : ""}`}>
            <span className="danger-metric-count">
              {loadingMasterSummary ? "…" : masterSummary ? masterSummary.suppliers : 0}
            </span>
            <span className="danger-metric-label">Supplier Master</span>
          </div>
          <div className={`danger-metric-box master ${masterSummary && masterSummary.items > 0 ? "has-data" : ""}`}>
            <span className="danger-metric-count">
              {loadingMasterSummary ? "…" : masterSummary ? masterSummary.items : 0}
            </span>
            <span className="danger-metric-label">Items & Services</span>
          </div>
          <div className={`danger-metric-box master ${masterSummary && masterSummary.bankAccounts > 0 ? "has-data" : ""}`}>
            <span className="danger-metric-count">
              {loadingMasterSummary ? "…" : masterSummary ? masterSummary.bankAccounts : 0}
            </span>
            <span className="danger-metric-label">Bank Accounts</span>
          </div>
          <div className={`danger-metric-box master ${masterSummary && masterSummary.taxCodes > 0 ? "has-data" : ""}`}>
            <span className="danger-metric-count">
              {loadingMasterSummary ? "…" : masterSummary ? masterSummary.taxCodes : 0}
            </span>
            <span className="danger-metric-label">Tax Codes & Rates</span>
          </div>
          <div className={`danger-metric-box master ${masterSummary && masterSummary.totalMasterRecords > 0 ? "has-data" : ""}`}>
            <span className="danger-metric-count" style={{ color: "#881337" }}>
              {loadingMasterSummary ? "…" : masterSummary ? masterSummary.totalMasterRecords : 0}
            </span>
            <span className="danger-metric-label" style={{ fontWeight: 800 }}>Total Master Records</span>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px", flexWrap: "wrap", gap: "12px" }}>
          <div style={{ fontSize: "12.5px", color: "#881337" }}>
            🔒 Requires Administrator password and typing <code>WIPE ALL MASTER DATA</code> to confirm.
          </div>
          <button
            type="button"
            className="danger-delete-btn factory-reset"
            id="btn-delete-company-master-data"
            onClick={() => {
              setIsMasterDeleteModalOpen(true);
              setMasterDeleteError("");
              setMasterDeleteSuccess(null);
            }}
          >
            <span>💥</span> Delete All Master Data (Full Reset)
          </button>
        </div>
      </div>

      {/* Current Settings Audit Table */}
      <section className="panel table-wrap" style={{ marginTop: "24px" }}>
        <div className="form-title-row">
          <h3>Stored Configuration Audit Trail</h3>
          <span className="auto-badge">{loading ? "Loading…" : `${settings.length} Settings`}</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Variable Key</th>
              <th>Configured Value</th>
              <th>Notes / Evidence Reference</th>
              <th>Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {settings.map((row) => (
              <tr key={row.key}>
                <td>
                  <strong>{row.key}</strong>
                </td>
                <td style={{ fontFamily: "var(--font-mono, monospace)" }}>{row.value || "—"}</td>
                <td>{row.notes || "—"}</td>
                <td style={{ fontSize: "11.5px", color: "#64748b" }}>
                  {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
            {!loading && !settings.length && (
              <tr>
                <td colSpan={4}>No finance settings found in database.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* ERPNext-style Delete Company Transactions Confirmation Modal */}
      {isDeleteModalOpen && (
        <div className="erpnext-modal-overlay" role="dialog" aria-modal="true">
          <div className="erpnext-modal-container">
            <div className="erpnext-modal-header">
              <div className="erpnext-modal-header-title">
                <span style={{ fontSize: "20px" }}>🛡️</span>
                <h3>Delete Company Transactions — Security Verification</h3>
              </div>
              <button
                type="button"
                className="erpnext-modal-close-btn"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={isDeleting}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="erpnext-modal-body">
              {deleteSuccess ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "14px", alignItems: "center", textAlign: "center", padding: "16px 0" }}>
                  <span style={{ fontSize: "44px" }}>✅</span>
                  <h4 style={{ margin: 0, color: "#166534", fontSize: "19px", fontWeight: 800 }}>
                    Company Transactions Wiped Successfully
                  </h4>
                  <p style={{ margin: 0, color: "#334155", fontSize: "13.5px", maxWidth: "460px" }}>
                    {deleteSuccess}
                  </p>
                  {deletedCounts && (
                    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", padding: "14px", borderRadius: "8px", width: "100%", fontSize: "12.5px", textAlign: "left" }}>
                      <strong style={{ color: "#0f172a" }}>Wiped Records Summary:</strong>
                      <ul style={{ margin: "8px 0 0", paddingLeft: "18px", color: "#475569", lineHeight: "1.6" }}>
                        <li>{deletedCounts.journalHeaders || 0} GL Journal Vouchers & {deletedCounts.journalLines || 0} ledger lines wiped</li>
                        <li>{deletedCounts.invoices || 0} Sales Invoices & {deletedCounts.invoiceLines || 0} invoice lines wiped</li>
                        <li>{deletedCounts.supplierBills || 0} Vendor Bills & {deletedCounts.billLines || 0} bill lines wiped</li>
                        <li>{deletedCounts.payments || 0} Customer & Supplier payments wiped</li>
                        <li>{deletedCounts.stockMovements || 0} Stock movement logs wiped</li>
                        <li>{deletedCounts.payrollRuns || 0} Payroll runs & payslips wiped</li>
                        <li>{deletedCounts.totalTransactions || 0} Total transaction records deleted</li>
                      </ul>
                    </div>
                  )}
                  <button
                    type="button"
                    className="coa-btn coa-btn-primary"
                    onClick={() => {
                      setIsDeleteModalOpen(false);
                      setDeleteSuccess(null);
                    }}
                    style={{ marginTop: "10px", minWidth: "160px" }}
                  >
                    Done & Refresh View
                  </button>
                </div>
              ) : (
                <>
                  <div className="erpnext-scope-box">
                    <div>
                      <strong style={{ color: "#991b1b", fontSize: "12.5px" }}>🔴 Records to be DELETED:</strong>
                      <ul className="erpnext-scope-list deleted">
                        <li>General Ledger & Journals</li>
                        <li>Invoices & Sales Quotations</li>
                        <li>Purchase Orders & Vendor Bills</li>
                        <li>Payments, Refunds & Expenses</li>
                        <li>Bank Statement Txns & Recs</li>
                        <li>Stock Movements & Payroll Runs</li>
                      </ul>
                    </div>
                    <div>
                      <strong style={{ color: "#166534", fontSize: "12.5px" }}>🟢 Master Data PRESERVED:</strong>
                      <ul className="erpnext-scope-list preserved">
                        <li>Company Profile & Settings</li>
                        <li>Chart of Accounts Hierarchy</li>
                        <li>Customer & Supplier Master</li>
                        <li>Item Catalog (Qty reset to 0)</li>
                        <li>Bank Accounts & Tax Codes</li>
                        <li>User Accounts & Security Roles</li>
                      </ul>
                    </div>
                  </div>

                  {deleteError && (
                    <div className="settings-blocked-banner">
                      <span>⚠️</span>
                      <div>{deleteError}</div>
                    </div>
                  )}

                  <div className="erpnext-modal-field">
                    <label htmlFor="admin-reauth-password">1. Re-enter Administrator Password *</label>
                    <div className="erpnext-modal-input-wrap">
                      <input
                        id="admin-reauth-password"
                        type={showAdminPassword ? "text" : "password"}
                        className="erpnext-modal-input"
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        placeholder="Enter your current login password"
                        disabled={isDeleting}
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowAdminPassword(!showAdminPassword)}
                        style={{
                          position: "absolute",
                          right: "12px",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: "12.5px",
                          color: "#64748b",
                          fontWeight: 600,
                        }}
                        tabIndex={-1}
                      >
                        {showAdminPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                    <span className="settings-field-hint">
                      Authentication required: Verifies active System Manager privileges.
                    </span>
                  </div>

                  <div className="erpnext-modal-field">
                    <label htmlFor="confirm-company-name">
                      2. Confirmation Prompt: Type <code>{companyName || "Easynet IT Solutions Limited"}</code> *
                    </label>
                    <input
                      id="confirm-company-name"
                      type="text"
                      className="erpnext-modal-input"
                      value={confirmationText}
                      onChange={(e) => setConfirmationText(e.target.value)}
                      placeholder={`Type "${companyName || 'Easynet IT Solutions Limited'}" or "DELETE ALL TRANSACTIONS"`}
                      disabled={isDeleting}
                    />
                    <span className="settings-field-hint">
                      Security safeguard: Type the exact registered company name to unlock deletion.
                    </span>
                  </div>

                  <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", cursor: "pointer", marginTop: "4px" }}>
                    <input
                      type="checkbox"
                      checked={resetStockLevels}
                      onChange={(e) => setResetStockLevels(e.target.checked)}
                      disabled={isDeleting}
                    />
                    <span>Reset warehouse item inventory stock levels to 0</span>
                  </label>
                </>
              )}
            </div>

            {!deleteSuccess && (
              <div className="erpnext-modal-footer">
                <button
                  type="button"
                  className="coa-btn"
                  onClick={() => setIsDeleteModalOpen(false)}
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  id="btn-confirm-delete-transactions"
                  className="danger-delete-btn"
                  onClick={handleDeleteAllTransactions}
                  disabled={
                    isDeleting ||
                    !adminPassword.trim() ||
                    (confirmationText.trim().toLowerCase() !== (companyName || "Easynet IT Solutions Limited").trim().toLowerCase() &&
                     confirmationText.trim().toUpperCase() !== "DELETE ALL TRANSACTIONS")
                  }
                >
                  {isDeleting ? "⏳ Wiping Company Transactions…" : "💥 Confirm & Delete All Transactions"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Master Data Deletion Confirmation Modal */}
      {isMasterDeleteModalOpen && (
        <div className="erpnext-modal-overlay" role="dialog" aria-modal="true">
          <div className="erpnext-modal-container">
            <div className="erpnext-modal-header" style={{ background: "#fff1f2", borderTopColor: "#881337" }}>
              <div className="erpnext-modal-header-title">
                <span style={{ fontSize: "20px" }}>🚨</span>
                <h3 style={{ color: "#881337" }}>Delete All Master Data — Complete Factory Reset</h3>
              </div>
              <button
                type="button"
                className="erpnext-modal-close-btn"
                onClick={() => setIsMasterDeleteModalOpen(false)}
                disabled={isMasterDeleting}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="erpnext-modal-body">
              {masterDeleteSuccess ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "14px", alignItems: "center", textAlign: "center", padding: "16px 0" }}>
                  <span style={{ fontSize: "44px" }}>✅</span>
                  <h4 style={{ margin: 0, color: "#166534", fontSize: "19px", fontWeight: 800 }}>
                    Master Data & Records Wiped Successfully
                  </h4>
                  <p style={{ margin: 0, color: "#334155", fontSize: "13.5px", maxWidth: "460px" }}>
                    {masterDeleteSuccess}
                  </p>
                  {deletedMasterCounts && (
                    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", padding: "14px", borderRadius: "8px", width: "100%", fontSize: "12.5px", textAlign: "left" }}>
                      <strong style={{ color: "#0f172a" }}>Wiped Master Entities:</strong>
                      <ul style={{ margin: "8px 0 0", paddingLeft: "18px", color: "#475569", lineHeight: "1.6" }}>
                        <li>{deletedMasterCounts.chartOfAccounts || 0} Chart of Accounts wiped</li>
                        <li>{deletedMasterCounts.customers || 0} Customers & {deletedMasterCounts.suppliers || 0} Suppliers wiped</li>
                        <li>{deletedMasterCounts.items || 0} Item definitions wiped</li>
                        <li>{deletedMasterCounts.bankAccounts || 0} Bank accounts wiped</li>
                        <li>{deletedMasterCounts.taxCodes || 0} Tax codes wiped</li>
                        <li>{deletedMasterCounts.globalSettings || 0} Company settings wiped</li>
                        <li>{deletedMasterCounts.totalMasterRecords || 0} Total master entities erased</li>
                      </ul>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
                    <Link href="/setup/finance" className="coa-btn coa-btn-primary">
                      🚀 Initialize Fresh Setup
                    </Link>
                    <button
                      type="button"
                      className="coa-btn"
                      onClick={() => {
                        setIsMasterDeleteModalOpen(false);
                        setMasterDeleteSuccess(null);
                      }}
                    >
                      Close
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="danger-callout-box" style={{ background: "#fef2f2", borderLeftColor: "#991b1b", color: "#7f1d1d" }}>
                    <strong>💥 EXTREME DANGER — Irreversible System Reset:</strong>
                    <span>
                      You are about to permanently delete <strong>Chart of Accounts, Customers, Suppliers, Products, Bank Accounts, Tax Codes, Company Configuration, and Employees</strong>.
                      All transactions will also be erased to maintain database integrity.
                    </span>
                  </div>

                  {masterDeleteError && (
                    <div className="settings-blocked-banner">
                      <span>⚠️</span>
                      <div>{masterDeleteError}</div>
                    </div>
                  )}

                  <div className="erpnext-modal-field">
                    <label htmlFor="master-admin-password">1. Re-enter Administrator Password *</label>
                    <div className="erpnext-modal-input-wrap">
                      <input
                        id="master-admin-password"
                        type={showMasterAdminPassword ? "text" : "password"}
                        className="erpnext-modal-input"
                        value={masterAdminPassword}
                        onChange={(e) => setMasterAdminPassword(e.target.value)}
                        placeholder="Enter your current login password"
                        disabled={isMasterDeleting}
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowMasterAdminPassword(!showMasterAdminPassword)}
                        style={{
                          position: "absolute",
                          right: "12px",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: "12.5px",
                          color: "#64748b",
                          fontWeight: 600,
                        }}
                        tabIndex={-1}
                      >
                        {showMasterAdminPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                    <span className="settings-field-hint">
                      Authentication required: Verifies active System Manager privileges.
                    </span>
                  </div>

                  <div className="erpnext-modal-field">
                    <label htmlFor="confirm-master-phrase">
                      2. Safety Confirmation Prompt: Type <code>WIPE ALL MASTER DATA</code> *
                    </label>
                    <input
                      id="confirm-master-phrase"
                      type="text"
                      className="erpnext-modal-input"
                      value={masterConfirmationPhrase}
                      onChange={(e) => setMasterConfirmationPhrase(e.target.value)}
                      placeholder='Type "WIPE ALL MASTER DATA"'
                      disabled={isMasterDeleting}
                    />
                    <span className="settings-field-hint">
                      Type the exact phrase above in capital letters to confirm.
                    </span>
                  </div>

                  <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", cursor: "pointer", marginTop: "4px" }}>
                    <input
                      type="checkbox"
                      checked={preserveAdminAccount}
                      onChange={(e) => setPreserveAdminAccount(e.target.checked)}
                      disabled={isMasterDeleting}
                    />
                    <span><strong>Safeguard:</strong> Keep primary System Administrator account (admin@easynet.local) so you can log back in.</span>
                  </label>
                </>
              )}
            </div>

            {!masterDeleteSuccess && (
              <div className="erpnext-modal-footer">
                <button
                  type="button"
                  className="coa-btn"
                  onClick={() => setIsMasterDeleteModalOpen(false)}
                  disabled={isMasterDeleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  id="btn-confirm-delete-master-data"
                  className="danger-delete-btn factory-reset"
                  onClick={handleDeleteAllMasterData}
                  disabled={
                    isMasterDeleting ||
                    !masterAdminPassword.trim() ||
                    masterConfirmationPhrase.trim().toUpperCase() !== "WIPE ALL MASTER DATA"
                  }
                >
                  {isMasterDeleting ? "⏳ Wiping All Master Data…" : "💥 Confirm & Delete All Master Data"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
