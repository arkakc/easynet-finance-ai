/**
 * Navigation guard for hrefs assembled from server-side document relationships.
 * Only known internal ERP detail routes are clickable. Relative URLs, external
 * origins, protocol-relative URLs, fragments and control characters are rejected.
 */
const DETAIL = [
  /^\/transactions\/(?:quote|invoice|purchaseOrder|supplierBill|payment|expense|deliveryNote|purchaseReceipt)\/[^/?#]+$/,
  /^\/journals\/[^/?#]+$/,
  /^\/stock\/movement\/[^/?#]+$/,
  /^\/customers\/[^/?#]+$/,
  /^\/suppliers\/[^/?#]+$/,
  /^\/projects\/master\/[^/?#]+$/,
  /^\/stock\/item\/[^/?#]+$/,
];
export function safeDocumentHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const href = value.trim();
  if (!href || href.length > 600 || /[\\\u0000-\u001f\u007f]/.test(href) || href.includes("//") || href.includes("..")) return null;
  return DETAIL.some(pattern => pattern.test(href)) ? href : null;
}
export function dedupeDocumentLinks<T extends { href?: unknown; id?: unknown; number?: unknown }>(links: readonly T[]): T[] {
  const seen = new Set<string>();
  return links.filter(row => {
    const href = safeDocumentHref(row.href);
    if (!href || !String(row.id || "").trim() || !String(row.number || "").trim() || seen.has(href)) return false;
    seen.add(href);
    return true;
  });
}
