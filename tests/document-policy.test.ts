import assert from "node:assert/strict";
import { test } from "node:test";
import { DOCUMENT_MIMES, inspectDocument } from "../contracts/document-policy.js";
const enc = new TextEncoder();
test("G.2 accepts PDF signature with strict MIME and name", () => {
  assert.deepEqual(inspectDocument("boleto.pdf", DOCUMENT_MIMES.pdf, enc.encode("%PDF-1.7"), 128), { ok: true, extension: "pdf", mimeType: DOCUMENT_MIMES.pdf });
});
test("G.2 blocks extension spoofing and invalid names", () => {
  assert.equal(inspectDocument("boleto.pdf.exe", DOCUMENT_MIMES.pdf, enc.encode("%PDF-1.7"), 128).ok, false);
  assert.equal(inspectDocument("../boleto.pdf", DOCUMENT_MIMES.pdf, enc.encode("%PDF-1.7"), 128).ok, false);
  assert.equal(inspectDocument("a\\b.pdf", DOCUMENT_MIMES.pdf, enc.encode("%PDF-1.7"), 128).ok, false);
  assert.equal(inspectDocument("a\u0000.pdf", DOCUMENT_MIMES.pdf, enc.encode("%PDF-1.7"), 128).ok, false);
});
test("G.2 rejects empty, oversized and MIME mismatch", () => {
  assert.equal(inspectDocument("boleto.pdf", DOCUMENT_MIMES.pdf, enc.encode("%PDF-1.7"), 0).ok, false);
  assert.equal(inspectDocument("boleto.pdf", DOCUMENT_MIMES.pdf, enc.encode("%PDF-1.7"), 16 * 1024 * 1024 + 1).ok, false);
  assert.equal(inspectDocument("boleto.pdf", "image/png", enc.encode("%PDF-1.7"), 128).ok, false);
  assert.equal(inspectDocument("boleto.pdf", DOCUMENT_MIMES.pdf, enc.encode("MZ executable"), 128).ok, false);
});
test("G.2 does not trust OOXML/Office headers without container inspection", () => {
  assert.equal(inspectDocument("a.docx", DOCUMENT_MIMES.docx, Uint8Array.from([80, 75, 3, 4]), 128).ok, false);
  assert.equal(inspectDocument("a.xls", DOCUMENT_MIMES.xls, Uint8Array.from([208, 207, 17, 224, 161, 177, 26, 225]), 128).ok, false);
  assert.equal(inspectDocument("a.csv", DOCUMENT_MIMES.csv, enc.encode("one,two"), 128).ok, false);
});
