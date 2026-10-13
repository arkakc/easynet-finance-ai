import Link from "next/link";
import { safeDocumentHref, dedupeDocumentLinks } from "@/lib/documents/safe-document-links";

type ChainLink = { direction?: string; label?: string; stage?: number; id?: string; number?: string; href?: string; type?: string };
type RecordView = { journalId?: unknown; customerId?: unknown; supplierId?: unknown; projectId?: unknown; againstDocumentId?: unknown; againstDocumentType?: unknown; sourceDocumentId?: unknown; partyType?: unknown };
export default function DocumentCrossModuleLinks({ record, links, type, documentId }: { record: RecordView; links: ChainLink[]; type: string; documentId: string }) {
  const found = dedupeDocumentLinks(links);
  const verified = (href: string) => safeDocumentHref(href);
  const targets: Array<{ label: string; href: string }> = [];
  const add = (label: string, prefix: string, raw: unknown) => {
    const id = String(raw || "").trim();
    if (!id) return;
    const href = verified(prefix + encodeURIComponent(id));
    if (href && !targets.some(target => target.href === href)) targets.push({ label, href });
  };
  add("Journal Entry", "/journals/", record.journalId);
  add("Customer", "/customers/", record.customerId);
  add("Supplier", "/suppliers/", record.supplierId);
  add("Project", "/projects/master/", record.projectId);
  if (type === "payment") {
    const side = String(record.partyType || "").toLowerCase();
    const documentType = String(record.againstDocumentType || "").toLowerCase();
    if (side === "customer" || documentType.includes("invoice")) add("Settled Sales Invoice", "/transactions/invoice/", record.againstDocumentId);
    else if (side === "supplier" || documentType.includes("bill")) add("Settled Supplier Invoice", "/transactions/supplierBill/", record.againstDocumentId);
  }
  if (["invoice", "quote"].includes(type)) add("Source Sales Document", "/transactions/quote/", record.sourceDocumentId);
  if (["supplierBill", "purchaseOrder"].includes(type)) add("Source Purchase Document", "/transactions/purchaseOrder/", record.sourceDocumentId);
  const confirmed = targets.filter(target => found.some(link => link.href === target.href) || ["Journal Entry", "Customer", "Supplier", "Project"].includes(target.label));
  return <section className="panel phase4-cross-module-links" aria-label="Cross-module document navigation" style={{ marginTop: 16 }}>
    <h2>Connected Workspaces</h2>
    <p className="small">Navigation only. Source-to-target conversion actions remain in the controlled document workflow.</p>
    <div className="button-row" style={{ flexWrap: "wrap", gap: 8 }}>
      {confirmed.map(target => <Link key={target.href} prefetch={false} className="button-link secondary-link" href={target.href}>{target.label} ↗</Link>)}
      <Link className="button-link secondary-link" prefetch={false} href={`/document-explorer?documentId=${encodeURIComponent(documentId)}`}>Relationship Explorer ↗</Link>
    </div>
  </section>;
}
