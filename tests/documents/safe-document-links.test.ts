import assert from "node:assert/strict";
import test from "node:test";
import { safeDocumentHref, dedupeDocumentLinks } from "../../lib/documents/safe-document-links";

test("accepts supported internal document details", () => {
  assert.equal(safeDocumentHref("/transactions/invoice/INV-2026-001"), "/transactions/invoice/INV-2026-001");
  assert.equal(safeDocumentHref("/journals/JRN-001"), "/journals/JRN-001");
  assert.equal(safeDocumentHref("/projects/master/PROJ-1"), "/projects/master/PROJ-1");
});
test("rejects external malformed and unsupported navigation", () => {
  for (const href of ["https://example.com", "//example.com", "javascript:alert(1)", "/transactions/invoice/", "/transactions/nope/1", "/transactions/invoice/../other", "/transactions/invoice/X?next=evil", "/transactions/invoice/X#other", "/transactions/invoice/X\\Y"]) {
    assert.equal(safeDocumentHref(href), null, href);
  }
});
test("deduplicates eligible document links", () => {
  const rows = [
    { id: "1", number: "INV-1", href: "/transactions/invoice/1" },
    { id: "1", number: "INV-1", href: "/transactions/invoice/1" },
    { id: "2", number: "Other", href: "https://external.invalid" },
    { id: "", number: "No ID", href: "/transactions/invoice/3" },
  ];
  assert.deepEqual(dedupeDocumentLinks(rows), [rows[0]]);
});
