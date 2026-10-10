import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import {
  demoCapabilities, MAX_PROVIDER_EVENT_BYTES, MAX_MEDIA_BYTES, normalizeText,
  parseProviderEvent, presentText, ProviderContractError, providerDeduplicationId,
  providerEventTypes,
} from "../contracts/provider.js";
import { DemoProvider } from "../src/integrations/demo-provider.js";
const org = randomUUID(), connection = randomUUID(), messageId = randomUUID(), author = randomUUID();
function envelope(type: string, data: unknown) {
  return { version: 1, eventId: randomUUID(), correlationId: randomUUID(), organizationId: org, connectionId: connection, provider: "DEMO", occurredAt: new Date().toISOString(), deduplicationId: "a".repeat(64), capabilities: { ...demoCapabilities, contentTypes: [...demoCapabilities.contentTypes] }, type, data };
}
function received() {
  return envelope("message.received", { providerMessageId: "external-1", providerConversationId: "conversation-1", sender: { origin: "CONTACT", externalId: "contact-1" }, direction: "INBOUND", content: { type: "TEXT", originalBody: "  Olá\n🙂 e\u0301  " }, status: "SENT" });
}
const media = { mediaId: randomUUID(), type: "IMAGE", mimeType: "image/jpeg", fileName: "foto.jpg", size: 512, state: "PENDING" };
test("all eight normalized event kinds have an explicit versioned contract", () => {
  const event = received();
  const events = [
    event,
    envelope("message.sent", { providerMessageId: "external-2", providerConversationId: "conversation-1", messageId, sender: { origin: "WAPPHUB", userId: author }, direction: "OUTBOUND", content: normalizeText("texto"), status: "SENT" }),
    envelope("message.updated", { providerMessageId: "external-2", messageId, status: "READ" }),
    envelope("message.failed", { messageId, errorCode: "PROVIDER_UNAVAILABLE", retryable: true, outcome: "NOT_SENT" }),
    { ...envelope("message.deleted", { providerMessageId: "external-2", origin: "DEVICE" }), capabilities: { ...event.capabilities, messageDeletion: true } },
    envelope("connection.updated", { state: "CONNECTING", retryable: true }),
    { ...envelope("media.updated", { messageId, media }), capabilities: { ...event.capabilities, contentTypes: ["TEXT", "IMAGE"] } },
    envelope("sync.batch", { historical: true, items: [{ kind: "contact", identity: { externalId: "opaque@lid" } }] }),
  ];
  assert.deepEqual(events.map((item) => parseProviderEvent(JSON.stringify(item)).type), providerEventTypes);
  for (const item of events) assert.equal(parseProviderEvent(item).organizationId, org);
});
test("text normalizes shape without trimming or changing original Unicode/whitespace", () => {
  const event = parseProviderEvent(received()); assert.equal(event.type, "message.received");
  if (event.type !== "message.received") throw Error("Unexpected kind");
  assert.equal(event.data.content.originalBody, "  Olá\n🙂 e\u0301  ");
  assert.deepEqual(normalizeText(" A\nB "), { type: "TEXT", originalBody: " A\nB " });
});
test("presentation policy is optional, bounded and independent of original body", () => {
  assert.deepEqual(presentText("Oi"), { type: "TEXT", originalBody: "Oi", transmittedBody: "Oi" });
  assert.deepEqual(presentText("Oi", { attendantSignature: true, attendantName: " Ana " }), { type: "TEXT", originalBody: "Oi", transmittedBody: "Ana: Oi" });
  for (const name of ["", "\n", "Nome\r\nFalso", "a".repeat(121)]) assert.throws(() => presentText("Oi", { attendantSignature: true, attendantName: name }), ProviderContractError);
  assert.throws(() => presentText("a".repeat(8000), { attendantSignature: true, attendantName: "Ana" }), (error: unknown) => error instanceof ProviderContractError && error.code === "MESSAGE_PRESENTATION_TOO_LONG");
});
test("deduplication binds tenant, connection, provider, event kind and receipt revision", () => {
  const input = { organizationId: org, connectionId: connection, provider: "DEMO" as const, type: "message.received" as const, externalId: "message-1" };
  const key = providerDeduplicationId(input); assert.equal(key, providerDeduplicationId(input)); assert.match(key, /^[a-f0-9]{64}$/);
  const alternatives = [{ ...input, organizationId: randomUUID() }, { ...input, connectionId: randomUUID() }, { ...input, provider: "WHATSAPP_WEB" as const }, { ...input, type: "message.updated" as const }, { ...input, externalId: "message-2" }, { ...input, revision: "DELIVERED" }, { ...input, revision: "READ" }];
  assert.equal(new Set([key, ...alternatives.map(providerDeduplicationId)]).size, alternatives.length + 1);
  assert.notEqual(providerDeduplicationId({ ...input, externalId: "a:b", revision: "c" }), providerDeduplicationId({ ...input, externalId: "a", revision: "b:c" }));
});
test("external senders cannot forge WappHub authorship or direction", () => {
  const event = received(); const data = event.data as Record<string, unknown>;
  assert.throws(() => parseProviderEvent({ ...event, data: { ...data, sender: { origin: "CONTACT", externalId: "x", userId: author } } }), ProviderContractError);
  assert.throws(() => parseProviderEvent({ ...event, data: { ...data, direction: "OUTBOUND" } }), ProviderContractError);
  assert.throws(() => parseProviderEvent({ ...event, data: { ...data, sender: { origin: "WAPPHUB" } } }), ProviderContractError);
  assert.throws(() => parseProviderEvent({ ...event, type: "message.sent" }), ProviderContractError);
});
test("binary/URLs/raw payload/auth and QR fields are rejected rather than persisted", () => {
  const event = received();
  for (const extra of [{ raw: { stanza: "private" } }, { auth: "secret" }, { qr: "credential" }, { base64: "aGVsbG8=" }, { url: "https://private.example" }, { file: Buffer.from("blob") }]) assert.throws(() => parseProviderEvent({ ...event, ...extra }), ProviderContractError);
  assert.throws(() => parseProviderEvent(envelope("connection.updated", { state: "QR_REQUIRED", retryable: false, qr: "secret" })), ProviderContractError);
  assert.throws(() => parseProviderEvent(envelope("connection.updated", { state: "QR_REQUIRED", retryable: false })), ProviderContractError);
  assert.equal(parseProviderEvent(envelope("connection.updated", { state: "QR_REQUIRED", retryable: false, qrRevision: 1, qrExpiresAt: new Date().toISOString() })).type, "connection.updated");
});
test("contract bounds malformed and oversized events and returns sanitized errors", () => {
  const invalid = [undefined, null, { version: 2 }, "{bad-json", "x".repeat(MAX_PROVIDER_EVENT_BYTES + 1), { ...received(), organizationId: "other-tenant" }, { ...received(), occurredAt: "yesterday" }, { ...received(), capabilities: { ...demoCapabilities, token: "private" } }];
  for (const value of invalid) assert.throws(() => parseProviderEvent(value), (reason: unknown) => reason instanceof ProviderContractError && reason.message === "INVALID_PROVIDER_EVENT");
  const event = received(), data = event.data as Record<string, unknown>;
  assert.throws(() => parseProviderEvent({ ...event, data: { ...data, content: normalizeText("x".repeat(8000)), status: "FAILED" } }), ProviderContractError);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle; assert.throws(() => parseProviderEvent(cycle), ProviderContractError);
  assert.throws(() => parseProviderEvent(envelope("message.failed", { messageId, errorCode: "private phone +55123", retryable: false, outcome: "UNKNOWN" })), ProviderContractError);
});
test("media is a bounded metadata reference and respects declared capability/type", () => {
  const event = received(), data = event.data as Record<string, unknown>;
  const image = { ...event, capabilities: { ...event.capabilities, contentTypes: ["TEXT", "IMAGE"] }, data: { ...data, content: { type: "IMAGE", media } } };
  assert.equal(parseProviderEvent(image).type, "message.received");
  assert.throws(() => parseProviderEvent({ ...image, capabilities: event.capabilities }), (reason: unknown) => reason instanceof ProviderContractError && reason.code === "UNSUPPORTED_PROVIDER_CONTENT");
  for (const extra of [{ size: MAX_MEDIA_BYTES + 1 }, { size: -1 }, { mimeType: "text/html; injected" }, { fileName: "../../secret" }, { url: "https://external" }, { type: "AUDIO" }]) assert.throws(() => parseProviderEvent({ ...image, data: { ...data, content: { type: "IMAGE", media: { ...media, ...extra } } } }), ProviderContractError);
  assert.throws(() => parseProviderEvent(envelope("message.deleted", { providerMessageId: "x", origin: "DEVICE" })), (reason: unknown) => reason instanceof ProviderContractError && reason.code === "UNSUPPORTED_PROVIDER_OPERATION");
});
test("Demo retains deterministic IDs and legacy receipt/ingress DTOs with shared text normalization", async () => {
  const provider = new DemoProvider(); const input = { organizationId: org, channelId: connection, providerConversationId: "demo-conversation", clientMessageId: "client-id", body: "  Texto original\n " };
  const legacyId = "demo:out:" + createHash("sha256").update([org, connection, "demo-conversation", "client-id"].join(":")).digest("hex");
  assert.deepEqual(await provider.sendText(input), { providerMessageId: legacyId }); assert.deepEqual(await provider.sendText(input), { providerMessageId: legacyId });
  assert.deepEqual(provider.parseInbound({ externalMessageId: "external-1", body: input.body }), { providerMessageId: "demo:in:external-1", body: input.body });
  assert.deepEqual(provider.capabilities.contentTypes, ["TEXT"]); assert.equal(provider.capabilities.unofficial, false); assert.ok(Object.isFrozen(provider.capabilities)); assert.ok(Object.isFrozen(provider.capabilities.contentTypes));
  await assert.rejects(provider.sendText({ ...input, body: "x".repeat(8001) }), ProviderContractError);
});
