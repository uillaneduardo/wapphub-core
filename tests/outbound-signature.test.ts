import { test } from "node:test";
import assert from "node:assert/strict";
import { outboundSignature } from "../src/application/outbound-signature.js";
import { AppError } from "../src/domain/errors.js";

test("signature preserves the original body including Unicode, whitespace and existing prefixes", () => {
  const body = "  *Ana*\n\nOlá 😀 e\u0301\n  ";
  assert.equal(outboundSignature(body, " Ana "), `*Ana*\n${body}`);
});

test("signature name cannot inject lines, WhatsApp formatting, controls or bidi", () => {
  const name = " \r\n*Jo\u0301se*\t_~`\u0000\u202e \u200b Silva\u2028\u2029 ";
  assert.equal(outboundSignature("Original", name), "*Jóse Silva*\nOriginal");
  assert.equal(outboundSignature("Oi", "Ana-Maria D’Ávila"), "*Ana-Maria D’Ávila*\nOi");
});

test("invalid normalized names fail without substituting an invented identity", () => {
  for (const name of ["", " \r\n", "*_~`\u0000\u200b\u202e"]) {
    assert.throws(() => outboundSignature("Oi", name), (error: unknown) => error instanceof AppError && error.status === 400 && error.code === "INVALID_ATTENDANT_NAME");
  }
});

test("final wire text and caption are bounded at 8000 Unicode code points including emojis", () => {
  const body = "😀" + "x".repeat(7995); // 7996 code points + four signature characters
  for (const media of [false, true]) {
    assert.equal([...outboundSignature(body, "A", media)].length, 8000);
    assert.throws(() => outboundSignature(body + "x", "A", media), (error: unknown) => error instanceof AppError && error.code === "MESSAGE_PRESENTATION_TOO_LONG");
  }
});

test("media without text never gains a signature or needs a usable name", () => {
  for (const body of ["", " \t\n "]) assert.equal(outboundSignature(body, "*_~`", true), body);
  assert.equal(outboundSignature("Legenda", "Ana", true), "*Ana*\nLegenda");
});
