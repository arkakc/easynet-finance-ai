"use client";

import { useEffect, useMemo, useState } from "react";

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
  const listId = `account-picker-${name}`;
  const parentIds = useMemo(() => new Set(accounts.map((row) => String(row.parentAccount || "")).filter(Boolean)), [accounts]);
  const options = useMemo(() => accounts.filter((row) => !parentIds.has(String(row.accountId || "")) && matchesKind(row, kind)), [accounts, kind, parentIds]);
  const selected = options.find((row) => String(row.accountId) === String(value)) || accounts.find((row) => String(row.accountId) === String(value));
  const [query, setQuery] = useState(selected ? label(selected) : "");

  useEffect(() => setQuery(selected ? label(selected) : ""), [selected]);

  function choose(nextId: string) {
    onChange(nextId);
    const row = options.find((option) => String(option.accountId) === String(nextId)) || accounts.find((option) => String(option.accountId) === String(nextId));
    setQuery(row ? label(row) : "");
  }

  function search(next: string) {
    setQuery(next);
    const normalized = next.trim().toLowerCase();
    const match = options.find((row) =>
      [row.accountId, row.accountCode, row.accountName, label(row)]
        .filter(Boolean)
        .some((candidate) => String(candidate).toLowerCase() === normalized),
    );
    onChange(match ? String(match.accountId) : "");
  }

  return (
    <div style={{display:"grid",gap:6}}>
      <input
        list={listId}
        value={query}
        onChange={(event) => search(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        aria-label={`${name} manual search`}
      />
      <datalist id={listId}>
        {options.map((row) => <option key={row.accountId} value={label(row)} />)}
      </datalist>
      <select
        name={name}
        value={value}
        onChange={(event) => choose(event.target.value)}
        required={required}
        disabled={disabled}
        aria-label={`${name} dropdown`}
      >
        <option value="">{placeholder.replace(/^Search/i, "Select")}</option>
        {selected && !options.some((row) => String(row.accountId) === String(selected.accountId)) && (
          <option value={String(selected.accountId)}>{label(selected)}</option>
        )}
        {options.map((row) => <option key={row.accountId} value={String(row.accountId)}>{label(row)}</option>)}
      </select>
      <span className="small">Type to search, or use the dropdown list.</span>
    </div>
  );
}
