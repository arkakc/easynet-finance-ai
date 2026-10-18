import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/src/lib/prisma";
import * as XLSX from "xlsx";

const HEADERS = ["Account Code", "Account Name", "Account Type", "Debit (PGK)", "Credit (PGK)"];
const MAX_SIZE = 2 * 1024 * 1024;
const amountInCents = (value: unknown, line: number, column: string, errors: string[]): number => {
  if (value == null || String(value).trim() === "") return 0;
  const raw = String(value).trim().replace(/,/g, "");
  if (!/^(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,2})?$/.test(raw)) {
    errors.push(`Row ${line}: ${column} must be a nonnegative amount with at most 2 decimal places.`);
    return 0;
  }
  const [whole, fractional = ""] = raw.split(".");
  const cents = Number(whole) * 100 + Number(fractional.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) errors.push(`Row ${line}: ${column} exceeds safe amount limit.`);
  return cents;
};

async function postingLedgers() {
  const accounts = await prisma.chartOfAccounts.findMany({
    where: { isActive: true }, include: { children: { select: { id: true } } }, orderBy: { code: "asc" },
  });
  return accounts.filter((row) => row.children.length === 0);
}

export async function GET(request: Request) {
  try {
    await requirePermission("settings.manage");
    const accounts = await postingLedgers();
    const rows = [HEADERS, ...accounts.map((account) => [account.code, account.name, account.type, "", ""])];
    const format = new URL(request.url).searchParams.get("format");
    if (format === "csv") {
      const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
      return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="opening-balances-template.csv"', "Cache-Control": "no-store" } });
    }
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = [{ wch: 16 }, { wch: 48 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(workbook, sheet, "Opening Balances");
    const data = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="opening-balances-template.xlsx"', "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Template generation failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission("settings.manage");
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Select a CSV or Excel file." }, { status: 400 });
    if (file.size > MAX_SIZE) return NextResponse.json({ ok: false, error: "Maximum file size is 2 MB." }, { status: 400 });
    if (!/\\.(csv|xlsx|xls)$/i.test(file.name)) return NextResponse.json({ ok: false, error: "Only CSV, XLSX or XLS files are supported." }, { status: 400 });
    const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer", raw: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error("The workbook contains no sheet.");
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
    const headings = (matrix[0] || []).map((v) => String(v).trim());
    if (HEADERS.some((h, i) => headings[i] !== h)) throw new Error(`Invalid columns. Use the downloaded template: ${HEADERS.join(", ")}.`);
    const validAccounts = new Map((await postingLedgers()).map((account) => [account.code, account]));
    const errors: string[] = [];
    const seen = new Set<string>();
    const entries: Array<{ accountCode: string; label: string; debit: number; credit: number }> = [];
    let debitCents = 0, creditCents = 0;
    for (const [index, cells] of matrix.slice(1).entries()) {
      const row = cells || [];
      if (row.every((value) => !String(value ?? "").trim())) continue;
      const line = index + 2;
      const code = String(row[0] ?? "").trim();
      const account = validAccounts.get(code);
      if (!account) errors.push(`Row ${line}: ${code || "(blank)"} is not an active posting ledger.`);
      if (seen.has(code)) errors.push(`Row ${line}: duplicate account code ${code}.`);
      seen.add(code);
      const debit = amountInCents(row[3], line, "Debit", errors);
      const credit = amountInCents(row[4], line, "Credit", errors);
      if (debit && credit) errors.push(`Row ${line}: enter only debit or credit, not both.`);
      if (!debit && !credit) continue;
      if (account) {
        entries.push({ accountCode: code, label: account.name, debit: debit / 100, credit: credit / 100 });
        debitCents += debit; creditCents += credit;
      }
    }
    if (!entries.length) errors.push("No nonzero opening balances were found. Zero-opening businesses should use the separate confirmation workflow.");
    if (debitCents !== creditCents) errors.push(`Unbalanced opening balances: difference PGK ${((debitCents-creditCents)/100).toFixed(2)}.`);
    if (errors.length) return NextResponse.json({ ok: false, errors: errors.slice(0, 100), totalErrors: errors.length, entries: [], debit: debitCents/100, credit: creditCents/100 }, { status: 422 });
    return NextResponse.json({ ok: true, entries, debit: debitCents/100, credit: creditCents/100, count: entries.length, message: "Validated preview only. Nothing has been posted or saved." });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Opening import failed." }, { status: 400 });
  }
}
