"use client";

import { useEffect, useRef, useState } from "react";

/** Suppress stale-page flashes while an internal Next navigation commits. */
export default function NavigationTransitionGuard() {
  const [pending, setPending] = useState(false);
  const destination = useRef("");
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const element = event.target;
      if (!(element instanceof Element)) return;
      const anchor = element.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      const next = new URL(anchor.href, window.location.href);
      if (next.origin !== window.location.origin || !["http:", "https:"].includes(next.protocol)) return;
      if (next.pathname + next.search === window.location.pathname + window.location.search) return;
      destination.current = next.pathname + next.search;
      setPending(true);
    };
    const onReady = () => {
      destination.current = "";
      setPending(false);
    };
    // A failed navigation must never leave the UI inaccessible.
    const onError = () => { destination.current = ""; setPending(false); };
    document.addEventListener("click", onClick, true);
    window.addEventListener("ef:route-ready", onReady);
    window.addEventListener("popstate", onError);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("ef:route-ready", onReady);
      window.removeEventListener("popstate", onError);
    };
  }, []);
  useEffect(() => {
    if (!pending) return;
    const timeout = window.setTimeout(() => setPending(false), 12000);
    return () => window.clearTimeout(timeout);
  }, [pending, destination.current]);
  if (!pending) return null;
  return <div className="ef-navigation-pending ef-navigation-global" role="status" aria-live="polite"><span className="ef-navigation-spinner" aria-hidden="true" /><span>Loading page…</span></div>;
}
