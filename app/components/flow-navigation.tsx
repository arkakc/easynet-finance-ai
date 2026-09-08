"use client";

import { useEffect, useState } from "react";

type CreateTarget = "customer" | "supplier" | "project" | "item";

const CHANGE_KEY = "easynet:flow-data-changed";

function safeInternalPath(value: string) {
  const path = String(value || "").trim();
  if (!path.startsWith("/") || path.startsWith("//")) return "";
  return path;
}

function destination(target: CreateTarget) {
  if (target === "item") return "/stock?mode=newItem";
  return `/masters?tab=${target}`;
}

export function notifyFlowDataChanged(kind: string, id = "") {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify({ kind, id, at: Date.now() });
  try { window.localStorage.setItem(CHANGE_KEY, payload); } catch {}
  window.dispatchEvent(new CustomEvent(CHANGE_KEY, { detail: payload }));
}

export function useFlowDataRefresh(callback: () => void) {
  useEffect(() => {
    const onFocus = () => callback();
    const onStorage = (event: StorageEvent) => { if (event.key === CHANGE_KEY) callback(); };
    const onLocal = () => callback();
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGE_KEY, onLocal as EventListener);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGE_KEY, onLocal as EventListener);
    };
  }, [callback]);
}

export function FlowCreateLink({
  target,
  label,
  returnLabel,
  className = "button-link secondary-link",
}: {
  target: CreateTarget;
  label?: string;
  returnLabel?: string;
  className?: string;
}) {
  const [href, setHref] = useState(destination(target));

  useEffect(() => {
    const current = `${window.location.pathname}${window.location.search}`;
    const base = destination(target);
    const separator = base.includes("?") ? "&" : "?";
    setHref(`${base}${separator}returnTo=${encodeURIComponent(current)}&returnLabel=${encodeURIComponent(returnLabel || document.title || "Previous Flow")}&fromFlow=1`);
  }, [target, returnLabel]);

  const defaultLabel = target === "customer" ? "Create New Customer"
    : target === "supplier" ? "Create New Supplier"
      : target === "project" ? "Create New Project"
        : "Create New Item";

  return <a className={className} href={href} target="_blank" rel="noreferrer">{label || defaultLabel}</a>;
}

export function FlowReturnPanel({ savedLabel = "" }: { savedLabel?: string }) {
  const [returnTo, setReturnTo] = useState("");
  const [returnLabel, setReturnLabel] = useState("Previous Flow");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const path = safeInternalPath(params.get("returnTo") || "");
    if (!path) return;
    setReturnTo(path);
    setReturnLabel(params.get("returnLabel") || "Previous Flow");
  }, []);

  if (!returnTo) return null;

  return <section className="panel no-print" style={{ borderStyle: "dashed" }}>
    <div className="form-title-row">
      <div>
        <h3 style={{ margin: 0 }}>{savedLabel ? `${savedLabel} saved — continue your flow` : "Opened from an active document flow"}</h3>
        <p className="small" style={{ marginTop: 6 }}>The original document tab can stay open while you create this supporting master record. Return to it after saving and its master-data options will refresh automatically.</p>
      </div>
      <a className="button-link" href={returnTo}>← Return to {returnLabel}</a>
    </div>
  </section>;
}
