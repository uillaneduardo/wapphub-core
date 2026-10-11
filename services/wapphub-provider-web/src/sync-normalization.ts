import { createHash } from "node:crypto";
import { jidNormalizedUser, normalizeMessageContent, proto, type Contact, type WAMessage, type Chat } from "baileys";
import { syncItemSchema, type SyncItem } from "../../../contracts/provider.js";
import type { Scope } from "./vault.js";
import type { SyncObservation } from "../../../contracts/provider-internal.js";

export type NormalizationOutcome = { type: "normalized"; item: SyncItem } | { type: "ignored" | "rejected" | "failures"; code: keyof SyncObservation["reasons"] };
export function diagnoseIdentity(value: Partial<Contact> | Partial<Chat>, normalize: () => SyncItem | undefined): NormalizationOutcome {
  if (value.id && !directIdentity(value.id)) return { type: "ignored", code: "UNSUPPORTED_IDENTITY" };
  const item = normalize(); return item ? { type: "normalized", item } : { type: "rejected", code: "INVALID_IDENTITY" };
}
export function diagnoseMessage(scope: Scope, value: WAMessage): NormalizationOutcome {
  if (value.key.remoteJid && !directIdentity(value.key.remoteJid)) return { type: "ignored", code: "UNSUPPORTED_IDENTITY" };
  if (!directIdentity(value.key.remoteJid) || !value.key.id || !Number.isFinite(Number(value.messageTimestamp)) || Number(value.messageTimestamp) <= 0 || Number(value.messageTimestamp) * 1000 > Date.now() + 86400000) return { type: "rejected", code: "INVALID_MESSAGE" };
  const raw = normalizeMessageContent(value.message);
  if (!raw) return { type: "ignored", code: "SYSTEM_NOTICE" };
  if (raw.protocolMessage || raw.senderKeyDistributionMessage && Object.keys(raw).length === 1) return { type: "ignored", code: "PROTOCOL_MESSAGE" };
  if (!(raw.conversation !== undefined || raw.extendedTextMessage || raw.imageMessage || raw.audioMessage || raw.videoMessage || raw.documentMessage)) return { type: "ignored", code: "UNSUPPORTED_CONTENT" };
  const item = normalizeSyncMessage(scope, value); return item ? { type: "normalized", item } : { type: "rejected", code: "INVALID_CONTENT" };
}

export function directIdentity(value: string | null | undefined) {
  if (!value || value.length > 120 || !/^[a-zA-Z0-9_.:-]+@(s\.whatsapp\.net|lid)$/.test(value)) return undefined;
  return jidNormalizedUser(value);
}
export function identity(contact: Partial<Contact>) {
  const original = directIdentity(contact.id), phone = directIdentity(contact.phoneNumber), opaque = directIdentity(contact.lid);
  const pn = phone?.endsWith("@s.whatsapp.net") ? phone : undefined, lid = opaque?.endsWith("@lid") ? opaque : undefined;
  const externalId = pn ?? original ?? lid;
  if (!externalId) return undefined;
  const aliases = [...new Set([original, pn, lid].filter((value): value is string => !!value && value !== externalId))];
  const name = (contact.name ?? contact.notify ?? contact.verifiedName)?.slice(0, 120);
  return { externalId, ...(aliases.length ? { aliases } : {}), ...(name ? { name } : {}) };
}
export function normalizeContact(value: Partial<Contact>): SyncItem | undefined {
  const who = identity(value); return who ? { kind: "contact", identity: who } : undefined;
}
export function normalizeConversation(value: Partial<Chat>): SyncItem | undefined {
  const who = identity({ id: value.id ?? undefined, name: value.name ?? undefined, lid: value.lidJid ?? undefined, phoneNumber: value.pnJid ?? undefined });
  if (!who) return undefined;
  const timestamp = Number(value.conversationTimestamp ?? value.lastMessageRecvTimestamp) * 1000;
  return { kind: "conversation", identity: who, ...(Number.isFinite(timestamp) && timestamp > 0 && timestamp <= Date.now() + 86400000 ? { lastMessageAt: new Date(timestamp).toISOString() } : {}), metadata: { ...(typeof value.archived === "boolean" ? { archived: value.archived } : {}), ...(typeof value.unreadCount === "number" ? { unreadCount: Math.min(1000000, Math.max(0, value.unreadCount)) } : {}) } };
}
function referenceId(scope: Scope, id: string, chatId: string) {
  const hex = createHash("sha256").update(JSON.stringify([scope.organizationId, scope.connectionId, chatId, id])).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function normalizeSyncMessage(scope: Scope, value: WAMessage): SyncItem | undefined {
  const chatId = directIdentity(value.key.remoteJid), alternative = directIdentity(value.key.remoteJidAlt);
  const id = value.key.id, timestamp = Number(value.messageTimestamp) * 1000;
  if (!chatId || !id || id.length > 160 || !Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now() + 86400000) return undefined;
  const who = identity({ id: chatId, ...(alternative?.endsWith("@lid") ? { lid: alternative } : alternative ? { phoneNumber: alternative } : {}), notify: !value.key.fromMe ? value.pushName ?? undefined : undefined })!;
  const raw = normalizeMessageContent(value.message);
  if (!raw) return undefined;
  const text = raw.conversation ?? raw.extendedTextMessage?.text;
  let content: Extract<SyncItem, { kind: "message" }>["message"]["content"];
  if (text) content = { type: "TEXT", originalBody: text };
  else {
    const entry = raw.imageMessage ? { type: "IMAGE" as const, data: raw.imageMessage, mime: "image/jpeg" } : raw.audioMessage ? { type: raw.audioMessage.ptt ? "VOICE" as const : "AUDIO" as const, data: raw.audioMessage, mime: "audio/ogg" } : raw.videoMessage ? { type: "VIDEO" as const, data: raw.videoMessage, mime: "video/mp4" } : raw.documentMessage ? { type: "DOCUMENT" as const, data: raw.documentMessage, mime: "application/octet-stream" } : undefined;
    if (!entry) return undefined;
    const size = Number(entry.data.fileLength ?? 0);
    const caption = "caption" in entry.data ? entry.data.caption : undefined;
    const fileName = "fileName" in entry.data && entry.data.fileName ? [...entry.data.fileName].map((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === "/" || char === "\\" ? "_" : char).join("").slice(0, 200) : "arquivo";
    content = { type: entry.type, ...(caption ? { originalBody: caption } : {}), media: { mediaId: referenceId(scope, id, chatId), type: entry.type, mimeType: entry.data.mimetype ?? entry.mime, fileName, size, state: "PENDING", ...(entry.data.fileSha256?.length === 32 ? { sha256: Buffer.from(entry.data.fileSha256).toString("hex") } : {}) } };
  }
  const status = value.key.fromMe && (value.status === proto.WebMessageInfo.Status.READ || value.status === proto.WebMessageInfo.Status.PLAYED) ? "READ" : value.key.fromMe && value.status === proto.WebMessageInfo.Status.DELIVERY_ACK ? "DELIVERED" : "SENT";
  const item = { kind: "message", identity: who, occurredAt: new Date(timestamp).toISOString(), message: { providerMessageId: id, providerConversationId: who.externalId, direction: value.key.fromMe ? "OUTBOUND" : "INBOUND", sender: { origin: value.key.fromMe ? "DEVICE" : "CONTACT", externalId: who.externalId }, status, content } };
  const parsed = syncItemSchema.safeParse(item); return parsed.success ? parsed.data : undefined;
}
