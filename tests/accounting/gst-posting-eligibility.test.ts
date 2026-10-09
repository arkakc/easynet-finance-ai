import test from "node:test";
import assert from "node:assert/strict";
import { mayPostGst } from "../../lib/accounting/gst-posting-eligibility";

test("registered with TIN and retained GST certificate may post GST", () => {
  assert.equal(mayPostGst({ status: "REGISTERED", registrationNumberPresent: true, certificateRetained: true }), true);
});
test("verified with registration evidence may post", () => {
  assert.equal(mayPostGst({ status: "VERIFIED", registrationNumberPresent: true, certificateRetained: true }), true);
});
test("unverified, missing TIN or missing certificate must block", () => {
  for (const status of ["UNVERIFIED", "UNREGISTERED", "EXEMPT", ""]) {
    assert.equal(mayPostGst({ status, registrationNumberPresent: true, certificateRetained: true }), false);
  }
  assert.equal(mayPostGst({ status: "REGISTERED", registrationNumberPresent: false, certificateRetained: true }), false);
  assert.equal(mayPostGst({ status: "REGISTERED", registrationNumberPresent: true, certificateRetained: false }), false);
});
