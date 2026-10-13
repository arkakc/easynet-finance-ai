import assert from "node:assert/strict";
import test from "node:test";
import { conversionClaimCode, executeWithConversionClaim } from "../../lib/erp/conversion-guard";

test("external target created before failure cannot be duplicated on retry", async () => {
  const codes = new Set<string>();
  const states = new Map<string, string>();
  const targets = new Map<string, { parent: string; lines: number }>();
  const store = {
    async create({ data }: { data: { code: string } }) {
      if (codes.has(data.code)) throw Object.assign(new Error("duplicate claim"), { code: "P2002" });
      codes.add(data.code);
      states.set(data.code, "PENDING");
      return { id: data.code };
    },
    async update({ where, data }: { where: { id: string }; data: { status: string } }) {
      states.set(where.id, data.status);
    },
  };
  const sourceId = "QA-PO-PARTIAL-1";
  const kind = "purchaseOrderToBill";
  const claim = conversionClaimCode(kind, sourceId);
  await assert.rejects(executeWithConversionClaim(store as never, kind, sourceId, async () => {
    targets.set(sourceId, { parent: "QA-BILL-1", lines: 0 });
    throw new Error("fault injected between parent append and line append");
  }), /fault injected/);
  assert.equal(targets.get(sourceId)?.parent, "QA-BILL-1");
  assert.equal(states.get(claim), "IN_REVIEW");
  let secondParentAppend = false;
  await assert.rejects(executeWithConversionClaim(store as never, kind, sourceId, async () => {
    secondParentAppend = true;
  }), /already in progress or completed/);
  assert.equal(secondParentAppend, false);
  assert.equal(targets.size, 1);
  assert.equal(targets.get(sourceId)?.lines, 0);
});

test("successful source conversion preserves one target and marks claim approved", async () => {
  const codes = new Set<string>();
  const states = new Map<string, string>();
  const store = {
    async create({ data }: { data: { code: string } }) {
      if (codes.has(data.code)) throw Object.assign(new Error("duplicate claim"), { code: "P2002" });
      codes.add(data.code);
      return { id: data.code };
    },
    async update({ where, data }: { where: { id: string }; data: { status: string } }) {
      states.set(where.id, data.status);
    },
  };
  const result = await executeWithConversionClaim(store as never, "supplierQuoteToPo", "QA-SUPQ-1", async () => ({
    sourceId: "QA-SUPQ-1", status: "DRAFT", partyId: "QA-SUPPLIER", projectId: "QA-PROJECT",
    lines: [{ itemId: "QA-ITEM", qty: 2, rate: 50, netAmount: 100, gstAmount: 10, totalAmount: 110 }],
  }));
  assert.equal(result.lines.reduce((sum, line) => sum + line.totalAmount, 0), 110);
  assert.equal(result.status, "DRAFT");
  assert.equal(states.get(conversionClaimCode("supplierQuoteToPo", "QA-SUPQ-1")), "APPROVED");
});
