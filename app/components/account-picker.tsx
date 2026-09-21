"use client";

import { useEffect, useId, useMemo, useState } from "react";

export type AccountPickerOption = {
  accountId: string;
  accountCode?: string;
  accountName?: string;
  accountType?: string;
  parentAccount?: string;
  balance?: number | string;
  isCashBank?: boolean;
  accountRole?: string;
};

type AccountKind = "all" | "income" | "expense" | "cash-bank";

function money(value: number | string | undefined) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-PG", { style: "currency", currency: "PGK", minimumFractionDigits: 2 }).format(amount);
}

function label(row: AccountPickerOption) {
  const code = row.accountCode || row.accountId;
  const name = row.accountName || row.accountId;
  const type = String(row.accountType || "ACCOUNT").replaceAll("_", " ");
  return `${code} | ${name} | ${type} | Balance: ${money(row.balance)}`;
}

function matchesKind(row: AccountPickerOption, kind: AccountKind) {
  if (kind === "all") return true;
  if (kind === "cash-bank") return row.isCashBank === true || String(row.accountRole || "").toLowerCase() === "cash-bank" || ["ACC-1110", "ACC-1120", "ACC-1121"].includes(String(row.accountId));
  const type = String(row.accountType || "").toLowerCase();
  return kind === "income" ? ["income", "revenue"].includes(type) : ["expense", "cost of goods sold", "cogs"].includes(type);
}

export default function AccountPicker({
  value,
  onChange,
  accounts,
  kind = "all",
  name,
  placeholder = "Search account by code or name",
  required,
  disabled,
}: {
  value: string;
  onChange: (accountId: string) => void;
  accounts: AccountPickerOption[];
  kind?: AccountKind;
  name: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const listId = `${useId().replace(/:/g, "")}-${name}`;
  const parentIds = useMemo(() => new Set(accounts.map((row) => String(row.parentAccount || "")).filter(Boolean)), [accounts]);
  const options = useMemo(() => accounts.filter((row) => !parentIds.has(String(row.accountId || "")) && matchesKind(row, kind)), [accounts, kind, parentIds]);
  const selected = options.find((row) => String(row.accountId) === String(value)) || accounts.find((row) => String(row.accountId) === String(value));
  const [query, setQuery] = useState(selected ? label(selected) : value || "");

  useEffect(() => setQuery(selected ? label(selected) : value || ""), [selected, value]);

  function handleChange(next: string) {
    setQuery(next);
    const normalized = next.trim().toLowerCase();
    const match = options.find((row) => [row.accountId, row.accountCode, label(row), row.accountName].filter(Boolean).some((candidate) => String(candidate).toLowerCase() === normalized));
    onChange(match ? String(match.accountId) : next.trim());
  }

  return <>
    <input list={listId} value={query} onChange={(event) => handleChange(event.target.value)} placeholder={placeholder} required={required} disabled={disabled} autoComplete="off" aria-label={`${name} search`} />
    <input type="hidden" name={name} value={value} />
    <datalist id={listId}>{options.map((row) => <option key={row.accountId} value={label(row)}>{label(row)}</option>)}</datalist>
  </>;
}
