import { createHash } from "node:crypto";
import { z } from "zod";

/** Internal service protocol, NOT the public realtime envelope. No SDK types. */
export const providerEventTypes = [
  "message.received", "message.sent", "message.updated", "message.failed",
  "message.deleted", "connection.updated", "media.updated",
] as const;
export const contentTypes = ["TEXT", "IMAGE", "AUDIO", "VOICE", "VIDEO", "DOCUMENT"] as const;
export const MAX_PROVIDER_EVENT_BYTES = 65536;
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
function hasControlCharacters(value: string) { return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127); }
const id = z.uuid();
const externalId = z.string().min(1).max(160);
const errorCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/);
export const capabilitiesSchema = z.strictObject({
  contentTypes: z.array(z.enum(contentTypes)).min(1).max(contentTypes.length).refine((types) => new Set(types).size === types.length),
  receipts: z.enum(["LOCAL", "PROVIDER", "NONE"]),
  messageDeletion: z.boolean(),
  groups: z.boolean(),
  unofficial: z.boolean(),
});
export type ProviderCapabilities = Readonly<Omit<z.infer<typeof capabilitiesSchema>, "contentTypes">> & { readonly contentTypes: readonly (typeof contentTypes)[number][] };
export const demoCapabilities: ProviderCapabilities = Object.freeze({
  contentTypes: Object.freeze(["TEXT"] as const), receipts: "LOCAL", messageDeletion: false, groups: false, unofficial: false,
});
export const mediaReferenceSchema = z.strictObject({
  mediaId: id,
  type: z.enum(["IMAGE", "AUDIO", "VOICE", "VIDEO", "DOCUMENT"]),
  mimeType: z.string().min(3).max(120).regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i),
  fileName: z.string().min(1).max(200).refine((name) => !hasControlCharacters(name) && !/[\\/]/.test(name)),
  size: z.number().int().min(0).max(MAX_MEDIA_BYTES),
  state: z.enum(["PENDING", "TRANSFERRING", "READY", "FAILED"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  thumbnailMediaId: id.optional(),
});
const textContent = z.strictObject({ type: z.literal("TEXT"), originalBody: z.string().min(1).max(8000), transmittedBody: z.string().min(1).max(8000).optional() });
const mediaContent = z.strictObject({ type: z.enum(["IMAGE", "AUDIO", "VOICE", "VIDEO", "DOCUMENT"]), originalBody: z.string().max(8000).optional(), transmittedBody: z.string().max(8000).optional(), media: mediaReferenceSchema }).refine((content) => content.type === content.media.type);
export const normalizedContentSchema = z.union([textContent, mediaContent]);
const sender = z.strictObject({
  origin: z.enum(["CONTACT", "WAPPHUB", "DEVICE"]),
  externalId: z.string().min(1).max(120).optional(),
  userId: id.optional(),
}).superRefine((value, ctx) => {
  if (value.origin === "WAPPHUB" && !value.userId) ctx.addIssue({ code: "custom", message: "WappHub author required" });
  if (value.origin !== "WAPPHUB" && value.userId) ctx.addIssue({ code: "custom", message: "External origin cannot assert internal authorship" });
  if (value.origin === "CONTACT" && !value.externalId) ctx.addIssue({ code: "custom", message: "Contact identity required" });
});
const message = z.strictObject({
  providerMessageId: externalId,
  providerConversationId: z.string().min(1).max(120),
  messageId: id.optional(),
  clientMessageId: z.string().min(1).max(100).optional(),
  sender,
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  content: normalizedContentSchema,
  status: z.enum(["PENDING", "SENT", "DELIVERED", "READ", "FAILED"]),
}).superRefine((value, ctx) => {
  if ((value.direction === "INBOUND") !== (value.sender.origin === "CONTACT")) ctx.addIssue({ code: "custom", message: "Direction and sender origin conflict" });
});
const base = {
  version: z.literal(1), eventId: id, correlationId: id,
  organizationId: id, connectionId: id,
  provider: z.enum(["DEMO", "WHATSAPP_WEB", "META"]),
  occurredAt: z.iso.datetime({ offset: true }),
  deduplicationId: z.string().regex(/^[a-f0-9]{64}$/),
  capabilities: capabilitiesSchema,
};
const update = z.strictObject({ providerMessageId: externalId, messageId: id.optional(), status: z.enum(["SENT", "DELIVERED", "READ"]), content: normalizedContentSchema.optional() });
export const providerEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("message.received"), data: message }),
  z.strictObject({ ...base, type: z.literal("message.sent"), data: message }),
  z.strictObject({ ...base, type: z.literal("message.updated"), data: update }),
  z.strictObject({ ...base, type: z.literal("message.failed"), data: z.strictObject({ providerMessageId: externalId.optional(), messageId: id, errorCode, retryable: z.boolean(), outcome: z.enum(["NOT_SENT", "UNKNOWN"]) }) }),
  z.strictObject({ ...base, type: z.literal("message.deleted"), data: z.strictObject({ providerMessageId: externalId, messageId: id.optional(), origin: z.enum(["CONTACT", "WAPPHUB", "DEVICE"]) }) }),
  z.strictObject({ ...base, type: z.literal("connection.updated"), data: z.strictObject({ state: z.enum(["DISCONNECTED", "CONNECTING", "QR_REQUIRED", "CONNECTED", "RECONNECTING", "FAILED", "LOGGED_OUT"]), qrRevision: z.number().int().min(0).optional(), qrExpiresAt: z.iso.datetime({ offset: true }).optional(), errorCode: errorCode.optional(), retryable: z.boolean() }) }),
  z.strictObject({ ...base, type: z.literal("media.updated"), data: z.strictObject({ messageId: id, media: mediaReferenceSchema, errorCode: errorCode.optional() }) }),
]);
export type ProviderEvent = z.infer<typeof providerEventSchema>;
export class ProviderContractError extends Error {
  constructor(readonly code = "INVALID_PROVIDER_EVENT") { super(code); }
}
/** Strict allowlist rejects payload blobs, URLs, QR/auth, binary and unknown fields. */
export function parseProviderEvent(input: unknown): ProviderEvent {
  let parsed: unknown = input;
  try {
    if (typeof input === "string") {
      if (Buffer.byteLength(input, "utf8") > MAX_PROVIDER_EVENT_BYTES) throw new ProviderContractError();
      parsed = JSON.parse(input);
    }
    if (Buffer.byteLength(JSON.stringify(parsed), "utf8") > MAX_PROVIDER_EVENT_BYTES) throw new ProviderContractError();
    const result = providerEventSchema.safeParse(parsed);
    if (!result.success) throw new ProviderContractError();
    const event = result.data;
    if (event.type === "message.received" || event.type === "message.sent") {
      if ((event.type === "message.received") !== (event.data.direction === "INBOUND")) throw new ProviderContractError();
      if (["PENDING", "FAILED"].includes(event.data.status)) throw new ProviderContractError();
      if (!event.capabilities.contentTypes.includes(event.data.content.type)) throw new ProviderContractError("UNSUPPORTED_PROVIDER_CONTENT");
    }
    if (event.type === "connection.updated" && event.data.state === "QR_REQUIRED" && (!event.data.qrRevision || !event.data.qrExpiresAt)) throw new ProviderContractError();
    if (event.type === "message.deleted" && !event.capabilities.messageDeletion) throw new ProviderContractError("UNSUPPORTED_PROVIDER_OPERATION");
    if (event.type === "media.updated" && !event.capabilities.contentTypes.includes(event.data.media.type)) throw new ProviderContractError("UNSUPPORTED_PROVIDER_CONTENT");
    return event;
  } catch (reason) {
    if (reason instanceof ProviderContractError) throw reason;
    throw new ProviderContractError(); // never expose input or validator issues
  }
}
/** Scope and event-specific revision prevent cross-tenant and receipt collisions. */
export function providerDeduplicationId(input: { organizationId: string; connectionId: string; provider: ProviderEvent["provider"]; type: ProviderEvent["type"]; externalId: string; revision?: string }) {
  return createHash("sha256").update(JSON.stringify([1, input.organizationId, input.connectionId, input.provider, input.type, input.externalId, input.revision ?? ""])).digest("hex");
}
export function normalizeText(originalBody: string) {
  const result = textContent.safeParse({ type: "TEXT", originalBody });
  if (!result.success) throw new ProviderContractError("INVALID_MESSAGE_CONTENT");
  return result.data; // exact content: no trimming, Unicode conversion or signature
}
export type TextPresentationPolicy = { attendantSignature: false } | { attendantSignature: true; attendantName: string };
export function presentText(originalBody: string, policy: TextPresentationPolicy = { attendantSignature: false }) {
  const original = normalizeText(originalBody);
  if (!policy.attendantSignature) return { ...original, transmittedBody: original.originalBody };
  const name = policy.attendantName.trim();
  if (!name || name.length > 120 || hasControlCharacters(policy.attendantName)) throw new ProviderContractError("INVALID_PRESENTATION_POLICY");
  const transmittedBody = `${name}: ${original.originalBody}`;
  if (transmittedBody.length > 8000) throw new ProviderContractError("MESSAGE_PRESENTATION_TOO_LONG");
  return { ...original, transmittedBody };
}
