export type SourceDocument = Record<string, unknown>;
export type ExistingDocument = Record<string, unknown>;
const text = (value: unknown) => String(value ?? "").trim();
const numeric = (value: unknown) => Number(value ?? 0);
export function automationPreview(sourceType: "quote" | "purchaseOrder", source: SourceDocument, existing: ExistingDocument[], lines: SourceDocument[]) {
  const isSales = sourceType === "quote";
  const id = text(isSales ? source.quoteId : source.poId);
  const sourceNumber = text(isSales ? source.quoteNumber : source.poNumber);
  const targetType = isSales ? "salesOrder" : "supplierBill";
  const sourceStatus = text(source.status).toUpperCase();
  const validStatuses = isSales ? ["APPROVED", "SENT", "ACCEPTED"] : ["APPROVED", "SENT", "PART_RECEIVED", "RECEIVED", "PART_BILLED"];
  const matched = existing.filter(row => text(row.sourceDocumentId) === id || text(row.sourceQuoteId) === id || text(row.poId) === id);
  const active = matched.filter(row => !["CANCELLED", "REVERSED", "VOID"].includes(text(row.status).toUpperCase()));
  const ready = validStatuses.includes(sourceStatus) && lines.length > 0 && lines.every(row => text(row.itemId) && numeric(row.qty) > 0);
  const totalAmount = numeric(source.totalAmount);
  const projectId = text(source.projectId);
  const partyId = text(isSales ? source.customerId : source.supplierId);
  const defaults = {
    partyId, projectId, currency: text(source.currency) || "PGK",
    exchangeRate: numeric(source.exchangeRate) || 1,
    totalAmount, sourceDocumentId: id,
    lines: lines.map(line => ({ itemId: text(line.itemId), description: text(line.description || line.itemName), qty: numeric(line.qty), rate: numeric(line.rate), uom: text(line.uom) || "Each" })),
  };
  const warnings: string[] = [];
  if (!ready) warnings.push("Source document is not ready for controlled conversion.");
  if (active.length) warnings.push(`${active.length} existing related document(s) found. Review before creating another.`);
  if (!partyId) warnings.push("Source party is missing.");
  if (totalAmount <= 0) warnings.push("Source total must be reviewed.");
  return { targetType, sourceNumber, ready: ready && !!partyId && totalAmount > 0,
    requiresReview: true, duplicateCandidates: active.map(row => ({ id: text(isSales ? row.quoteId : row.billId), number: text(isSales ? row.quoteNumber : row.billNumber), status: text(row.status) })),
    defaults, warnings };
}
