import { NextRequest, NextResponse } from "next/server";
import { requirePermission, getRequestUser, hasPermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { AccountTypeGL, NormalBalance } from "@prisma/client";
import * as XLSX from "xlsx";
import { inferParentCode } from "@/app/api/ui/accounts/rebuild-tree/route";

async function checkAuth(req: Request, permission: "accounts.read" | "accounts.write") {
  try {
    const user = getRequestUser(req);
    if (user && hasPermission(user, permission)) {
      return user;
    }
  } catch {}
  try {
    return await requirePermission(permission);
  } catch (err) {
    throw err;
  }
}

/**
 * Standard CSV Header format
 */
const CSV_HEADERS = [
  "Account Code",
  "Account Name",
  "Account Type",
  "Parent Code",
  "Normal Balance",
  "Currency",
  "Description",
  "Status",
];

/**
 * Sample accounts tailored for Easynet IT Solutions Limited (PNG)
 */
const SAMPLE_IMPORT_ROWS = [
  // 1000 - ASSETS
  ["1000", "Assets", "ASSET", "", "DEBIT", "PGK", "Economic resources owned by Easynet PNG", "Active"],
  ["1100", "Current Assets", "ASSET", "1000", "DEBIT", "PGK", "Short term liquid resources", "Active"],
  ["1110", "Cash and Cash Equivalents", "ASSET", "1100", "DEBIT", "PGK", "Cash on hand and liquid balances", "Active"],
  ["1111", "Petty Cash - Head Office POM", "ASSET", "1110", "DEBIT", "PGK", "Petty cash for office operations", "Active"],
  ["1120", "Bank Accounts", "ASSET", "1100", "DEBIT", "PGK", "Operating corporate bank accounts", "Active"],
  ["1121", "BSP - Cheque Account PGK", "ASSET", "1120", "DEBIT", "PGK", "Bank South Pacific corporate account", "Active"],
  ["1122", "Kina Bank - Project Escrow", "ASSET", "1120", "DEBIT", "PGK", "Kina Bank client project escrow", "Active"],
  ["1130", "Accounts Receivable", "ASSET", "1100", "DEBIT", "PGK", "Trade receivables from billing", "Active"],
  ["1131", "Trade Debtors - Enterprise Clients", "ASSET", "1130", "DEBIT", "PGK", "Enterprise IT contract receivables", "Active"],
  ["1140", "Inventories & Hardware Stock", "ASSET", "1100", "DEBIT", "PGK", "Hardware and materials inventory", "Active"],
  ["1141", "Starlink Terminals Stock", "ASSET", "1140", "DEBIT", "PGK", "Starlink kits and accessories stock", "Active"],
  ["1142", "Cisco & Ubiquiti Network Gear", "ASSET", "1140", "DEBIT", "PGK", "Routers switches and access points", "Active"],
  ["1200", "Non-Current Assets", "ASSET", "1000", "DEBIT", "PGK", "Long term physical and technical assets", "Active"],
  ["1210", "IT Infrastructure & Servers", "ASSET", "1200", "DEBIT", "PGK", "Data center servers and storage", "Active"],
  ["1220", "Network Test Equipment", "ASSET", "1200", "DEBIT", "PGK", "Fluke fiber testers and OTDR tools", "Active"],

  // 2000 - LIABILITIES
  ["2000", "Liabilities", "LIABILITY", "", "CREDIT", "PGK", "Financial obligations and debts", "Active"],
  ["2100", "Current Liabilities", "LIABILITY", "2000", "CREDIT", "PGK", "Short term liabilities due within 1 year", "Active"],
  ["2110", "Accounts Payable", "LIABILITY", "2100", "CREDIT", "PGK", "Trade payables to suppliers", "Active"],
  ["2111", "Trade Creditors - IT Hardware Vendors", "LIABILITY", "2110", "CREDIT", "PGK", "Hardware and equipment suppliers", "Active"],
  ["2120", "Statutory & Tax Liabilities (IRC PNG)", "LIABILITY", "2100", "CREDIT", "PGK", "Internal Revenue Commission PNG obligations", "Active"],
  ["2121", "Goods & Services Tax (GST 10%) Payable", "LIABILITY", "2120", "CREDIT", "PGK", "GST collected on taxable supplies", "Active"],
  ["2122", "Salary & Wages Tax (SWT) Payable", "LIABILITY", "2120", "CREDIT", "PGK", "Employee tax withheld for IRC", "Active"],
  ["2130", "Employee Superannuation (Nasfund)", "LIABILITY", "2100", "CREDIT", "PGK", "Employer and employee superannuation", "Active"],

  // 3000 - EQUITY
  ["3000", "Equity", "EQUITY", "", "CREDIT", "PGK", "Shareholders equity and retained earnings", "Active"],
  ["3100", "Share Capital", "EQUITY", "3000", "CREDIT", "PGK", "Issued and paid-up ordinary share capital", "Active"],
  ["3200", "Retained Earnings", "EQUITY", "3000", "CREDIT", "PGK", "Accumulated profits retained in business", "Active"],

  // 4000 - REVENUE
  ["4000", "Revenue", "REVENUE", "", "CREDIT", "PGK", "Operating turnover from IT services and sales", "Active"],
  ["4100", "Managed IT & Support Services", "REVENUE", "4000", "CREDIT", "PGK", "Monthly SLA and managed services", "Active"],
  ["4200", "Satellite Internet & Starlink Deployments", "REVENUE", "4000", "CREDIT", "PGK", "Starlink installation and site commissioning", "Active"],
  ["4300", "Cybersecurity & Network Auditing", "REVENUE", "4000", "CREDIT", "PGK", "Security posture reviews and firewall configuration", "Active"],

  // 5000 - COST OF GOODS SOLD
  ["5000", "Cost of Goods Sold (COGS)", "EXPENSE", "", "DEBIT", "PGK", "Direct costs of hardware and service delivery", "Active"],
  ["5100", "Hardware & Equipment Cost", "EXPENSE", "5000", "DEBIT", "PGK", "Cost of Starlink kits servers and network hardware", "Active"],
  ["5200", "Direct Subcontractors & Regional Travel", "EXPENSE", "5000", "DEBIT", "PGK", "Direct site engineering travel and regional flights", "Active"],

  // 6000 - OPERATING EXPENSES
  ["6000", "Operating Expenses", "EXPENSE", "", "DEBIT", "PGK", "General selling and administrative expenses", "Active"],
  ["6100", "Salaries & Employee Benefits", "EXPENSE", "6000", "DEBIT", "PGK", "Base staff payroll and medical benefits", "Active"],
  ["6200", "Office Rent & Utilities", "EXPENSE", "6000", "DEBIT", "PGK", "Office premises and power/water utilities", "Active"],
  ["6300", "Software Licenses & Cloud Subscriptions", "EXPENSE", "6000", "DEBIT", "PGK", "Microsoft 365 AWS Google Cloud SaaS", "Active"],
];

/**
 * GET: Download official Chart of Accounts Import Template (CSV or Excel)
 */
export async function GET(req: NextRequest) {
  try {
    await checkAuth(req, "accounts.read");

    const { searchParams } = new URL(req.url);
    const format = (searchParams.get("format") || "csv").toLowerCase();

    if (format === "xlsx" || format === "excel") {
      const worksheetData = [CSV_HEADERS, ...SAMPLE_IMPORT_ROWS];
      const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Chart of Accounts");
      const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });

      return new NextResponse(excelBuffer, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": 'attachment; filename="Easynet_COA_Import_Template.xlsx"',
          "Cache-Control": "no-store",
        },
      });
    }

    const lines: string[] = [];
    // Header
    lines.push(CSV_HEADERS.map((h) => `"${h}"`).join(","));

    // Sample rows
    SAMPLE_IMPORT_ROWS.forEach((row) => {
      lines.push(
        row
          .map((cell) => {
            const escaped = String(cell || "").replace(/"/g, '""');
            return `"${escaped}"`;
          })
          .join(",")
      );
    });

    const csvContent = "\uFEFF" + lines.join("\r\n");

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="Easynet_COA_Import_Template.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate template";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 }
    );
  }
}

/**
 * Smart delimiter-aware CSV/TSV parser supporting quotes, commas, tabs, and semicolons
 */
export function parseDelimitedText(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "").trim();
  if (!clean) return [];

  // Determine delimiter: tab vs comma vs semicolon
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

  const rows: string[][] = [];
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
          i++; // skip escaped quote
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
        if (char === "\r" && nextChar === "\n") {
          i++;
        }
        currentRow.push(currentVal.trim());
        if (currentRow.some((c) => c.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentVal = "";
      } else {
        currentVal += char;
      }
    }
  }

  if (currentVal.length > 0 || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some((c) => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

export type ParsedAccountRow = {
  lineNo: number;
  code: string;
  name: string;
  type: AccountTypeGL;
  rawParent: string;
  normalBalance: NormalBalance;
  currency: string;
  description: string;
  isActive: boolean;
};

export const VALID_TYPES: Record<string, AccountTypeGL> = {
  ASSET: AccountTypeGL.ASSET,
  ASSETS: AccountTypeGL.ASSET,
  LIABILITY: AccountTypeGL.LIABILITY,
  LIABILITIES: AccountTypeGL.LIABILITY,
  EQUITY: AccountTypeGL.EQUITY,
  REVENUE: AccountTypeGL.REVENUE,
  INCOME: AccountTypeGL.REVENUE,
  EXPENSE: AccountTypeGL.EXPENSE,
  EXPENSES: AccountTypeGL.EXPENSE,
  CONTRA_ASSET: AccountTypeGL.CONTRA_ASSET,
  CONTRA_LIABILITY: AccountTypeGL.CONTRA_LIABILITY,
};

/**
 * Intelligent Header Normalizer:
 * Critical ERP feature: Detects Parent Account headers FIRST before matching
 * generic "name" or "code" to prevent "Parent Name" or "Parent Account" from
 * colliding with the account's own name or code.
 */
export function normalizeHeaderKey(key: string): string {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Parent / Hierarchy fields (MUST BE FIRST)
  if (
    k.includes("parent") ||
    k.includes("subaccount") ||
    k.includes("subacc") ||
    k.includes("reportsto") ||
    k.includes("under") ||
    k.includes("headeraccount") ||
    (k.includes("group") && !k.includes("usergroup"))
  ) {
    return "parent";
  }

  // Account Code fields
  if (k.includes("code") || k.includes("number") || k.includes("acctno") || k.includes("accountno")) {
    return "code";
  }

  // Account Name fields
  if (k.includes("name") || k.includes("title")) {
    return "name";
  }

  // Account Type / Category
  if (k.includes("type") || k.includes("class") || k.includes("category")) {
    return "type";
  }

  // Normal Balance
  if (k.includes("balance") || k.includes("normal") || k.includes("drcr")) {
    return "normalBalance";
  }

  // Currency
  if (k.includes("curr")) {
    return "currency";
  }

  // Description / Notes
  if (k.includes("desc") || k.includes("note") || k.includes("memo")) {
    return "description";
  }

  // Status / Active
  if (k.includes("stat") || k.includes("active") || k.includes("enable")) {
    return "status";
  }

  return k;
}

/**
 * POST: Bulk Import Chart of Accounts
 * Supports .xlsx, .xls, .csv, tab-delimited paste, and structured JSON rows.
 * Features automated multi-way parent resolution (Code, Name, Code-Name, Hierarchy inference).
 */
export async function POST(req: NextRequest) {
  try {
    await checkAuth(req, "accounts.write");

    let rawRows: any[] = [];
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string") {
        return NextResponse.json({ ok: false, error: "No file provided in form data" }, { status: 400 });
      }

      const fileObj = file as File;
      const fileName = fileObj.name ? fileObj.name.toLowerCase() : "";

      // Check if uploaded file is an Excel spreadsheet (.xlsx, .xls)
      if (
        fileName.endsWith(".xlsx") ||
        fileName.endsWith(".xls") ||
        fileObj.type.includes("sheet") ||
        fileObj.type.includes("excel")
      ) {
        const arrayBuffer = await fileObj.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const workbook = XLSX.read(buffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          return NextResponse.json({ ok: false, error: "The Excel workbook has no sheets." }, { status: 400 });
        }
        const worksheet = workbook.Sheets[sheetName];
        rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: "" });
      } else {
        const text = await fileObj.text();
        rawRows = parseDelimitedText(text);
      }
    } else {
      const body = await req.json();

      if (Array.isArray(body.rows)) {
        rawRows = body.rows;
      } else if (typeof body.csvText === "string") {
        rawRows = parseDelimitedText(body.csvText);
      } else if (typeof body.excelBase64 === "string") {
        const buffer = Buffer.from(body.excelBase64, "base64");
        const workbook = XLSX.read(buffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: "" });
      } else {
        return NextResponse.json(
          { ok: false, error: "Invalid payload. Provide 'rows', 'csvText', or upload a file." },
          { status: 400 }
        );
      }
    }

    if (!rawRows || rawRows.length === 0) {
      return NextResponse.json({ ok: false, error: "The import data is empty." }, { status: 400 });
    }

    // Convert raw rows to normalized ParsedAccountRow objects
    const accountRows: ParsedAccountRow[] = [];
    const validationErrors: string[] = [];
    const warnings: string[] = [];

    // Check if rawRows is a 2D array (e.g. from CSV or Excel sheet)
    if (Array.isArray(rawRows[0])) {
      // Find header row: look for row containing code, name, or type
      const headerRowIndex = rawRows.findIndex((row: string[]) =>
        Array.isArray(row) &&
        row.some((cell) => {
          const c = String(cell || "").toLowerCase();
          return c.includes("code") || c.includes("name") || c.includes("type") || c.includes("acct");
        })
      );

      if (headerRowIndex === -1) {
        return NextResponse.json(
          {
            ok: false,
            error: "Could not find a valid header row. Please include 'Account Code', 'Account Name', 'Account Type'.",
          },
          { status: 400 }
        );
      }

      const rawHeaders: string[] = rawRows[headerRowIndex];
      const headerKeys = rawHeaders.map((h) => normalizeHeaderKey(String(h || "")));

      for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
        const row: any[] = rawRows[i];
        if (!row || !Array.isArray(row) || row.every((c) => !c || String(c).trim() === "")) continue;

        const record: Record<string, string> = {};
        headerKeys.forEach((key, idx) => {
          record[key] = String(row[idx] ?? "").trim();
        });

        const lineNo = i + 1;
        // Clean code: remove quotes, strip .0 from Excel float numbers
        const code = (record["code"] || "").replace(/^['"]+|['"]+$/g, "").replace(/\.0$/, "").trim();
        const name = (record["name"] || "").trim();
        const rawType = (record["type"] || "").toUpperCase().replace(/\s+/g, "_");
        const rawParent = (record["parent"] || record["parentCode"] || record["parentAccount"] || "").trim();
        const rawBalance = (record["normalBalance"] || "").toUpperCase();
        const currency = (record["currency"] || "PGK").toUpperCase();
        const description = record["description"] || "";
        const rawStatus = (record["status"] || "").toLowerCase();

        if (!code) {
          validationErrors.push(`Row ${lineNo}: Missing Account Code.`);
          continue;
        }

        if (!name) {
          validationErrors.push(`Row ${lineNo} (Code: ${code}): Missing Account Name.`);
          continue;
        }

        const resolvedType = VALID_TYPES[rawType];
        if (!resolvedType) {
          validationErrors.push(
            `Row ${lineNo} (Code: ${code}): Invalid Account Type '${record["type"]}'. Valid types: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE, CONTRA_ASSET, CONTRA_LIABILITY.`
          );
          continue;
        }

        let normalBal: NormalBalance;
        if (rawBalance === "CREDIT" || rawBalance === "CR") {
          normalBal = NormalBalance.CREDIT;
        } else if (rawBalance === "DEBIT" || rawBalance === "DR") {
          normalBal = NormalBalance.DEBIT;
        } else {
          if (
            resolvedType === AccountTypeGL.LIABILITY ||
            resolvedType === AccountTypeGL.EQUITY ||
            resolvedType === AccountTypeGL.REVENUE ||
            resolvedType === AccountTypeGL.CONTRA_ASSET
          ) {
            normalBal = NormalBalance.CREDIT;
          } else {
            normalBal = NormalBalance.DEBIT;
          }
        }

        const isActive = !["inactive", "false", "0", "no", "disabled"].includes(rawStatus);

        accountRows.push({
          lineNo,
          code,
          name,
          type: resolvedType,
          rawParent,
          normalBalance: normalBal,
          currency: currency || "PGK",
          description,
          isActive,
        });
      }
    } else {
      // Structured objects passed directly
      for (let i = 0; i < rawRows.length; i++) {
        const item = rawRows[i];
        const lineNo = item.lineNo || i + 1;
        const code = String(item.code || item.accountCode || item.accountNumber || "")
          .replace(/^['"]+|['"]+$/g, "")
          .replace(/\.0$/, "")
          .trim();
        const name = String(item.name || item.accountName || item.title || "").trim();
        const rawType = String(item.type || item.accountType || item.category || "")
          .toUpperCase()
          .replace(/\s+/g, "_");
        const rawParent = String(
          item.parent || item.parentCode || item.parentAccount || item.parentName || item.rawParent || ""
        ).trim();
        const rawBalance = String(item.normalBalance || item.balanceType || "").toUpperCase();
        const currency = String(item.currency || "PGK").toUpperCase();
        const description = String(item.description || item.notes || "").trim();
        const rawStatus = String(item.active ?? item.status ?? item.isActive ?? "true").toLowerCase();

        if (!code) {
          validationErrors.push(`Row ${lineNo}: Missing Account Code.`);
          continue;
        }
        if (!name) {
          validationErrors.push(`Row ${lineNo} (Code: ${code}): Missing Account Name.`);
          continue;
        }

        const resolvedType = VALID_TYPES[rawType];
        if (!resolvedType) {
          validationErrors.push(`Row ${lineNo} (Code: ${code}): Invalid Account Type '${rawType}'.`);
          continue;
        }

        let normalBal: NormalBalance;
        if (rawBalance === "CREDIT" || rawBalance === "CR") {
          normalBal = NormalBalance.CREDIT;
        } else if (rawBalance === "DEBIT" || rawBalance === "DR") {
          normalBal = NormalBalance.DEBIT;
        } else {
          if (
            resolvedType === AccountTypeGL.LIABILITY ||
            resolvedType === AccountTypeGL.EQUITY ||
            resolvedType === AccountTypeGL.REVENUE ||
            resolvedType === AccountTypeGL.CONTRA_ASSET
          ) {
            normalBal = NormalBalance.CREDIT;
          } else {
            normalBal = NormalBalance.DEBIT;
          }
        }

        const isActive = !["inactive", "false", "0", "no", "disabled"].includes(rawStatus);

        accountRows.push({
          lineNo,
          code,
          name,
          type: resolvedType,
          rawParent,
          normalBalance: normalBal,
          currency: currency || "PGK",
          description,
          isActive,
        });
      }
    }

    if (validationErrors.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Validation failed with ${validationErrors.length} error(s). Please review your spreadsheet.`,
          errors: validationErrors.slice(0, 50),
        },
        { status: 400 }
      );
    }

    if (accountRows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid account rows found in the import file." },
        { status: 400 }
      );
    }

    // =========================================================================
    // Two-pass Upsert Strategy (ERPNext Architecture):
    // Pass 1: Upsert all accounts (creates or updates accounts without parent links)
    // Pass 2: Connect parent-child relationships using multi-way resolution & code inference
    // =========================================================================
    let createdCount = 0;
    let updatedCount = 0;

    const codeToIdMap = new Map<string, string>();
    const nameToIdMap = new Map<string, string>();
    const cleanNameToIdMap = new Map<string, string>();
    const allKnownCodes = new Set<string>();

    // Load existing accounts into lookup maps
    const existingAccounts = await prisma.chartOfAccounts.findMany({
      select: { id: true, code: true, name: true },
    });
    existingAccounts.forEach((acc) => {
      codeToIdMap.set(acc.code, acc.id);
      nameToIdMap.set(acc.name.toLowerCase().trim(), acc.id);
      cleanNameToIdMap.set(acc.name.toLowerCase().replace(/[^a-z0-9]/g, ""), acc.id);
      allKnownCodes.add(acc.code);
    });

    // Also register newly imported codes into allKnownCodes so parent inference can see them
    accountRows.forEach((r) => {
      allKnownCodes.add(r.code);
    });

    // Pass 1: Upsert accounts
    for (const row of accountRows) {
      const existingId = codeToIdMap.get(row.code);

      if (existingId) {
        const updated = await prisma.chartOfAccounts.update({
          where: { id: existingId },
          data: {
            name: row.name,
            type: row.type,
            normalBalance: row.normalBalance,
            currency: row.currency,
            description: row.description || null,
            isActive: row.isActive,
          },
        });
        codeToIdMap.set(updated.code, updated.id);
        nameToIdMap.set(updated.name.toLowerCase().trim(), updated.id);
        cleanNameToIdMap.set(updated.name.toLowerCase().replace(/[^a-z0-9]/g, ""), updated.id);
        updatedCount++;
      } else {
        const created = await prisma.chartOfAccounts.create({
          data: {
            code: row.code,
            name: row.name,
            type: row.type,
            normalBalance: row.normalBalance,
            currency: row.currency,
            description: row.description || null,
            isActive: row.isActive,
            isSystem: false,
          },
        });
        codeToIdMap.set(created.code, created.id);
        nameToIdMap.set(created.name.toLowerCase().trim(), created.id);
        cleanNameToIdMap.set(created.name.toLowerCase().replace(/[^a-z0-9]/g, ""), created.id);
        allKnownCodes.add(created.code);
        createdCount++;
      }
    }

    // Pass 2: Connect parent-child hierarchies
    let parentLinksUpdated = 0;
    let rootAccountsCount = 0;

    for (const row of accountRows) {
      const accountId = codeToIdMap.get(row.code);
      if (!accountId) continue;

      let resolvedParentId: string | null = null;
      const raw = row.rawParent.trim().replace(/^['"]+|['"]+$/g, "");
      const isExplicitRoot = ["none", "root", "-", "0", "null", "n/a", "no parent", "top", "main"].includes(
        raw.toLowerCase()
      );

      // Method 1: If raw parent string was provided and is not a root marker
      if (raw && !isExplicitRoot) {
        const cleanRaw = raw.replace(/\.0$/, ""); // strip Excel float notation

        // 1a. Match by exact code
        if (codeToIdMap.has(cleanRaw)) {
          resolvedParentId = codeToIdMap.get(cleanRaw)!;
        }

        // 1b. Match by code extracted from combined string (e.g. "1100 - Current Assets", "1100 — Current Assets")
        if (!resolvedParentId) {
          const codeMatch = cleanRaw.match(/^([A-Za-z0-9_-]+)[\s—:–-]+/);
          if (codeMatch) {
            const extractedCode = codeMatch[1].replace(/\.0$/, "");
            if (codeToIdMap.has(extractedCode)) {
              resolvedParentId = codeToIdMap.get(extractedCode)!;
            }
          }
        }

        // 1c. Match by exact name (case-insensitive)
        if (!resolvedParentId) {
          const lowerName = cleanRaw.toLowerCase();
          if (nameToIdMap.has(lowerName)) {
            resolvedParentId = nameToIdMap.get(lowerName)!;
          }
        }

        // 1d. Match by normalized alphanumeric name
        if (!resolvedParentId) {
          const alphaName = cleanRaw.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (cleanNameToIdMap.has(alphaName)) {
            resolvedParentId = cleanNameToIdMap.get(alphaName)!;
          }
        }
      }

      // Method 2: If no parent resolved yet, check if hierarchical code inference applies
      if (!resolvedParentId && !isExplicitRoot) {
        const inferredParentCode = inferParentCode(row.code, allKnownCodes);
        if (inferredParentCode && codeToIdMap.has(inferredParentCode)) {
          resolvedParentId = codeToIdMap.get(inferredParentCode)!;
        }
      }

      // Cycle and self-parent prevention
      if (resolvedParentId) {
        if (resolvedParentId === accountId) {
          warnings.push(`Account ${row.code} cannot be its own parent; set to root.`);
          resolvedParentId = null;
        }
      }

      // Update parent link
      if (resolvedParentId) {
        await prisma.chartOfAccounts.update({
          where: { id: accountId },
          data: { parentId: resolvedParentId },
        });
        parentLinksUpdated++;
      } else {
        await prisma.chartOfAccounts.update({
          where: { id: accountId },
          data: { parentId: null },
        });
        rootAccountsCount++;
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Successfully imported ${accountRows.length} accounts: ${createdCount} created, ${updatedCount} updated, ${parentLinksUpdated} hierarchy links resolved (${rootAccountsCount} root groups).`,
      totalProcessed: accountRows.length,
      createdCount,
      updatedCount,
      parentLinksUpdated,
      rootAccountsCount,
      warnings,
    });
  } catch (error) {
    console.error("COA Import Error:", error);
    const message = error instanceof Error ? error.message : "Failed to import Chart of Accounts";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500 }
    );
  }
}
