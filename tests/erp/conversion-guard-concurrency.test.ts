import assert from "node:assert/strict";
import test from "node:test";
import { conversionClaimCode, executeWithConversionClaim } from "../../lib/erp/conversion-guard";

function store() {
  const codes = new Set<string>();
  const statuses = new Map<string, string>();
  const adapter = {
    async create(input: { data: { code: string } }) {
      if (codes.has(input.data.code)) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
      codes.add(input.data.code);
      statuses.set(input.data.code, "PENDING");
      return { id: input.data.code };
    },
    async update(input: { where: { id: string }; data: { status: string } }) {
      statuses.set(input.where.id, input.data.status);
    },
  };
  return { adapter, codes, statuses };
}

test("simultaneous requests for same source acquire only one claim", async () => {
  const { adapter, statuses } = store();
  let writes = 0;
  const call = () => executeWithConversionClaim(adapter as never, "purchaseOrderToBill", "PO-1", async () => {
    writes++;
    await Promise.resolve();
    return "created";
  });
  const results = await Promise.allSettled([call(), call()]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
  assert.equal(writes, 1);
  assert.equal(statuses.get(conversionClaimCode("purchaseOrderToBill", "PO-1")), "APPROVED");
});

test("failed downstream write preserves IN_REVIEW claim and blocks retry", async () => {
  const { adapter, statuses } = store();
  await assert.rejects(
    executeWithConversionClaim(adapter as never, "quoteToInvoice", "SQ-2", async () => {
      throw new Error("legacy backend timed out after partial write");
    }),
    /legacy backend timed out/,
  );
  assert.equal(statuses.get(conversionClaimCode("quoteToInvoice", "SQ-2")), "IN_REVIEW");
  let retried = false;
  await assert.rejects(
    executeWithConversionClaim(adapter as never, "quoteToInvoice", "SQ-2", async () => {
      retried = true;
    }),
    /already in progress or completed/,
  );
  assert.equal(retried, false);
});

test("same target route key shares claim and other conversion type remains separate", async () => {
  assert.equal(conversionClaimCode("purchaseOrderToBill", "PO-3"), conversionClaimCode("purchaseOrderToBill", "PO-3"));
  assert.notEqual(conversionClaimCode("purchaseOrderToBill", "PO-3"), conversionClaimCode("supplierQuoteToPo", "PO-3"));
  assert.notEqual(conversionClaimCode("purchaseOrderToBill", "PO-3"), conversionClaimCode("purchaseOrderToBill", "PO-4"));
});
