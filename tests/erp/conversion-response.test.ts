import assert from "node:assert/strict";
import test from "node:test";
import { assertSuccessfulConversionResponse } from "../../lib/erp/conversion-response";

test("accepts explicit successful backend conversion", async () => {
  await assert.doesNotReject(assertSuccessfulConversionResponse(new Response(JSON.stringify({ ok: true, id: "QA-1" }), { status: 200 })));
});
test("rejects HTTP 200 response that reports failure", async () => {
  await assert.rejects(assertSuccessfulConversionResponse(new Response(JSON.stringify({ ok: false, error: "failed after parent write" }), { status: 200 })), /failed after parent write/);
});
test("rejects ambiguous HTTP 200 and malformed JSON to prevent false approval", async () => {
  for (const body of ["{}", "not-json", JSON.stringify({ id: "QA-1" })]) {
    await assert.rejects(assertSuccessfulConversionResponse(new Response(body, { status: 200 })), /outcome uncertain/);
  }
});
test("rejects non-2xx including misleading success payload", async () => {
  await assert.rejects(assertSuccessfulConversionResponse(new Response(JSON.stringify({ ok: true }), { status: 503 })), /outcome uncertain/);
});
