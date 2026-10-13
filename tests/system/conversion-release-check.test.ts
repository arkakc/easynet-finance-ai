import test from "node:test";
import assert from "node:assert/strict";
import { conversionClaimsReadiness } from "../../lib/system/conversion-release-check";
test("unresolved partial-write claim blocks production readiness",()=>{const check=conversionClaimsReadiness(2,10);assert.equal(check.passed,false);assert.equal(check.blocking,true);assert.match(check.detail,/reconcile/i);});
test("all claims approved or resolved does not block",()=>{const check=conversionClaimsReadiness(0,10);assert.equal(check.passed,true);});
test("invalid claim counts cannot show a green readiness signal",()=>{assert.throws(()=>conversionClaimsReadiness(-1,0),/Invalid/);assert.throws(()=>conversionClaimsReadiness(3,2),/Invalid/);});
