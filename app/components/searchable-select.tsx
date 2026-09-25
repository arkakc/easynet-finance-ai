"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type SearchableSelectOption = {
  value: string;
  label: string;
  keywords?: string[];
};

export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Search or select...",
  disabled = false,
  required = false,
  name,
  emptyLabel = "No matching records",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  emptyLabel?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => options.find((option) => String(option.value) === String(value)),
    [options, value],
  );
  const [query, setQuery] = useState(selected?.label || "");

  useEffect(() => {
    if (!open) setQuery(selected?.label || "");
  }, [selected, open]);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || selected?.label === query) return options;
    return options.filter((option) => {
      const haystack = [option.label, option.value, ...(option.keywords || [])]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [options, query, selected]);

  function choose(option: SearchableSelectOption) {
    onChange(option.value);
    setQuery(option.label);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className="searchable-select">
      {name && <input type="hidden" name={name} value={value} />}
      <div className={`searchable-select-control${open ? " is-open" : ""}`}>
        <input
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          autoComplete="off"
          onFocus={() => !disabled && setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            onChange("");
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              setQuery(selected?.label || "");
            }
            if (event.key === "Enter" && open && filtered.length === 1) {
              event.preventDefault();
              choose(filtered[0]);
            }
          }}
        />
        <button
          type="button"
          className="searchable-select-toggle"
          aria-label="Open list"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
        >
          ▾
        </button>
      </div>

      {open && !disabled && (
        <div className="searchable-select-menu" role="listbox">
          {filtered.length === 0 ? (
            <div className="searchable-select-empty">{emptyLabel}</div>
          ) : (
            filtered.map((option) => (
              <button
                type="button"
                key={option.value}
                className={`searchable-select-option${option.value === value ? " is-selected" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <span>{option.label}</span>
                {option.value === value && <span aria-hidden="true">✓</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
