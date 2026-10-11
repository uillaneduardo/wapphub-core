import { proto } from "baileys";
import type { HistorySpec } from "../../../contracts/history.js";
import type { SyncItem } from "../../../contracts/provider.js";
import { normalizeContact, normalizeConversation, normalizeSyncMessage } from "./sync-normalization.js";
import type { Scope } from "./vault.js";
import { ServiceError } from "./errors.js";

/** Inspect wire records before protobuf object materialization. Unknown aggregate
 * lists and group participants are deliberately outside this adapter's scope. */
function fields(bytes: Uint8Array) {
  let offset = 0;
  const number = () => { let n = 0, factor = 1, steps = 0; while (offset < bytes.length && steps++ < 10) { const b = bytes[offset++]!; n += (b & 127) * factor; if (!(b & 128)) return n; factor *= 128; } throw new ServiceError("HISTORY_OBJECT_LIMIT"); };
  const result: { field: number; value?: Uint8Array; numeric?: number; raw: Uint8Array }[] = [];
  while (offset < bytes.length) {
    const start = offset, tag = number(), wire = tag & 7; let value: Uint8Array | undefined, numeric: number | undefined;
    if (wire === 0) numeric = number();
    else if (wire === 2) { const size = number(); if (!Number.isSafeInteger(size) || offset + size > bytes.length) throw new ServiceError("HISTORY_OBJECT_LIMIT"); value = bytes.subarray(offset, offset + size); offset += size; }
    else if (wire === 1 || wire === 5) offset += wire === 1 ? 8 : 4;
    else throw new ServiceError("HISTORY_OBJECT_LIMIT");
    if (offset > bytes.length || result.length >= 20000) throw new ServiceError("HISTORY_OBJECT_LIMIT");
    result.push({ field: Math.floor(tag / 8), value, numeric, raw: bytes.subarray(start, offset) });
  }
  return result;
}
function framed(field: number, payload: Uint8Array) {
  const prefix = [field * 8 + 2]; let n = payload.length;
  do { prefix.push((n & 127) | (n > 127 ? 128 : 0)); n = Math.floor(n / 128); } while (n);
  return Buffer.concat([Buffer.from(prefix), payload]);
}
export function boundHistoryObjects(bytes: Uint8Array, window?: { from: string; to: string }) {
  const out: Uint8Array[] = []; let conversations = 0, messages = 0, contacts = 0, mappings = 0;
  for (const f of fields(bytes)) {
    if (f.field === 2 && f.value && conversations++ < 500) {
      const parts: Uint8Array[] = [];
      for (const c of fields(f.value)) {
        if (c.field === 2 && c.value) {
          const web = fields(c.value).find((x) => x.field === 1)?.value;
          const timestamp = web ? fields(web).find((x) => x.field === 3)?.numeric : undefined;
          if (messages >= 1000 || window && (!timestamp || timestamp * 1000 < Date.parse(window.from) || timestamp * 1000 > Date.parse(window.to))) continue;
          messages++; parts.push(c.raw);
        } else if ([1, 5, 6, 12, 13, 16, 38, 39, 42, 43, 49].includes(c.field)) parts.push(c.raw);
      }
      out.push(framed(2, Buffer.concat(parts)));
    } else if (f.field === 7 && contacts++ < 500 || f.field === 15 && mappings++ < 500 || [1, 5, 6].includes(f.field)) out.push(f.raw);
  }
  return Buffer.concat(out);
}
export function selectHistory(scope: Scope, history: proto.IHistorySync, spec: HistorySpec): SyncItem[] {
  const contacts: Extract<SyncItem, { kind: "contact" }>[] = [], conversations: SyncItem[] = [];
  const ids = new Set<string>();
  const addContact = (item: SyncItem | undefined) => {
    if (!item || item.kind !== "contact" || contacts.length >= spec.limits.contacts || [item.identity.externalId, ...(item.identity.aliases ?? [])].some((id) => ids.has(id))) return;
    contacts.push(item); for (const id of [item.identity.externalId, ...(item.identity.aliases ?? [])]) ids.add(id);
  };
  const mappings = (history.phoneNumberToLidMappings ?? []).slice(0, 500);
  const phones = new Map(mappings.flatMap((m) => m.lidJid && m.pnJid ? [[m.lidJid, m.pnJid] as const] : []));
  const names = new Map((history.pushnames ?? []).slice(0, 500).flatMap((c) => c.id && c.pushname ? [[c.id, c.pushname] as const] : []));
  // Conversation identities have priority. Auxiliary names/mappings must never
  // consume a shared slice that would discard all metadata-only conversations.
  for (const c of (history.conversations ?? []).slice(0, spec.limits.conversations)) {
    const pn = c.pnJid ?? (c.id ? phones.get(c.id) : undefined), lid = c.lidJid ?? c.accountLid ?? undefined;
    addContact(normalizeContact({ id: c.id ?? undefined, name: c.displayName ?? c.name ?? (c.id ? names.get(c.id) : undefined), lid, phoneNumber: pn }));
    const item = normalizeConversation({ id: c.id ?? undefined, conversationTimestamp: c.conversationTimestamp ?? c.lastMsgTimestamp, archived: c.archived ?? undefined, unreadCount: c.unreadCount ?? undefined, lidJid: lid, pnJid: pn });
    if (item) conversations.push(item);
  }
  for (const m of mappings) addContact(normalizeContact({ id: m.pnJid ?? undefined, lid: m.lidJid ?? undefined }));
  for (const c of (history.pushnames ?? []).slice(0, 500)) addContact(normalizeContact({ id: c.id ?? undefined, notify: c.pushname ?? undefined }));
  const messages: Extract<SyncItem, { kind: "message" }>[] = [];
  for (const c of (history.conversations ?? []).slice(0, 500)) for (const m of (c.messages ?? []).slice(0, 1000)) {
    if (!m.message?.key) continue;
    const item = normalizeSyncMessage(scope, { ...m.message, key: m.message.key });
    if (item?.kind === "message" && Date.parse(item.occurredAt) >= Date.parse(spec.from) && Date.parse(item.occurredAt) <= Date.parse(spec.to)) messages.push(item);
  }
  messages.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.message.providerMessageId.localeCompare(b.message.providerMessageId));
  return [...contacts, ...conversations, ...messages.slice(0, spec.limits.messages)];
}
