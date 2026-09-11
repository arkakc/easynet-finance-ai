"use client";

import { useEffect, useMemo, useState } from "react";

export type Account = {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  parentId: string | null;
  parentCode: string | null;
  parentName: string | null;
  parentAccount: string;
  normalBalance: string;
  currency: string;
  description: string;
  taxCode: string;
  active: boolean | string;
  isSystem?: boolean;
  childCount?: number;
  journalLineCount?: number;
  isGroup?: boolean;
  directDebit?: number;
  directCredit?: number;
  directBalance?: number;
  totalDebit?: number;
  totalCredit?: number;
  balance?: number;
};

export type TreeNode = Account & {
  children: TreeNode[];
};

export type LedgerEntry = {
  lineId: string;
  postingDate: string;
  voucherNo: string;
  voucherType: string;
  reference: string;
  accountCode: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
};

export type ParsedImportRow = {
  lineNo: number;
  code: string;
  name: string;
  type: string;
  parentCode: string;
  resolvedParentCode?: string;
  resolvedParentName?: string;
  parentStatus?: "explicit" | "inferred" | "root";
  normalBalance: string;
  currency: string;
  description: string;
  status: string;
  isValid: boolean;
  error?: string;
};

export function inferParentCodeClient(code: string, allCodes: Set<string>): string | null {
  const clean = code.trim();
  if (!clean) return null;

  if (clean.includes(".")) {
    const parts = clean.split(".");
    while (parts.length > 1) {
      parts.pop();
      const candidate = parts.join(".");
      if (allCodes.has(candidate)) return candidate;
    }
    return null;
  }

  if (/^\d{4}$/.test(clean)) {
    if (clean.endsWith("000")) return null;
    if (clean.endsWith("00")) {
      const p = clean[0] + "000";
      return allCodes.has(p) ? p : null;
    }
    if (clean.endsWith("0")) {
      const p1 = clean.slice(0, 2) + "00";
      if (allCodes.has(p1)) return p1;
      const p2 = clean[0] + "000";
      if (allCodes.has(p2)) return p2;
      return null;
    }
    const p1 = clean.slice(0, 3) + "0";
    if (allCodes.has(p1)) return p1;
    const p2 = clean.slice(0, 2) + "00";
    if (allCodes.has(p2)) return p2;
    const p3 = clean[0] + "000";
    if (allCodes.has(p3)) return p3;
  }

  for (let len = clean.length - 1; len >= 1; len--) {
    const candidate = clean.slice(0, len);
    if (allCodes.has(candidate)) return candidate;
    const padded = candidate.padEnd(clean.length, "0");
    if (padded !== clean && allCodes.has(padded)) return padded;
  }

  return null;
}

export function parseRowsToAccounts(
  rows: any[][],
  existingAccounts: Account[] = []
): { rows: ParsedImportRow[]; error?: string } {
  if (!rows || rows.length === 0) {
    return { rows: [], error: "The spreadsheet contains no data." };
  }

  // Header detection
  const headerIdx = rows.findIndex((row) =>
    Array.isArray(row) &&
    row.some((cell) => {
      const c = String(cell || "").toLowerCase();
      return c.includes("code") || c.includes("name") || c.includes("type") || c.includes("acct");
    })
  );

  if (headerIdx === -1) {
    return {
      rows: [],
      error: "Header row not detected. Please make sure headers include 'Account Code', 'Account Name', 'Account Type'.",
    };
  }

  const rawHeaders = rows[headerIdx];
  const colMap: Record<string, number> = {};
  rawHeaders.forEach((h, idx) => {
    const norm = String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (
      norm.includes("parent") ||
      norm.includes("subaccount") ||
      norm.includes("subacc") ||
      norm.includes("reportsto") ||
      norm.includes("under") ||
      norm.includes("headeraccount") ||
      (norm.includes("group") && !norm.includes("usergroup"))
    ) {
      colMap["parentCode"] = idx;
    } else if (norm.includes("code") || norm.includes("number") || norm.includes("acctno")) {
      colMap["code"] = idx;
    } else if (norm.includes("name") || norm.includes("title")) {
      colMap["name"] = idx;
    } else if (norm.includes("type") || norm.includes("class") || norm.includes("category")) {
      colMap["type"] = idx;
    } else if (norm.includes("balance") || norm.includes("normal") || norm.includes("drcr")) {
      colMap["normalBalance"] = idx;
    } else if (norm.includes("curr")) {
      colMap["currency"] = idx;
    } else if (norm.includes("desc") || norm.includes("note")) {
      colMap["description"] = idx;
    } else if (norm.includes("stat") || norm.includes("active")) {
      colMap["status"] = idx;
    }
  });

  const validTypesSet = new Set([
    "ASSET", "ASSETS", "LIABILITY", "LIABILITIES", "EQUITY", "REVENUE", "INCOME", "EXPENSE", "EXPENSES", "CONTRA_ASSET", "CONTRA_LIABILITY"
  ]);

  // Build lookups for multi-way parent matching
  const codeToAcc = new Map<string, { code: string; name: string }>();
  const nameToAcc = new Map<string, { code: string; name: string }>();
  const cleanNameToAcc = new Map<string, { code: string; name: string }>();
  const allCodes = new Set<string>();

  existingAccounts.forEach((acc) => {
    codeToAcc.set(acc.accountCode, { code: acc.accountCode, name: acc.accountName });
    nameToAcc.set(acc.accountName.toLowerCase().trim(), { code: acc.accountCode, name: acc.accountName });
    cleanNameToAcc.set(acc.accountName.toLowerCase().replace(/[^a-z0-9]/g, ""), { code: acc.accountCode, name: acc.accountName });
    allCodes.add(acc.accountCode);
  });

  // First pass over data rows: collect all valid account codes in this batch
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !Array.isArray(row) || row.every((c) => !c || String(c).trim() === "")) continue;
    const code = colMap["code"] !== undefined ? String(row[colMap["code"]] ?? "").replace(/^['"]+|['"]+$/g, "").replace(/\.0$/, "").trim() : "";
    const name = colMap["name"] !== undefined ? String(row[colMap["name"]] ?? "").trim() : "";
    if (code && name) {
      codeToAcc.set(code, { code, name });
      nameToAcc.set(name.toLowerCase().trim(), { code, name });
      cleanNameToAcc.set(name.toLowerCase().replace(/[^a-z0-9]/g, ""), { code, name });
      allCodes.add(code);
    }
  }

  // Second pass: Parse rows and resolve parent hierarchy
  const parsed: ParsedImportRow[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !Array.isArray(row) || row.every((c) => !c || String(c).trim() === "")) continue;

    const lineNo = i + 1;
    const code = colMap["code"] !== undefined ? String(row[colMap["code"]] ?? "").replace(/^['"]+|['"]+$/g, "").replace(/\.0$/, "").trim() : "";
    const name = colMap["name"] !== undefined ? String(row[colMap["name"]] ?? "").trim() : "";
    const rawType = colMap["type"] !== undefined ? String(row[colMap["type"]] ?? "").trim().toUpperCase().replace(/\s+/g, "_") : "";
    const rawParent = colMap["parentCode"] !== undefined ? String(row[colMap["parentCode"]] ?? "").trim().replace(/^['"]+|['"]+$/g, "") : "";
    const rawNormal = colMap["normalBalance"] !== undefined ? String(row[colMap["normalBalance"]] ?? "").trim().toUpperCase() : "";
    const currency = colMap["currency"] !== undefined && String(row[colMap["currency"]] ?? "").trim() ? String(row[colMap["currency"]] ?? "").trim().toUpperCase() : "PGK";
    const description = colMap["description"] !== undefined ? String(row[colMap["description"]] ?? "").trim() : "";
    const status = colMap["status"] !== undefined && String(row[colMap["status"]] ?? "").trim() ? String(row[colMap["status"]] ?? "").trim() : "Active";

    let isValid = true;
    let error: string | undefined;

    if (!code) {
      isValid = false;
      error = "Missing Code";
    } else if (!name) {
      isValid = false;
      error = "Missing Name";
    } else if (!rawType || !validTypesSet.has(rawType)) {
      isValid = false;
      error = `Invalid Type: ${rawType || "(empty)"}`;
    }

    // Resolve Parent
    let resolvedParentCode: string | undefined;
    let resolvedParentName: string | undefined;
    let parentStatus: "explicit" | "inferred" | "root" = "root";

    const isExplicitRoot = ["", "none", "root", "-", "0", "null", "n/a", "no parent", "top", "main"].includes(
      rawParent.toLowerCase()
    );

    if (rawParent && !isExplicitRoot) {
      const cleanRaw = rawParent.replace(/\.0$/, "");
      // 1. Exact code
      if (codeToAcc.has(cleanRaw)) {
        const found = codeToAcc.get(cleanRaw)!;
        resolvedParentCode = found.code;
        resolvedParentName = found.name;
        parentStatus = "explicit";
      }
      // 2. Extracted code from string e.g. "1100 - Current Assets"
      if (!resolvedParentCode) {
        const codeMatch = cleanRaw.match(/^([A-Za-z0-9_-]+)[\s—:–-]+/);
        if (codeMatch) {
          const extCode = codeMatch[1].replace(/\.0$/, "");
          if (codeToAcc.has(extCode)) {
            const found = codeToAcc.get(extCode)!;
            resolvedParentCode = found.code;
            resolvedParentName = found.name;
            parentStatus = "explicit";
          }
        }
      }
      // 3. Exact name
      if (!resolvedParentCode) {
        const found = nameToAcc.get(cleanRaw.toLowerCase());
        if (found) {
          resolvedParentCode = found.code;
          resolvedParentName = found.name;
          parentStatus = "explicit";
        }
      }
      // 4. Clean name
      if (!resolvedParentCode) {
        const found = cleanNameToAcc.get(cleanRaw.toLowerCase().replace(/[^a-z0-9]/g, ""));
        if (found) {
          resolvedParentCode = found.code;
          resolvedParentName = found.name;
          parentStatus = "explicit";
        }
      }
    }

    // Fallback: Automatic hierarchical code inference
    if (!resolvedParentCode && !isExplicitRoot) {
      const inferredCode = inferParentCodeClient(code, allCodes);
      if (inferredCode && codeToAcc.has(inferredCode)) {
        const found = codeToAcc.get(inferredCode)!;
        resolvedParentCode = found.code;
        resolvedParentName = found.name;
        parentStatus = "inferred";
      }
    }

    if (!resolvedParentCode) {
      parentStatus = "root";
    }

    parsed.push({
      lineNo,
      code,
      name,
      type: rawType,
      parentCode: rawParent,
      resolvedParentCode,
      resolvedParentName,
      parentStatus,
      normalBalance: rawNormal || (["LIABILITY", "EQUITY", "REVENUE", "CONTRA_ASSET"].includes(rawType) ? "CREDIT" : "DEBIT"),
      currency,
      description,
      status,
      isValid,
      error,
    });
  }

  return { rows: parsed };
}

export function parseClientCSV(
  text: string,
  existingAccounts: Account[] = []
): { rows: ParsedImportRow[]; rawText: string; error?: string } {
  const clean = text.replace(/^\uFEFF/, "").trim();
  if (!clean) {
    return { rows: [], rawText: text };
  }

  const firstLine = clean.split(/\r\n|\r|\n/)[0] || "";
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;

  let delimiter = ",";
  if (tabCount > commaCount && tabCount >= semicolonCount) {
    delimiter = "\t";
  } else if (semicolonCount > commaCount && semicolonCount > tabCount) {
    delimiter = ";";
  }

  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentVal = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const nextChar = clean[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentVal += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentVal += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        currentRow.push(currentVal.trim());
        currentVal = "";
      } else if (char === "\r" || char === "\n") {
        if (char === "\r" && nextChar === "\n") i++;
        currentRow.push(currentVal.trim());
        if (currentRow.some((c) => c.length > 0)) lines.push(currentRow);
        currentRow = [];
        currentVal = "";
      } else {
        currentVal += char;
      }
    }
  }
  if (currentVal.length > 0 || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some((c) => c.length > 0)) lines.push(currentRow);
  }

  const res = parseRowsToAccounts(lines, existingAccounts);
  return { rows: res.rows, rawText: text, error: res.error };
}

const ACCOUNT_TYPES = [
  { value: "ASSET", label: "Asset", normalBalance: "DEBIT" },
  { value: "LIABILITY", label: "Liability", normalBalance: "CREDIT" },
  { value: "EQUITY", label: "Equity", normalBalance: "CREDIT" },
  { value: "REVENUE", label: "Revenue", normalBalance: "CREDIT" },
  { value: "EXPENSE", label: "Expense", normalBalance: "DEBIT" },
  { value: "CONTRA_ASSET", label: "Contra Asset", normalBalance: "CREDIT" },
  { value: "CONTRA_LIABILITY", label: "Contra Liability", normalBalance: "DEBIT" },
];

export const formatMoney = (amount?: number, currency: string = "PGK") => {
  const val = Number(amount || 0);
  const prefix = currency === "USD" ? "$" : currency === "AUD" ? "A$" : "K";
  const formatted = Math.abs(val).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return val < 0 ? `-${prefix} ${formatted}` : `${prefix} ${formatted}`;
};

export default function AccountsClient() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // UI view controls
  const [viewMode, setViewMode] = useState<"tree" | "table">("tree");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Edit/Add Account Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"edit" | "add_child" | "add_root">("edit");
  const [targetAccount, setTargetAccount] = useState<Account | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  // Edit/Add Form Fields
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("ASSET");
  const [formParentId, setFormParentId] = useState<string>("");
  const [formNormalBalance, setFormNormalBalance] = useState("DEBIT");
  const [formCurrency, setFormCurrency] = useState("PGK");
  const [formDescription, setFormDescription] = useState("");
  const [formActive, setFormActive] = useState(true);

  // General Ledger Drawer/Modal State
  const [ledgerModalOpen, setLedgerModalOpen] = useState(false);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerAccount, setLedgerAccount] = useState<Account | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [ledgerSummary, setLedgerSummary] = useState<{
    totalDebit: number;
    totalCredit: number;
    netBalance: number;
    entryCount: number;
  } | null>(null);
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerStartDate, setLedgerStartDate] = useState("");
  const [ledgerEndDate, setLedgerEndDate] = useState("");

  // Chart of Accounts Import Modal State
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importTab, setImportTab] = useState<"file" | "paste">("file");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importRawText, setImportRawText] = useState("");
  const [importParsedRows, setImportParsedRows] = useState<ParsedImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [dragActive, setDragActive] = useState(false);

  const resetImportState = () => {
    setImportFile(null);
    setImportRawText("");
    setImportParsedRows([]);
    setImportError("");
    setDragActive(false);
  };

  const openImportModal = () => {
    resetImportState();
    setImportModalOpen(true);
  };

  const [rebuildingTree, setRebuildingTree] = useState(false);

  const handleFileChange = (file: File) => {
    setImportFile(file);
    setImportError("");
    const isExcel = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");
    if (isExcel) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const buffer = e.target?.result as ArrayBuffer;
          const XLSX = await import("xlsx");
          const workbook = XLSX.read(buffer, { type: "array" });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
          const csvText = XLSX.utils.sheet_to_csv(sheet);
          setImportRawText(csvText);
          const res = parseRowsToAccounts(rows, accounts);
          if (res.error) {
            setImportError(res.error);
          }
          setImportParsedRows(res.rows);
        } catch (err) {
          setImportError(err instanceof Error ? err.message : "Failed to parse Excel file");
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = String(e.target?.result || "");
        setImportRawText(content);
        const res = parseClientCSV(content, accounts);
        if (res.error) {
          setImportError(res.error);
        }
        setImportParsedRows(res.rows);
      };
      reader.readAsText(file, "UTF-8");
    }
  };

  const handlePasteChange = (text: string) => {
    setImportRawText(text);
    setImportError("");
    const res = parseClientCSV(text, accounts);
    if (res.error) {
      setImportError(res.error);
    }
    setImportParsedRows(res.rows);
  };

  const handleDownloadTemplate = () => {
    const link = document.createElement("a");
    link.href = "/api/ui/accounts/import";
    link.download = "Easynet_COA_Import_Template.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Downloading official Chart of Accounts CSV template…");
  };

  const handleExecuteImport = async () => {
    if (!importRawText.trim() && importParsedRows.length === 0) {
      setImportError("Please upload a spreadsheet file or paste account rows before importing.");
      return;
    }

    const invalidCount = importParsedRows.filter((r) => !r.isValid).length;
    if (invalidCount > 0) {
      setImportError(`Cannot import while there are ${invalidCount} invalid rows. Please fix the highlighted issues.`);
      return;
    }

    try {
      setImporting(true);
      setImportError("");

      const res = await fetch("/api/ui/accounts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          csvText: importRawText,
          rows: importParsedRows 
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Import failed. Please check your data.");
      }

      showToast(data.message || `Successfully imported ${data.totalProcessed} accounts!`);
      setImportModalOpen(false);
      resetImportState();
      await loadAccounts();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import accounts");
    } finally {
      setImporting(false);
    }
  };

  const handleRebuildTree = async () => {
    if (!confirm("Rebuild Account Hierarchy? This will inspect all account codes and hierarchical patterns to link child accounts to their parent categories.")) {
      return;
    }
    try {
      setRebuildingTree(true);
      const res = await fetch("/api/ui/accounts/rebuild-tree", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to rebuild hierarchy");
      }
      showToast(data.message || `Hierarchy reconstructed! Updated ${data.updatedCount} accounts.`);
      await loadAccounts();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to rebuild hierarchy", "error");
    } finally {
      setRebuildingTree(false);
    }
  };

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadAccounts = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/ui/accounts", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Unable to load accounts");
      const list: Account[] = data.accounts || [];
      setAccounts(list);

      // Default expand top-level root accounts and first level children
      const initialExpand = new Set<string>();
      list.forEach((acc) => {
        if (!acc.parentId || acc.accountCode.length <= 2 || (acc.accountCode.length === 4 && acc.accountCode.endsWith("00"))) {
          initialExpand.add(acc.accountId);
        }
      });
      setExpandedIds(initialExpand);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAccounts();
  }, []);

  // Fetch Ledger for selected account
  const loadLedger = async (account: Account, startDate?: string, endDate?: string) => {
    try {
      setLedgerLoading(true);
      setLedgerAccount(account);
      setLedgerModalOpen(true);

      const params = new URLSearchParams({ accountId: account.accountId });
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);

      const res = await fetch(`/api/ui/accounts/ledger?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to load ledger entries");

      setLedgerEntries(data.entries || []);
      setLedgerSummary(data.summary || null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load ledger", "error");
    } finally {
      setLedgerLoading(false);
    }
  };

  const openLedgerView = (acc: Account, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setLedgerSearch("");
    setLedgerStartDate("");
    setLedgerEndDate("");
    void loadLedger(acc);
  };

  const handleDateFilterChange = (start: string, end: string) => {
    setLedgerStartDate(start);
    setLedgerEndDate(end);
    if (ledgerAccount) {
      void loadLedger(ledgerAccount, start, end);
    }
  };

  // Build Hierarchical Tree
  const { tree, accountMap } = useMemo(() => {
    const map = new Map<string, TreeNode>();
    accounts.forEach((acc) => {
      map.set(acc.accountId, { ...acc, children: [] });
    });

    const roots: TreeNode[] = [];

    // Sort accounts primarily by code numerically
    const sorted = [...accounts].sort((a, b) => a.accountCode.localeCompare(b.accountCode, undefined, { numeric: true }));

    sorted.forEach((acc) => {
      const node = map.get(acc.accountId)!;
      if (acc.parentId && map.has(acc.parentId)) {
        map.get(acc.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });

    return { tree: roots, accountMap: map };
  }, [accounts]);

  // Handle Search Filtering & Auto-expansion
  const matchingAccountIds = useMemo(() => {
    if (!searchTerm.trim()) return null;
    const term = searchTerm.toLowerCase().trim();
    const matches = new Set<string>();

    accounts.forEach((acc) => {
      if (
        acc.accountCode.toLowerCase().includes(term) ||
        acc.accountName.toLowerCase().includes(term) ||
        acc.accountType.toLowerCase().includes(term)
      ) {
        matches.add(acc.accountId);

        // Walk up parents and expand them
        let curr = acc.parentId;
        while (curr && accountMap.has(curr)) {
          matches.add(curr);
          curr = accountMap.get(curr)!.parentId;
        }
      }
    });

    return matches;
  }, [searchTerm, accounts, accountMap]);

  // When search changes, auto-expand matching ancestor paths
  useEffect(() => {
    if (matchingAccountIds && matchingAccountIds.size > 0) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        matchingAccountIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }, [matchingAccountIds]);

  const toggleExpand = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExpandAll = () => {
    const allGroupIds = new Set<string>();
    accounts.forEach((acc) => {
      if (acc.childCount && acc.childCount > 0) allGroupIds.add(acc.accountId);
    });
    setExpandedIds(allGroupIds);
  };

  const handleCollapseAll = () => {
    setExpandedIds(new Set());
  };

  // Open Modal Helpers
  const openEditModal = (acc: Account, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setTargetAccount(acc);
    setModalMode("edit");
    setFormCode(acc.accountCode);
    setFormName(acc.accountName);
    setFormType(acc.accountType);
    setFormParentId(acc.parentId || "");
    setFormNormalBalance(acc.normalBalance || "DEBIT");
    setFormCurrency(acc.currency || "PGK");
    setFormDescription(acc.description || "");
    setFormActive(String(acc.active).toLowerCase() !== "false");
    setModalError("");
    setModalOpen(true);
  };

  const openAddChildModal = (parent: Account, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setTargetAccount(parent);
    setModalMode("add_child");

    // Suggest next logical code under this parent
    const childCodes = accounts
      .filter((a) => a.parentId === parent.accountId)
      .map((a) => parseInt(a.accountCode, 10))
      .filter((n) => !isNaN(n));

    let suggestedCode = "";
    if (childCodes.length > 0) {
      suggestedCode = String(Math.max(...childCodes) + 1);
    } else {
      suggestedCode = parent.accountCode.length === 4 ? `${parent.accountCode.slice(0, 3)}1` : `${parent.accountCode}1`;
    }

    setFormCode(suggestedCode);
    setFormName("");
    setFormType(parent.accountType);
    setFormParentId(parent.accountId);
    setFormNormalBalance(parent.normalBalance || "DEBIT");
    setFormCurrency(parent.currency || "PGK");
    setFormDescription("");
    setFormActive(true);
    setModalError("");
    setModalOpen(true);
  };

  const openAddRootModal = () => {
    setTargetAccount(null);
    setModalMode("add_root");
    setFormCode("");
    setFormName("");
    setFormType("ASSET");
    setFormParentId("");
    setFormNormalBalance("DEBIT");
    setFormCurrency("PGK");
    setFormDescription("");
    setFormActive(true);
    setModalError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setTargetAccount(null);
    setModalError("");
  };

  // Form Save Handler
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCode.trim()) {
      setModalError("Account code is required");
      return;
    }
    if (!formName.trim()) {
      setModalError("Account name is required");
      return;
    }

    setSaving(true);
    setModalError("");

    try {
      if (modalMode === "edit" && targetAccount) {
        // Update Account
        const res = await fetch("/api/ui/accounts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: targetAccount.accountId,
            code: formCode.trim(),
            name: formName.trim(),
            type: formType,
            parentId: formParentId.trim() || null,
            normalBalance: formNormalBalance,
            currency: formCurrency.trim().toUpperCase(),
            description: formDescription.trim(),
            isActive: formActive,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "Failed to update account");

        showToast(`Account "${formCode} - ${formName}" updated successfully!`);
        await loadAccounts();
        closeModal();
      } else {
        // Create Account (add_child or add_root)
        const res = await fetch("/api/ui/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: formCode.trim(),
            name: formName.trim(),
            type: formType,
            parentId: formParentId.trim() || null,
            normalBalance: formNormalBalance,
            currency: formCurrency.trim().toUpperCase(),
            description: formDescription.trim(),
            isActive: formActive,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "Failed to create account");

        showToast(`Account "${formCode} - ${formName}" created successfully!`);
        await loadAccounts();
        closeModal();
      }
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setSaving(false);
    }
  };

  // Delete Account Handler
  const handleDelete = async () => {
    if (!targetAccount) return;
    const confirmed = window.confirm(
      `Are you sure you want to delete account "${targetAccount.accountCode} - ${targetAccount.accountName}"?\n\nThis action cannot be undone.`
    );
    if (!confirmed) return;

    setSaving(true);
    setModalError("");

    try {
      const res = await fetch(`/api/ui/accounts?accountId=${targetAccount.accountId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to delete account");

      showToast(`Account "${targetAccount.accountCode}" deleted successfully!`);
      await loadAccounts();
      closeModal();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  // EXCEL EXPORT FUNCTIONS
  const exportLedgerToExcel = () => {
    if (!ledgerAccount || ledgerEntries.length === 0) {
      showToast("No ledger transactions to export", "error");
      return;
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const filename = `Easynet_Ledger_${ledgerAccount.accountCode}_${todayStr}.csv`;

    const csvRows: string[] = [];
    csvRows.push(`"Easynet IT Solutions Limited - General Ledger Statement"`);
    csvRows.push(`"Account:","${ledgerAccount.accountCode} - ${ledgerAccount.accountName}","Type:","${ledgerAccount.accountType}","Normal Balance:","${ledgerAccount.normalBalance}"`);
    csvRows.push(`"Generated On:","${new Date().toLocaleString()}","Currency:","${ledgerAccount.currency}"`);
    if (ledgerSummary) {
      csvRows.push(`"Total Debit:","${ledgerSummary.totalDebit.toFixed(2)}","Total Credit:","${ledgerSummary.totalCredit.toFixed(2)}","Closing Net Balance:","${ledgerSummary.netBalance.toFixed(2)}"`);
    }
    csvRows.push(`""`);
    csvRows.push(`"Posting Date","Voucher No","Voucher Type","Reference","Account Code","Account Name","Particulars / Description","Debit (PGK)","Credit (PGK)","Running Balance (PGK)"`);

    const filtered = ledgerSearch
      ? ledgerEntries.filter(
          (e) =>
            e.voucherNo.toLowerCase().includes(ledgerSearch.toLowerCase()) ||
            e.voucherType.toLowerCase().includes(ledgerSearch.toLowerCase()) ||
            e.reference.toLowerCase().includes(ledgerSearch.toLowerCase()) ||
            e.description.toLowerCase().includes(ledgerSearch.toLowerCase()) ||
            e.accountCode.toLowerCase().includes(ledgerSearch.toLowerCase()) ||
            e.accountName.toLowerCase().includes(ledgerSearch.toLowerCase())
        )
      : ledgerEntries;

    filtered.forEach((entry) => {
      const dateStr = entry.postingDate.slice(0, 10);
      const safeDesc = entry.description.replace(/"/g, '""');
      const safeRef = entry.reference.replace(/"/g, '""');
      csvRows.push(
        `"${dateStr}","${entry.voucherNo}","${entry.voucherType}","${safeRef}","${entry.accountCode}","${entry.accountName}","${safeDesc}","${entry.debit.toFixed(2)}","${entry.credit.toFixed(2)}","${entry.runningBalance.toFixed(2)}"`
      );
    });

    const csvContent = "\uFEFF" + csvRows.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Exported ${filtered.length} ledger lines to ${filename}`);
  };

  const exportCOAToExcel = () => {
    if (accounts.length === 0) {
      showToast("No accounts available to export", "error");
      return;
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const filename = `Easynet_Chart_of_Accounts_${todayStr}.csv`;

    const csvRows: string[] = [];
    csvRows.push(`"Easynet IT Solutions Limited - Chart of Accounts & Balances"`);
    csvRows.push(`"Generated On:","${new Date().toLocaleString()}","Base Currency:","PGK"`);
    csvRows.push(`""`);
    csvRows.push(
      `"Account Code","Account Name","Account Type","Parent Code","Normal Balance","Currency","Description","Status","Direct Balance (PGK)","Current Value / Rolled-up Balance (PGK)","Parent Account"`
    );

    const sorted = [...accounts].sort((a, b) => a.accountCode.localeCompare(b.accountCode, undefined, { numeric: true }));

    sorted.forEach((acc) => {
      const status = String(acc.active).toLowerCase() === "false" ? "Inactive" : "Active";
      const parentCode = acc.parentCode || "";
      const safeName = acc.accountName.replace(/"/g, '""');
      const safeDesc = (acc.description || "").replace(/"/g, '""');
      const parentAccount = (acc.parentAccount || "").replace(/"/g, '""');
      csvRows.push(
        `"${acc.accountCode}","${safeName}","${acc.accountType}","${parentCode}","${acc.normalBalance}","${acc.currency}","${safeDesc}","${status}","${(acc.directBalance || 0).toFixed(2)}","${(acc.balance || 0).toFixed(2)}","${parentAccount}"`
      );
    });

    const csvContent = "\uFEFF" + csvRows.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Exported ${accounts.length} accounts to ${filename}`);
  };

  // Helper for Account Type badge color
  const getTypeBadgeClass = (type: string) => {
    const t = type.toUpperCase();
    if (t.includes("ASSET")) return "coa-type-asset";
    if (t.includes("LIABILITY")) return "coa-type-liability";
    if (t.includes("EQUITY")) return "coa-type-equity";
    if (t.includes("REVENUE") || t.includes("INCOME")) return "coa-type-revenue";
    if (t.includes("EXPENSE")) return "coa-type-expense";
    return "coa-type-asset";
  };

  const getVoucherTypePillClass = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes("inv")) return "invoice";
    if (t.includes("pay")) return "payment";
    if (t.includes("bill")) return "bill";
    if (t.includes("payroll")) return "payroll";
    if (t.includes("open")) return "opening";
    return "journal";
  };

  // Recursive Tree Node Renderer
  const renderTreeNode = (node: TreeNode, depth: number = 0) => {
    const isMatching = !matchingAccountIds || matchingAccountIds.has(node.accountId);
    if (!isMatching) return null;

    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedIds.has(node.accountId);
    const isSelected = targetAccount?.accountId === node.accountId && modalOpen;
    const hasValue = (node.balance ?? 0) !== 0;

    return (
      <li key={node.accountId} className="coa-tree-node">
        <div
          className={`coa-node-row ${isSelected ? "selected" : ""}`}
          onClick={() => openEditModal(node)}
          title="Click to view details, edit, or check general ledger"
        >
          {/* Chevron / Leaf Icon */}
          {hasChildren ? (
            <button
              type="button"
              className="coa-toggle-chevron"
              onClick={(e) => toggleExpand(node.accountId, e)}
              title={isExpanded ? "Collapse branch" : "Expand branch"}
            >
              {isExpanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="coa-leaf-dot">●</span>
          )}

          {/* Folder vs Document Icon */}
          <span className="coa-node-icon">
            {hasChildren ? (isExpanded ? "📂" : "📁") : "📄"}
          </span>

          {/* Code & Name */}
          <span className="coa-node-code">{node.accountCode}</span>
          <span className="coa-node-name">{node.accountName}</span>

          {/* Current Value / Balance Badge */}
          <span
            className={`coa-node-balance ${hasChildren ? "group" : hasValue ? "has-value" : "zero"}`}
            title={
              hasChildren
                ? `Rolled-up total balance of all ${node.children.length} sub-accounts`
                : `Direct General Ledger balance (${node.currency})`
            }
          >
            {formatMoney(node.balance, node.currency)}
          </span>

          {/* Badges */}
          <div className="coa-node-badges">
            <span className={`coa-badge-type ${getTypeBadgeClass(node.accountType)}`}>
              {node.accountType}
            </span>

            {hasChildren ? (
              <span className="coa-badge-group">Group ({node.children.length})</span>
            ) : (
              <span className="coa-badge-tag">Ledger</span>
            )}

            <span className="coa-badge-tag">{node.normalBalance === "CREDIT" ? "CR" : "DR"}</span>

            {String(node.active).toLowerCase() === "false" && (
              <span className="badge" style={{ background: "#fee2e2", color: "#b91c1c", border: "1px solid #fca5a5" }}>
                Inactive
              </span>
            )}
          </div>

          {/* Hover Actions */}
          <div className="coa-node-actions">
            <button
              type="button"
              className="coa-action-pill"
              onClick={(e) => openLedgerView(node, e)}
              title="View General Ledger transactions & vouchers"
              style={{ background: "#eff6ff", color: "#1d4ed8", borderColor: "#bfdbfe" }}
            >
              📖 Ledger
            </button>
            <button
              type="button"
              className="coa-action-pill"
              onClick={(e) => openAddChildModal(node, e)}
              title="Add child account under this parent"
            >
              ➕ Add Child
            </button>
            <button
              type="button"
              className="coa-action-pill"
              onClick={(e) => openEditModal(node, e)}
              title="Edit account"
            >
              ✏️ Edit
            </button>
          </div>
        </div>

        {/* Child Subtree */}
        {hasChildren && isExpanded && (
          <div className="coa-children-container">
            <ul className="coa-tree-list">
              {node.children.map((child) => renderTreeNode(child, depth + 1))}
            </ul>
          </div>
        )}
      </li>
    );
  };

  // Summary Metrics
  const totalAssetsValue = accounts.find((a) => a.accountCode === "1000")?.balance || 0;
  const totalLiabilitiesValue = accounts.find((a) => a.accountCode === "2000")?.balance || 0;
  const totalEquityValue = accounts.find((a) => a.accountCode === "3000")?.balance || 0;
  const totalRevenueValue = accounts.find((a) => a.accountCode === "4000")?.balance || 0;

  return (
    <>
      {/* Toast Alert */}
      {toast && (
        <div className={`coa-toast ${toast.type}`}>
          <span>{toast.type === "success" ? "✓" : "⚠️"}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Page Header */}
      <div className="page-head">
        <div>
          <h2>Chart of Accounts & General Ledger</h2>
          <p className="small">
            Easynet IT Solutions Limited (PNG) — ERPNext-style hierarchical general ledger, live rolled-up values & voucher audit trail.
          </p>
        </div>
        <div className="page-head-actions">
          <div className="badge">{accounts.length} ACCOUNTS CONFIGURED</div>
          {error && (
            <details className="system-notice-tab">
              <summary>
                <span>ℹ️ System Notice</span>
                <span className="notice-arrow">▾</span>
              </summary>
              <div className="system-notice-dropdown">
                <strong>Backend warning:</strong> {error}
              </div>
            </details>
          )}
        </div>
      </div>

      {/* KPI Cards with Live Rolled-up Values */}
      <div className="grid">
        <div className="card">
          <div className="label">Total Assets (1000)</div>
          <div className="value" style={{ color: "#1e40af" }}>
            {formatMoney(totalAssetsValue, "PGK")}
          </div>
        </div>
        <div className="card">
          <div className="label">Total Liabilities (2000)</div>
          <div className="value" style={{ color: "#92400e" }}>
            {formatMoney(totalLiabilitiesValue, "PGK")}
          </div>
        </div>
        <div className="card">
          <div className="label">Total Equity (3000)</div>
          <div className="value" style={{ color: "#6b21a8" }}>
            {formatMoney(totalEquityValue, "PGK")}
          </div>
        </div>
        <div className="card">
          <div className="label">YTD Revenue (4000)</div>
          <div className="value" style={{ color: "#166534" }}>
            {formatMoney(totalRevenueValue, "PGK")}
          </div>
        </div>
      </div>

      {/* Control Toolbar */}
      <div className="coa-toolbar">
        {/* Search */}
        <div className="coa-search-box">
          <span className="coa-search-icon">🔍</span>
          <input
            type="text"
            className="coa-search-input"
            placeholder="Search accounts by code, name, type…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Tree & View Actions */}
        <div className="coa-toolbar-actions">
          {viewMode === "tree" && (
            <>
              <button type="button" className="coa-btn" onClick={handleExpandAll} title="Expand all tree branches">
                <span>▾</span> Expand All
              </button>
              <button type="button" className="coa-btn" onClick={handleCollapseAll} title="Collapse all tree branches">
                <span>▸</span> Collapse All
              </button>
            </>
          )}

          <button
            type="button"
            className="coa-btn coa-btn-info"
            onClick={openImportModal}
            title="Import Chart of Accounts from CSV or Excel template"
          >
            <span>📤</span> Import Accounts
          </button>

          <button
            type="button"
            className="coa-btn coa-btn-rebuild"
            onClick={handleRebuildTree}
            disabled={rebuildingTree}
            title="Auto-detect & link parent-child hierarchy from account codes for existing accounts"
          >
            <span>⚡</span> {rebuildingTree ? "Rebuilding…" : "Rebuild Hierarchy"}
          </button>

          <button type="button" className="coa-btn coa-btn-success" onClick={exportCOAToExcel} title="Export full Chart of Accounts & Balances to Excel">
            <span>📥</span> Export to Excel
          </button>

          <button type="button" className="coa-btn coa-btn-primary" onClick={openAddRootModal}>
            <span>➕</span> New Root Account
          </button>

          {/* View Toggle */}
          <div className="coa-view-toggle">
            <button
              type="button"
              className={`coa-toggle-btn ${viewMode === "tree" ? "active" : ""}`}
              onClick={() => setViewMode("tree")}
            >
              🌲 Tree View
            </button>
            <button
              type="button"
              className={`coa-toggle-btn ${viewMode === "table" ? "active" : ""}`}
              onClick={() => setViewMode("table")}
            >
              📋 Table View
            </button>
          </div>
        </div>
      </div>

      {/* Main View Area */}
      {viewMode === "tree" ? (
        <section className="coa-tree-wrapper">
          {loading ? (
            <div style={{ padding: "30px", textAlign: "center", color: "#64748b" }}>
              Loading Chart of Accounts tree structure & balances…
            </div>
          ) : tree.length === 0 ? (
            <div style={{ padding: "30px", textAlign: "center", color: "#64748b" }}>
              No accounts match the current filter.
            </div>
          ) : (
            <ul className="coa-tree-list">
              {tree.map((node) => renderTreeNode(node))}
            </ul>
          )}
        </section>
      ) : (
        <section className="panel table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Account</th>
                <th>Type</th>
                <th>Parent</th>
                <th style={{ textAlign: "right" }}>Current Value / Balance</th>
                <th>Category</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts
                .filter(
                  (a) =>
                    !searchTerm.trim() ||
                    a.accountCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    a.accountName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    a.accountType.toLowerCase().includes(searchTerm.toLowerCase())
                )
                .map((account) => (
                  <tr key={account.accountId} style={{ cursor: "pointer" }} onClick={() => openEditModal(account)}>
                    <td>
                      <strong>{account.accountCode}</strong>
                    </td>
                    <td>{account.accountName}</td>
                    <td>
                      <span className={`coa-badge-type ${getTypeBadgeClass(account.accountType)}`}>
                        {account.accountType}
                      </span>
                    </td>
                    <td>{account.parentAccount || "— (Root)"}</td>
                    <td style={{ textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                      <span className={account.isGroup ? "text-primary" : ""}>
                        {formatMoney(account.balance, account.currency)}
                      </span>
                    </td>
                    <td>
                      <span className={account.isGroup ? "coa-badge-group" : "coa-badge-tag"}>
                        {account.isGroup ? `Group (${account.childCount})` : "Ledger"}
                      </span>
                    </td>
                    <td>
                      <span className="badge">
                        {String(account.active).toLowerCase() === "false" ? "Inactive" : "Active"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "6px" }} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="coa-action-pill"
                          onClick={() => openLedgerView(account)}
                          style={{ background: "#eff6ff", color: "#1d4ed8", borderColor: "#bfdbfe" }}
                        >
                          📖 Ledger
                        </button>
                        <button
                          type="button"
                          className="coa-action-pill"
                          onClick={() => openEditModal(account)}
                        >
                          ✏️ Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              {loading && (
                <tr>
                  <td colSpan={8}>Loading live account values…</td>
                </tr>
              )}
              {!loading && !accounts.length && !error && (
                <tr>
                  <td colSpan={8}>No accounts found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {/* Edit/Add Account Modal (Popup Window) */}
      {modalOpen && (
        <div className="coa-modal-backdrop" onClick={closeModal}>
          <div className="coa-modal" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="coa-modal-header">
              <div className="coa-modal-title">
                <span style={{ fontSize: "20px" }}>
                  {modalMode === "edit" ? (targetAccount?.isGroup ? "📁" : "📄") : "➕"}
                </span>
                <div>
                  <h3>
                    {modalMode === "edit"
                      ? `Edit Account: ${targetAccount?.accountCode} — ${targetAccount?.accountName}`
                      : modalMode === "add_child"
                      ? `Add Child Account under ${targetAccount?.accountCode} — ${targetAccount?.accountName}`
                      : "Create New Root Account"}
                  </h3>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>
                    {modalMode === "edit"
                      ? targetAccount?.isGroup
                        ? `Group Account · Current Value: ${formatMoney(targetAccount.balance, targetAccount.currency)}`
                        : `Ledger Account · Current Value: ${formatMoney(targetAccount?.balance, targetAccount?.currency)}`
                      : "Configure hierarchy, account classification, and currency"}
                  </span>
                </div>
              </div>
              <button type="button" className="coa-modal-close" onClick={closeModal}>
                ✕
              </button>
            </div>

            {/* Modal Form Body */}
            <form onSubmit={handleSave}>
              <div className="coa-modal-body">
                {modalError && (
                  <div
                    style={{
                      padding: "10px 14px",
                      background: "#fee2e2",
                      border: "1px solid #fca5a5",
                      borderRadius: "8px",
                      color: "#b91c1c",
                      fontSize: "12.5px",
                      fontWeight: 600,
                    }}
                  >
                    ⚠️ {modalError}
                  </div>
                )}

                <div className="coa-form-row">
                  <div className="coa-form-group">
                    <label>Account Code *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 1121"
                      value={formCode}
                      onChange={(e) => setFormCode(e.target.value)}
                    />
                  </div>

                  <div className="coa-form-group">
                    <label>Account Type *</label>
                    <select
                      value={formType}
                      onChange={(e) => {
                        const newType = e.target.value;
                        setFormType(newType);
                        const found = ACCOUNT_TYPES.find((t) => t.value === newType);
                        if (found) setFormNormalBalance(found.normalBalance);
                      }}
                    >
                      {ACCOUNT_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label} ({t.value})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="coa-form-group">
                  <label>Account Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. BSP Main Operating Account"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                  />
                </div>

                <div className="coa-form-group">
                  <label>Main / Parent Account</label>
                  <select
                    value={formParentId}
                    onChange={(e) => setFormParentId(e.target.value)}
                  >
                    <option value="">— None (Top-level Root Group) —</option>
                    {accounts
                      .filter((a) => a.accountId !== targetAccount?.accountId) // Cannot be own parent
                      .sort((a, b) => a.accountCode.localeCompare(b.accountCode, undefined, { numeric: true }))
                      .map((a) => (
                        <option key={a.accountId} value={a.accountId}>
                          {a.accountCode} — {a.accountName} ({a.accountType})
                        </option>
                      ))}
                  </select>
                </div>

                <div className="coa-form-row">
                  <div className="coa-form-group">
                    <label>Normal Balance</label>
                    <select
                      value={formNormalBalance}
                      onChange={(e) => setFormNormalBalance(e.target.value)}
                    >
                      <option value="DEBIT">Debit (DR)</option>
                      <option value="CREDIT">Credit (CR)</option>
                    </select>
                  </div>

                  <div className="coa-form-group">
                    <label>Currency</label>
                    <select
                      value={formCurrency}
                      onChange={(e) => setFormCurrency(e.target.value)}
                    >
                      <option value="PGK">PGK — Papua New Guinea Kina</option>
                      <option value="USD">USD — US Dollar</option>
                      <option value="AUD">AUD — Australian Dollar</option>
                    </select>
                  </div>
                </div>

                <div className="coa-form-group">
                  <label>Description / Usage Purpose</label>
                  <textarea
                    placeholder="Describe account purpose or posting guidelines..."
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                  />
                </div>

                <label className="coa-checkbox-label">
                  <input
                    type="checkbox"
                    checked={formActive}
                    onChange={(e) => setFormActive(e.target.checked)}
                  />
                  <span>Active Account (available for transaction posting)</span>
                </label>
              </div>

              {/* Modal Footer */}
              <div className="coa-modal-footer">
                <div className="coa-footer-left">
                  {modalMode === "edit" && targetAccount && (
                    <>
                      <button
                        type="button"
                        className="coa-btn"
                        onClick={() => {
                          closeModal();
                          openLedgerView(targetAccount);
                        }}
                        style={{ background: "#eff6ff", color: "#1d4ed8", borderColor: "#bfdbfe" }}
                        title="View complete transaction ledger"
                      >
                        📖 View General Ledger
                      </button>

                      <button
                        type="button"
                        className="coa-btn"
                        onClick={() => openAddChildModal(targetAccount)}
                        title="Add child sub-account under this account"
                      >
                        ➕ Add Child
                      </button>

                      {!targetAccount.isSystem && (
                        <button
                          type="button"
                          className="coa-btn coa-btn-danger"
                          onClick={handleDelete}
                          disabled={saving || (targetAccount.childCount ?? 0) > 0 || (targetAccount.journalLineCount ?? 0) > 0}
                          title={
                            (targetAccount.childCount ?? 0) > 0
                              ? "Cannot delete: Account has sub-accounts"
                              : (targetAccount.journalLineCount ?? 0) > 0
                              ? "Cannot delete: Account has posted transactions"
                              : "Delete this account"
                          }
                        >
                          🗑️ Delete
                        </button>
                      )}
                    </>
                  )}
                </div>

                <div className="coa-footer-right">
                  <button type="button" className="coa-btn" onClick={closeModal} disabled={saving}>
                    Cancel
                  </button>
                  <button type="submit" className="coa-btn coa-btn-primary" disabled={saving}>
                    {saving ? "Saving…" : modalMode === "edit" ? "Save Changes" : "Create Account"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* General Ledger Interactive View (ERPNext Voucher Posting Drawer) */}
      {ledgerModalOpen && ledgerAccount && (
        <div className="coa-modal-backdrop" onClick={() => setLedgerModalOpen(false)}>
          <div className="coa-ledger-modal" onClick={(e) => e.stopPropagation()}>
            {/* Ledger Header */}
            <div className="coa-modal-header">
              <div className="coa-modal-title">
                <span style={{ fontSize: "22px" }}>📖</span>
                <div>
                  <h3>
                    General Ledger: {ledgerAccount.accountCode} — {ledgerAccount.accountName}
                  </h3>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>
                    {ledgerAccount.isGroup
                      ? `Group Account · Rolls up transactions for ${ledgerAccount.childCount} sub-accounts`
                      : `Ledger Account · Normal Balance: ${ledgerAccount.normalBalance}`}
                    {" · "}
                    Current Value:{" "}
                    <strong style={{ color: "#0f172a" }}>
                      {formatMoney(ledgerAccount.balance, ledgerAccount.currency)}
                    </strong>
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="coa-modal-close"
                onClick={() => setLedgerModalOpen(false)}
              >
                ✕
              </button>
            </div>

            {/* KPI Summary Cards */}
            <div className="coa-ledger-summary-grid">
              <div className="coa-ledger-kpi">
                <div className="kpi-label">Total Debit</div>
                <div className="kpi-val blue">
                  {formatMoney(ledgerSummary?.totalDebit || 0, ledgerAccount.currency)}
                </div>
              </div>
              <div className="coa-ledger-kpi">
                <div className="kpi-label">Total Credit</div>
                <div className="kpi-val purple">
                  {formatMoney(ledgerSummary?.totalCredit || 0, ledgerAccount.currency)}
                </div>
              </div>
              <div className="coa-ledger-kpi">
                <div className="kpi-label">Closing Net Balance</div>
                <div className="kpi-val green">
                  {formatMoney(ledgerSummary?.netBalance || 0, ledgerAccount.currency)}
                </div>
              </div>
              <div className="coa-ledger-kpi">
                <div className="kpi-label">Total Vouchers Posted</div>
                <div className="kpi-val">
                  {ledgerSummary?.entryCount || 0} Lines
                </div>
              </div>
            </div>

            {/* Ledger Controls & Filters */}
            <div className="coa-ledger-controls">
              <div className="coa-ledger-filters">
                <input
                  type="text"
                  placeholder="Filter by voucher no, description, sub-account…"
                  className="coa-search-input"
                  style={{ width: "260px", height: "34px" }}
                  value={ledgerSearch}
                  onChange={(e) => setLedgerSearch(e.target.value)}
                />

                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <label style={{ fontSize: "11px", fontWeight: 600, color: "#64748b" }}>From:</label>
                  <input
                    type="date"
                    className="coa-date-input"
                    value={ledgerStartDate}
                    onChange={(e) => handleDateFilterChange(e.target.value, ledgerEndDate)}
                  />
                  <label style={{ fontSize: "11px", fontWeight: 600, color: "#64748b" }}>To:</label>
                  <input
                    type="date"
                    className="coa-date-input"
                    value={ledgerEndDate}
                    onChange={(e) => handleDateFilterChange(ledgerStartDate, e.target.value)}
                  />
                  {(ledgerStartDate || ledgerEndDate || ledgerSearch) && (
                    <button
                      type="button"
                      className="coa-action-pill"
                      onClick={() => {
                        setLedgerSearch("");
                        handleDateFilterChange("", "");
                      }}
                    >
                      Clear Filters
                    </button>
                  )}
                </div>
              </div>

              {/* Export to Excel */}
              <button
                type="button"
                className="coa-btn coa-btn-success"
                onClick={exportLedgerToExcel}
                title="Download this ledger as Excel / CSV spreadsheet"
              >
                <span>📥</span> Export to Excel
              </button>
            </div>

            {/* Ledger Entries Table */}
            <div className="coa-ledger-table-wrap">
              {ledgerLoading ? (
                <div style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                  Loading General Ledger transactions…
                </div>
              ) : ledgerEntries.length === 0 ? (
                <div style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                  No transaction vouchers posted against this account.
                </div>
              ) : (
                <table className="coa-ledger-table">
                  <thead>
                    <tr>
                      <th>Posting Date</th>
                      <th>Voucher / Doc No</th>
                      <th>Type</th>
                      <th>Reference</th>
                      {ledgerAccount.isGroup && <th>Sub-Account</th>}
                      <th>Particulars / Description</th>
                      <th className="text-right">Debit (PGK)</th>
                      <th className="text-right">Credit (PGK)</th>
                      <th className="text-right">Running Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerEntries
                      .filter(
                        (e) =>
                          !ledgerSearch ||
                          e.voucherNo.toLowerCase().includes(ledgerSearch.toLowerCase()) ||
                          e.voucherType.toLowerCase().includes(ledgerSearch.toLowerCase()) ||
                          e.reference.toLowerCase().includes(ledgerSearch.toLowerCase()) ||
                          e.description.toLowerCase().includes(ledgerSearch.toLowerCase()) ||
                          e.accountCode.toLowerCase().includes(ledgerSearch.toLowerCase()) ||
                          e.accountName.toLowerCase().includes(ledgerSearch.toLowerCase())
                      )
                      .map((entry) => (
                        <tr key={entry.lineId}>
                          <td className="mono" style={{ whiteSpace: "nowrap" }}>
                            {entry.postingDate.slice(0, 10)}
                          </td>
                          <td>
                            <span className="coa-voucher-badge">{entry.voucherNo}</span>
                          </td>
                          <td>
                            <span className={`coa-type-pill ${getVoucherTypePillClass(entry.voucherType)}`}>
                              {entry.voucherType}
                            </span>
                          </td>
                          <td style={{ color: "#64748b", fontSize: "11.5px" }}>
                            {entry.reference || "—"}
                          </td>
                          {ledgerAccount.isGroup && (
                            <td style={{ fontSize: "11.5px", whiteSpace: "nowrap" }}>
                              <strong>{entry.accountCode}</strong> {entry.accountName}
                            </td>
                          )}
                          <td style={{ maxWidth: "280px" }}>{entry.description}</td>
                          <td className="mono text-right" style={{ color: entry.debit > 0 ? "#1e40af" : "#94a3b8" }}>
                            {entry.debit > 0 ? formatMoney(entry.debit, ledgerAccount.currency) : "—"}
                          </td>
                          <td className="mono text-right" style={{ color: entry.credit > 0 ? "#6b21a8" : "#94a3b8" }}>
                            {entry.credit > 0 ? formatMoney(entry.credit, ledgerAccount.currency) : "—"}
                          </td>
                          <td className="mono text-right" style={{ fontWeight: 700, color: "#0f172a" }}>
                            {formatMoney(entry.runningBalance, ledgerAccount.currency)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="coa-modal-footer">
              <span style={{ fontSize: "12px", color: "#64748b" }}>
                Showing <strong>{ledgerEntries.length}</strong> journal transaction lines posted in immutable double-entry ledger.
              </span>
              <button
                type="button"
                className="coa-btn"
                onClick={() => setLedgerModalOpen(false)}
              >
                Close Ledger
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          Chart of Accounts Import Modal (ERPNext Architecture)
          ========================================================================= */}
      {importModalOpen && (
        <div className="coa-import-modal-overlay" onClick={() => !importing && setImportModalOpen(false)}>
          <div className="coa-import-modal" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="coa-modal-header">
              <div className="coa-modal-title-group">
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <h3 className="coa-modal-title">📤 Import Chart of Accounts</h3>
                  <span className="coa-badge-tag" style={{ background: "#e0e7ff", color: "#3730a3" }}>
                    ERPNext Architecture
                  </span>
                </div>
                <p className="coa-modal-subtitle">
                  Upload or paste your Chart of Accounts. Supports automatic two-pass parent hierarchy resolution, account types, and normal balances.
                </p>
              </div>
              <button
                type="button"
                className="coa-close-btn"
                onClick={() => !importing && setImportModalOpen(false)}
                title="Close"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="coa-import-body">
              {/* Template Download Banner */}
              <div className="coa-template-card">
                <div className="coa-template-card-left">
                  <span className="coa-template-card-icon">📄</span>
                  <div>
                    <div className="coa-template-card-title">Download Official Import Template</div>
                    <div className="coa-template-card-desc">
                      Pre-formatted CSV template with authentic Papua New Guinea business account examples (Assets, Liabilities, Equity, Revenue, COGS, Expenses).
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="coa-btn coa-btn-success"
                  onClick={handleDownloadTemplate}
                  title="Download Easynet_COA_Import_Template.csv"
                  style={{ whiteSpace: "nowrap" }}
                >
                  <span>⬇️</span> Download CSV Template
                </button>
              </div>

              {/* Import Mode Tabs */}
              <div className="coa-import-tabs">
                <button
                  type="button"
                  className={`coa-import-tab-btn ${importTab === "file" ? "active" : ""}`}
                  onClick={() => setImportTab("file")}
                >
                  📁 Upload Excel / CSV File
                </button>
                <button
                  type="button"
                  className={`coa-import-tab-btn ${importTab === "paste" ? "active" : ""}`}
                  onClick={() => setImportTab("paste")}
                >
                  📝 Paste CSV / Spreadsheet Text
                </button>
              </div>

              {/* Tab 1: File Upload */}
              {importTab === "file" && (
                <div>
                  {!importFile ? (
                    <div
                      className={`coa-dropzone ${dragActive ? "drag-active" : ""}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragActive(true);
                      }}
                      onDragLeave={() => setDragActive(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragActive(false);
                        const file = e.dataTransfer.files[0];
                        if (file) handleFileChange(file);
                      }}
                      onClick={() => {
                        const input = document.getElementById("coa-file-input");
                        input?.click();
                      }}
                    >
                      <input
                        id="coa-file-input"
                        type="file"
                        accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleFileChange(file);
                        }}
                      />
                      <span className="coa-dropzone-icon">☁️</span>
                      <div className="coa-dropzone-title">Click to browse or drag & drop your Excel (.xlsx, .xls) or CSV file here</div>
                      <div className="coa-dropzone-subtitle">Supports native Excel workbooks and CSV files with automatic parent hierarchy staging</div>
                    </div>
                  ) : (
                    <div className="coa-file-selected">
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span>📊</span>
                        <div>
                          <strong>{importFile.name}</strong>
                          <span style={{ fontSize: "11px", color: "#64748b", marginLeft: "8px" }}>
                            ({(importFile.size / 1024).toFixed(1)} KB)
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="coa-action-pill"
                        onClick={resetImportState}
                        style={{ background: "#fee2e2", color: "#991b1b" }}
                      >
                        Remove / Choose Another
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: Paste CSV */}
              {importTab === "paste" && (
                <div>
                  <textarea
                    className="coa-csv-textarea"
                    placeholder={`"Account Code","Account Name","Account Type","Parent Code","Normal Balance","Currency","Description","Status"\n"1000","Assets","ASSET","","DEBIT","PGK","Economic resources owned by Easynet PNG","Active"\n"1100","Current Assets","ASSET","1000","DEBIT","PGK","Short term liquid resources","Active"\n"1121","BSP - Cheque Account PGK","ASSET","1120","DEBIT","PGK","Main operating account","Active"`}
                    value={importRawText}
                    onChange={(e) => handlePasteChange(e.target.value)}
                  />
                  <span style={{ fontSize: "11px", color: "#64748b", marginTop: "4px", display: "block" }}>
                    Tip: You can copy cells directly from Microsoft Excel or Google Sheets and paste them here.
                  </span>
                </div>
              )}

              {/* Live Preview Section */}
              {importParsedRows.length > 0 && (
                <div className="coa-preview-section">
                  <div className="coa-preview-header">
                    <div className="coa-preview-counts">
                      <span className="coa-count-badge total">Total: {importParsedRows.length} Rows</span>
                      <span className="coa-count-badge valid">
                        Valid: {importParsedRows.filter((r) => r.isValid).length}
                      </span>
                      {importParsedRows.filter((r) => !r.isValid).length > 0 && (
                        <span className="coa-count-badge error">
                          Errors: {importParsedRows.filter((r) => !r.isValid).length}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="coa-action-pill"
                      onClick={resetImportState}
                    >
                      Clear Data
                    </button>
                  </div>

                  <div className="coa-preview-table-wrap">
                    <table className="coa-preview-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Code</th>
                          <th>Account Name</th>
                          <th>Type</th>
                          <th>Staged Parent Account</th>
                          <th>Normal</th>
                          <th>Currency</th>
                          <th>Status</th>
                          <th>Validation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importParsedRows.slice(0, 50).map((row) => (
                          <tr key={row.lineNo} className={!row.isValid ? "row-invalid" : ""}>
                            <td style={{ color: "#94a3b8", fontSize: "11px" }}>{row.lineNo}</td>
                            <td>
                              <strong>{row.code || "—"}</strong>
                            </td>
                            <td>{row.name || "—"}</td>
                            <td>
                              <span className={`coa-badge-type ${getTypeBadgeClass(row.type)}`}>
                                {row.type || "MISSING"}
                              </span>
                            </td>
                            <td>
                              {row.parentStatus === "root" ? (
                                <span className="coa-parent-badge root">● Root Group</span>
                              ) : row.parentStatus === "inferred" ? (
                                <span className="coa-parent-badge inferred" title={`Auto-inferred parent from account code ${row.code}`}>
                                  ↳ {row.resolvedParentCode} {row.resolvedParentName ? `(${row.resolvedParentName})` : ""} <em style={{ fontSize: "10px", opacity: 0.8 }}>(Inferred)</em>
                                </span>
                              ) : (
                                <span className="coa-parent-badge explicit">
                                  ↳ {row.resolvedParentCode} {row.resolvedParentName ? `(${row.resolvedParentName})` : ""}
                                </span>
                              )}
                            </td>
                            <td>{row.normalBalance}</td>
                            <td>{row.currency}</td>
                            <td>{row.status}</td>
                            <td>
                              {row.isValid ? (
                                <span className="coa-status-pill valid">Ready</span>
                              ) : (
                                <span className="coa-status-pill invalid" title={row.error}>
                                  {row.error}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {importParsedRows.length > 50 && (
                    <span style={{ fontSize: "11px", color: "#64748b", textAlign: "right", display: "block" }}>
                      Showing first 50 of {importParsedRows.length} accounts. All will be processed upon import.
                    </span>
                  )}
                </div>
              )}

              {/* Error Banner */}
              {importError && (
                <div className="coa-error-banner" style={{ margin: "0" }}>
                  <span>⚠️</span> {importError}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="coa-modal-footer">
              <button
                type="button"
                className="coa-btn"
                onClick={() => !importing && setImportModalOpen(false)}
                disabled={importing}
              >
                Cancel
              </button>
              <button
                type="button"
                className="coa-btn coa-btn-primary"
                onClick={handleExecuteImport}
                disabled={importing || importParsedRows.length === 0}
                style={{ minWidth: "160px" }}
              >
                {importing ? (
                  <>
                    <span className="coa-spinner" /> Importing…
                  </>
                ) : (
                  <>
                    <span>⚡</span> Confirm & Import ({importParsedRows.length})
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
