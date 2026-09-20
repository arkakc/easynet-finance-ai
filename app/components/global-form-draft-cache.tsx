"use client";

import { useEffect, useState } from "react";

type DraftFieldValue = string | boolean;
type DraftPayload = {
  updatedAt: string;
  fields: Record<string, DraftFieldValue>;
};

const STORAGE_PREFIX = "easynet:form-draft:v1:";
const FIELD_SELECTOR = "input, textarea, select";
const RESTORE_DELAYS = [0, 120, 600];

function isDraftableField(element: Element): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return false;
  if (element.disabled) return false;
  if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.readOnly) return false;
  if (element.closest("[data-draft-cache='off'], [data-local-draft='off']")) return false;
  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    if (["button", "submit", "reset", "file", "hidden", "password", "image"].includes(type)) return false;
  }
  return true;
}

function pageKey() {
  return `${window.location.pathname}${window.location.search}`;
}

function textKey(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function formKey(form: HTMLFormElement, index: number) {
  const explicit = form.dataset.draftKey || form.id || form.getAttribute("aria-label");
  const heading = form.querySelector("h1,h2,h3,.form-title")?.textContent;
  return `${STORAGE_PREFIX}${pageKey()}:${index}:${textKey(explicit || heading || "form")}`;
}

function fieldKey(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, index: number) {
  const explicit = field.name || field.id || field.getAttribute("aria-label") || field.getAttribute("placeholder");
  return explicit ? textKey(explicit) : `field-${index}`;
}

function fieldValue(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): DraftFieldValue {
  if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) return field.checked;
  return field.value;
}

function applyFieldValue(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: DraftFieldValue) {
  if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) {
    field.checked = Boolean(value);
  } else {
    const nextValue = String(value ?? "");
    if (field instanceof HTMLSelectElement && nextValue && !Array.from(field.options).some((option) => option.value === nextValue)) return;
    field.value = nextValue;
  }
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function readPayload(key: string): DraftPayload | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftPayload;
    return parsed && typeof parsed === "object" && parsed.fields ? parsed : null;
  } catch {
    return null;
  }
}

function writePayload(key: string, payload: DraftPayload) {
  try {
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // localStorage may be unavailable in private/locked-down browsers.
  }
}

function removePayload(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage errors.
  }
}

function collectForms() {
  return Array.from(document.querySelectorAll("form")).filter((form): form is HTMLFormElement => (
    form instanceof HTMLFormElement && !form.matches("[data-draft-cache='off'], [data-local-draft='off']")
  ));
}

function saveForm(form: HTMLFormElement, index: number) {
  const fields = Array.from(form.querySelectorAll(FIELD_SELECTOR)).filter(isDraftableField);
  const values: Record<string, DraftFieldValue> = {};
  fields.forEach((field, fieldIndex) => {
    values[fieldKey(field, fieldIndex)] = fieldValue(field);
  });
  const hasUserValue = Object.values(values).some((value) => typeof value === "boolean" ? value : value.trim().length > 0);
  const key = formKey(form, index);
  if (!hasUserValue) {
    removePayload(key);
    return;
  }
  writePayload(key, { updatedAt: new Date().toISOString(), fields: values });
}

function restoreForm(form: HTMLFormElement, index: number) {
  const payload = readPayload(formKey(form, index));
  if (!payload) return false;
  const fields = Array.from(form.querySelectorAll(FIELD_SELECTOR)).filter(isDraftableField);
  let restored = false;
  fields.forEach((field, fieldIndex) => {
    const key = fieldKey(field, fieldIndex);
    if (!(key in payload.fields)) return;
    applyFieldValue(field, payload.fields[key]);
    restored = true;
  });
  return restored;
}

export default function GlobalFormDraftCache() {
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let saveTimer: number | null = null;
    const restoreAll = () => {
      const restored = collectForms().some((form, index) => restoreForm(form, index));
      if (restored) {
        setNotice("Local draft restored");
        window.setTimeout(() => setNotice(""), 2600);
      }
    };
    const scheduleSave = () => {
      if (saveTimer) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        collectForms().forEach(saveForm);
      }, 250);
    };
    const saveNow = () => {
      collectForms().forEach(saveForm);
    };
    const clearCurrentPageDrafts = () => {
      collectForms().forEach((form, index) => removePayload(formKey(form, index)));
      setNotice("");
    };

    RESTORE_DELAYS.forEach((delay) => window.setTimeout(restoreAll, delay));
    document.addEventListener("input", scheduleSave, true);
    document.addEventListener("change", scheduleSave, true);
    window.addEventListener("beforeunload", saveNow);
    window.addEventListener("easynet:clear-form-drafts", clearCurrentPageDrafts);

    return () => {
      if (saveTimer) window.clearTimeout(saveTimer);
      saveNow();
      document.removeEventListener("input", scheduleSave, true);
      document.removeEventListener("change", scheduleSave, true);
      window.removeEventListener("beforeunload", saveNow);
      window.removeEventListener("easynet:clear-form-drafts", clearCurrentPageDrafts);
    };
  }, []);

  if (!notice) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        right: 18,
        bottom: 18,
        zIndex: 1000,
        border: "1px solid #bfdbfe",
        borderRadius: 999,
        background: "#eff6ff",
        color: "#1e3a8a",
        padding: "8px 14px",
        boxShadow: "0 10px 24px rgba(15, 23, 42, 0.16)",
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      {notice}
    </div>
  );
}
