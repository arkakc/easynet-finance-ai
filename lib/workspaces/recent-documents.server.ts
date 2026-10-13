import { prisma } from "@/src/lib/prisma";
import type { WorkspaceId } from "@/lib/workspaces/module-registry";

export type WorkspaceRecentDocument = {
  id: string;
  number: string;
  kind: string;
  party: string;
  date: string;
  status: string;
  amount: number;
  currency: string;
  href: string;
};
const row = (x: {
  id: string; code: string; status: string; total?: unknown; amount?: unknown; currency: string; createdAt?: Date;
  party: string; kind: string; type: string;
}): WorkspaceRecentDocument => ({
  id: x.id,
  number: x.code,
  kind: x.kind,
  party: x.party,
  date: x.createdAt?.toISOString().slice(0, 10) || "",
  status: String(x.status),
  amount: Number(x.total ?? x.amount ?? 0),
  currency: x.currency,
  href: `/transactions/${x.type}/${encodeURIComponent(x.id)}`,
});

/** Read-only recent transaction preview. Authoritative full registers remain in /transactions. */
export async function recentWorkspaceDocuments(module: WorkspaceId): Promise<WorkspaceRecentDocument[]> {
  if (module === "sales") {
    const [quotes, invoices, payments] = await Promise.all([
      prisma.quote.findMany({ take: 35, orderBy: { createdAt: "desc" }, include: { customer: { select: { name: true } } } }),
      prisma.invoice.findMany({ take: 35, orderBy: { createdAt: "desc" }, include: { customer: { select: { name: true } } } }),
      prisma.payment.findMany({ where: { customerId: { not: null } }, take: 35, orderBy: { createdAt: "desc" }, include: { customer: { select: { name: true } } } }),
    ]);
    return [
      ...quotes.map(x => row({ ...x, kind: x.code.startsWith("SO-") ? "Sales Order" : "Sales Quotation", party: x.customer.name, type: "quote" })),
      ...invoices.map(x => row({ ...x, kind: "Sales Invoice", party: x.customer.name, type: "invoice" })),
      ...payments.map(x => row({ ...x, kind: "Customer Receipt", party: x.customer?.name || "Customer", type: "payment" })),
    ].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)).slice(0, 40);
  }
  if (module === "purchases") {
    const [orders, bills, payments] = await Promise.all([
      prisma.purchaseOrder.findMany({ take: 35, orderBy: { createdAt: "desc" }, include: { supplier: { select: { name: true } } } }),
      prisma.supplierBill.findMany({ take: 35, orderBy: { createdAt: "desc" }, include: { supplier: { select: { name: true } } } }),
      prisma.payment.findMany({ where: { supplierId: { not: null } }, take: 35, orderBy: { createdAt: "desc" }, include: { supplier: { select: { name: true } } } }),
    ]);
    return [
      ...orders.map(x => row({ ...x, kind: x.code.startsWith("SUPQ-") ? "Supplier Quotation" : "Purchase Order", party: x.supplier.name, type: "purchaseOrder" })),
      ...bills.map(x => row({ ...x, kind: "Supplier Bill", party: x.supplier.name, type: "supplierBill" })),
      ...payments.map(x => row({ ...x, kind: "Supplier Payment", party: x.supplier?.name || "Supplier", type: "payment" })),
    ].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)).slice(0, 40);
  }
  return [];
}
