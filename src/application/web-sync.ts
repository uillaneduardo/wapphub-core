import { createHash } from "node:crypto";
import type { Prisma, Contact, Conversation, Message } from "@prisma/client";
import { parseProviderEvent, type SyncItem, type ProviderEvent } from "../../contracts/provider.js";
import { AppError } from "../domain/errors.js";
import type { Chat } from "./chat.js";
import { MessageIngestionService } from "./message-ingestion.js";

type Scope = { organizationId: string; connectionId: string };
export type SyncOccurrence = { id: string; correlationId: string; code: string; status: "ACTIVE" | "RECOVERED" | "REJECTED" | "DEAD_LETTER"; stage: "PERSISTENCE" | "VALIDATION"; component: "CORE"; severity: "ERROR"; occurredAt: string; lastAttemptAt: string; attempts: number; items: number; recoveredAt?: string };
const diagnosticCodes = new Set(["PERSISTENCE_FAILED", "PROVIDER_IDEMPOTENCY_CONFLICT", "IDENTITY_MAPPING_CONFLICT", "PROVIDER_IDENTITY_CONFLICT", "UNSUPPORTED_PROVIDER_EVENT", "INVALID_PROVIDER_TIMESTAMP", "HISTORY_RETENTION_LIMIT", "STALE_PROVIDER_LEASE"]);
export const safeDiagnosticCode = (code: string) => diagnosticCodes.has(code) ? code : "PERSISTENCE_FAILED";
export function occurrences(value: unknown): SyncOccurrence[] {
  if (!Array.isArray(value)) return [];
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  return value.filter((x): x is SyncOccurrence => !!x && typeof x === "object" && uuid.test(x.id) && uuid.test(x.correlationId) && diagnosticCodes.has(x.code) && ["ACTIVE", "RECOVERED", "REJECTED", "DEAD_LETTER"].includes(x.status) && ["VALIDATION", "PERSISTENCE"].includes(x.stage) && x.component === "CORE" && x.severity === "ERROR" && Number.isSafeInteger(x.attempts) && x.attempts >= 0 && Number.isSafeInteger(x.items) && x.items >= 0 && Date.parse(x.occurredAt) > Date.now() - 30 * 86400000 && Number.isFinite(Date.parse(x.lastAttemptAt))).slice(-64).map((x) => ({ id: x.id, correlationId: x.correlationId, code: x.code, status: x.status, stage: x.stage, component: x.component, severity: x.severity, occurredAt: x.occurredAt, lastAttemptAt: x.lastAttemptAt, attempts: x.attempts, items: x.items, ...(x.recoveredAt && Number.isFinite(Date.parse(x.recoveredAt)) ? { recoveredAt: x.recoveredAt } : {}) }));
}
function observe(progress: Progress, event: ProviderEvent, code: string, stage: SyncOccurrence["stage"], status: SyncOccurrence["status"], attempt?: number) {
 const now = new Date().toISOString();
 let row = progress.occurrences.find((x) => x.id === event.eventId);
 if (!row) { row = { id: event.eventId, correlationId: event.correlationId, code: safeDiagnosticCode(code), stage, status, component: "CORE", severity: "ERROR", occurredAt: now, lastAttemptAt: now, attempts: 0, items: event.type === "sync.batch" ? event.data.items.length : 0 }; progress.occurrences.push(row); }
 row.code = safeDiagnosticCode(code); row.status = status; row.lastAttemptAt = now; row.attempts = Math.max(row.attempts + 1, attempt ?? 0);
 if (progress.occurrences.length > 64) { progress.occurrences.shift(); progress.diagnosticEvictions++; }
}
export type Progress = { occurrences: SyncOccurrence[]; diagnosticEvictions: number; receivedItems: number; processedItems: number; duplicateItems: number; rejectedItems: number; conversationsLocated: number; failedAttempts: number; failedBatches: Record<string, string>; diagnosticsSince?: string; contacts: number; conversations: number; messages: number; failures: number; batches: number; lastProcessedAt?: string; lastErrorCode?: string };
export function syncProgress(value: Prisma.JsonValue | null): Progress {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return { occurrences: occurrences(input.occurrences), diagnosticEvictions: Number(input.diagnosticEvictions ?? 0), receivedItems: Number(input.receivedItems ?? 0), processedItems: Number(input.processedItems ?? 0), duplicateItems: Number(input.duplicateItems ?? 0), rejectedItems: Number(input.rejectedItems ?? 0), conversationsLocated: Number(input.conversationsLocated ?? 0), failedAttempts: Number(input.failedAttempts ?? 0), failedBatches: input.failedBatches && typeof input.failedBatches === "object" && !Array.isArray(input.failedBatches) ? Object.fromEntries(Object.entries(input.failedBatches).filter(([key, value]) => /^[a-f0-9]{64}$/.test(key) && typeof value === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(value)).slice(0, 32)) as Record<string, string> : {}, ...(typeof input.diagnosticsSince === "string" ? { diagnosticsSince: input.diagnosticsSince } : {}), contacts: Number(input.contacts ?? 0), conversations: Number(input.conversations ?? 0), messages: Number(input.messages ?? 0), failures: Number(input.failures ?? 0), batches: Number(input.batches ?? 0), ...(typeof input.lastProcessedAt === "string" ? { lastProcessedAt: input.lastProcessedAt } : {}), ...(typeof input.lastErrorCode === "string" ? { lastErrorCode: input.lastErrorCode } : {}) };
}
export type PendingReceipt = { status: "SENT" | "DELIVERED" | "READ"; chatId?: string; expiresAt: number };
const ranks = ["PENDING", "SENT", "DELIVERED", "READ"];
export const higherStatus = (a: "SENT" | "DELIVERED" | "READ", b: "SENT" | "DELIVERED" | "READ") => ranks.indexOf(a) >= ranks.indexOf(b) ? a : b;
export function pendingReceipts(value: Prisma.JsonValue | null): Record<string, PendingReceipt> {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result: Record<string, PendingReceipt> = Object.create(null);
  for (const [key, raw] of Object.entries(input)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    if (typeof raw.expiresAt !== "number" || raw.expiresAt <= Date.now() || !["SENT", "DELIVERED", "READ"].includes(String(raw.status))) continue;
    result[key] = { status: raw.status as PendingReceipt["status"], expiresAt: raw.expiresAt, ...(typeof raw.chatId === "string" ? { chatId: raw.chatId } : {}) };
  }
  return result;
}
export const receiptKey = (id: string) => createHash("sha256").update(id).digest("hex");

/** Small atomic normalized batches; SQL inbox/checkpoint and domain commit together.
 * All lookups are scoped and prefetched; metadata conflicts isolate one item.
 * Infrastructure failures roll back the entire batch for the durable retry. */
export class WebSync {
  constructor(private readonly chat: Chat, private readonly ingestion = new MessageIngestionService()) {}
  async apply(scope: Scope, input: ProviderEvent, leaseToken: string) {
    const event = parseProviderEvent(input);
    if (event.type !== "sync.batch" || event.provider !== "WHATSAPP_WEB" || event.organizationId !== scope.organizationId || event.connectionId !== scope.connectionId) throw new AppError(403, "PROVIDER_EVENT_SCOPE_MISMATCH");
    const hash = createHash("sha256").update(JSON.stringify(event.data)).digest("hex");
    return this.chat.integrationMutation(scope.organizationId, async (tx) => {
      const connection = await tx.providerConnection.findFirst({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, leaseToken, leaseUntil: { gt: new Date() }, channel: { provider: "WHATSAPP_WEB" } } });
      if (!connection) throw new AppError(409, "STALE_PROVIDER_LEASE");
      const inboxKey = { organizationId: scope.organizationId, channelId: scope.connectionId, deduplicationId: event.deduplicationId };
      const progress = syncProgress(connection.syncProgress), receipts = pendingReceipts(connection.pendingReceipts);
      progress.diagnosticsSince ??= new Date().toISOString();
      delete progress.failedBatches[event.deduplicationId];
      const recovering = progress.occurrences.find((row) => row.id === event.eventId && ["ACTIVE", "DEAD_LETTER"].includes(row.status));
      if (recovering) { recovering.status = "RECOVERED"; recovering.attempts++; recovering.lastAttemptAt = new Date().toISOString(); recovering.recoveredAt = new Date().toISOString(); }
      const duplicate = await tx.providerInbox.findUnique({ where: { organizationId_channelId_deduplicationId: inboxKey } });
      if (duplicate) {
        if (duplicate.dataHash !== hash) throw new AppError(409, "PROVIDER_IDEMPOTENCY_CONFLICT");
        progress.duplicateItems += event.data.items.length;
        await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: scope.organizationId, channelId: scope.connectionId } }, data: { syncProgress: progress, version: { increment: 1 } } });
        await this.chat.resourceEvent(tx, scope.organizationId, "provider.connection.updated", scope.connectionId);
        return false;
      }
      progress.receivedItems += event.data.items.length;
      const identities = new Map<string, Contact>(), conversations = new Map<string, Conversation>(), messages = new Map<string, Message>();
      const identifiers = [...new Set(event.data.items.flatMap((item) => [item.identity.externalId, ...(item.identity.aliases ?? [])]))];
      const messageIds = event.data.items.flatMap((item) => item.kind === "message" ? [item.message.providerMessageId] : []);
      const load = async () => {
        identities.clear(); conversations.clear(); messages.clear();
        const known = await tx.contactIdentity.findMany({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, externalId: { in: identifiers } }, include: { contact: true } });
        for (const row of known) identities.set(row.externalId, row.contact);
        const contacts = [...new Set(known.map((row) => row.contactId))];
        for (const row of await tx.conversation.findMany({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, OR: [{ providerConversationId: { in: identifiers } }, { contactId: { in: contacts } }] } })) {
          if (row.providerConversationId) conversations.set(row.providerConversationId, row);
          if (!conversations.has(row.contactId)) conversations.set(row.contactId, row);
        }
        for (const row of await tx.message.findMany({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, providerMessageId: { in: messageIds } } })) messages.set(row.providerMessageId!, row);
      };
      await load();
      let contactsChanged = false;
      const historyChanged = new Set<string>(), metadataChanged = new Set<string>();
      const contact = async (item: SyncItem) => {
        const who = item.identity, aliases = [...new Set([who.externalId, ...(who.aliases ?? [])])];
        const known = aliases.flatMap((id) => identities.get(id) ? [identities.get(id)!] : []);
        if (new Set(known.map((row) => row.id)).size > 1) throw new AppError(409, "IDENTITY_MAPPING_CONFLICT");
        let row = known[0], changed = false;
        if (!row) {
          row = await tx.contact.upsert({ where: { organizationId_primaryIdentifier: { organizationId: scope.organizationId, primaryIdentifier: `web:${scope.connectionId}:${who.externalId}` } }, create: { organizationId: scope.organizationId, name: who.name ?? "Contato", providerName: who.name, primaryIdentifier: `web:${scope.connectionId}:${who.externalId}` }, update: {} });
          changed = true;
        } else if (who.name && who.name !== row.providerName && (!event.data.historical || ["Contato", "Contato WhatsApp Web"].includes(row.name))) {
          const name = row.name === row.providerName || ["Contato", "Contato WhatsApp Web"].includes(row.name) ? who.name : row.name;
          row = await tx.contact.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: row.id } }, data: { providerName: who.name, name } }); changed = true;
        }
        const missing = aliases.filter((id) => !identities.has(id));
        if (missing.length) {
          await tx.contactIdentity.createMany({ data: missing.map((externalId) => ({ organizationId: scope.organizationId, channelId: scope.connectionId, contactId: row!.id, externalId })) }); changed = true;
        }
        for (const alias of aliases) identities.set(alias, row);
        if (changed) { progress.contacts++; contactsChanged = true; }
        return row;
      };
      const conversation = async (item: SyncItem, person: Contact) => {
        let row = conversations.get(person.id) ?? conversations.get(item.identity.externalId);
        if (row) progress.conversationsLocated++;
        if (row && row.contactId !== person.id) throw new AppError(409, "IDENTITY_MAPPING_CONFLICT");
        const timestamp = item.kind === "message" ? new Date(item.occurredAt) : item.kind === "conversation" && item.lastMessageAt ? new Date(item.lastMessageAt) : new Date(0);
        if (!row) {
          row = await tx.conversation.create({ data: { organizationId: scope.organizationId, channelId: scope.connectionId, contactId: person.id, providerConversationId: item.identity.externalId, lastMessageAt: timestamp } });
          progress.conversations++; metadataChanged.add(row.id);
        }
        if (item.kind === "conversation" && item.metadata && (!event.data.historical || row.providerMetadata === null)) {
          const metadata = { ...item.metadata, observedAt: event.occurredAt };
          const previous = row.providerMetadata as { observedAt?: string } | null;
          if (!previous?.observedAt || previous.observedAt <= event.occurredAt) {
            row = await tx.conversation.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: row.id } }, data: { providerMetadata: metadata } }); metadataChanged.add(row.id);
          }
        }
        if (timestamp > row.lastMessageAt) { row = await tx.conversation.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: row.id } }, data: { lastMessageAt: timestamp } }); }
        conversations.set(person.id, row); conversations.set(item.identity.externalId, row); return row;
      };
      for (const item of event.data.items) {
        const before = { ...progress };
        await tx.$executeRawUnsafe("SAVEPOINT sync_item");
        try {
          if (item.kind === "message") {
            if (![item.identity.externalId, ...(item.identity.aliases ?? [])].includes(item.message.providerConversationId) || item.message.sender.externalId && ![item.identity.externalId, ...(item.identity.aliases ?? [])].includes(item.message.sender.externalId)) throw new AppError(409, "PROVIDER_IDENTITY_CONFLICT");
            if (item.message.sender.origin === "WAPPHUB" || item.message.messageId || item.message.clientMessageId || item.message.sender.userId) throw new AppError(409, "UNSUPPORTED_PROVIDER_EVENT");
            if (Date.parse(item.occurredAt) > Date.now() + 86400000 || Date.parse(item.occurredAt) <= 0) throw new AppError(409, "INVALID_PROVIDER_TIMESTAMP");
            if (event.data.historical && Date.parse(item.occurredAt) < Date.now() - 30 * 86400000) throw new AppError(409, "HISTORY_RETENTION_LIMIT");
          }
          const person = await contact(item); progress.processedItems++;
          if (item.kind === "contact") { await tx.$executeRawUnsafe("RELEASE SAVEPOINT sync_item"); continue; }
          const thread = await conversation(item, person);
          if (item.kind === "conversation") { await tx.$executeRawUnsafe("RELEASE SAVEPOINT sync_item"); continue; }
          const data = item.message, old = messages.get(data.providerMessageId);
          if (old) {
            progress.duplicateItems++;
            if (old.conversationId !== thread.id || old.body !== (data.content.originalBody ?? null) || old.direction !== data.direction || old.type !== data.content.type) throw new AppError(409, "PROVIDER_IDEMPOTENCY_CONFLICT");
            if (data.direction === "OUTBOUND" && ranks.indexOf(data.status) > ranks.indexOf(old.status)) {
              const updated = await tx.message.update({ where: { id: old.id }, data: { status: data.status } }); messages.set(data.providerMessageId, updated);
              if (event.data.historical) historyChanged.add(thread.id); else await this.chat.resourceEvent(tx, scope.organizationId, "message.updated", old.id, thread.id, old.sequence);
            }
          } else {
            const pending = receipts[receiptKey(data.providerMessageId)];
            if (pending?.chatId && ![item.identity.externalId, ...(item.identity.aliases ?? [])].includes(pending.chatId)) throw new AppError(409, "PROVIDER_IDENTITY_CONFLICT");
            const status = data.direction === "OUTBOUND" && pending ? higherStatus(data.status as PendingReceipt["status"], pending.status) : data.status as PendingReceipt["status"];
            const message = await this.ingestion.persistExternal(tx, { organizationId: scope.organizationId, channelId: scope.connectionId, conversationId: thread.id, contactId: person.id, providerMessageId: data.providerMessageId, direction: data.direction, body: data.content.originalBody ?? "", transmittedBody: data.content.transmittedBody, content: data.content, occurredAt: new Date(item.occurredAt), historical: event.data.historical, status });
            messages.set(data.providerMessageId, message); progress.messages++;
            delete receipts[receiptKey(data.providerMessageId)];
            if (event.data.historical) historyChanged.add(thread.id);
            else { await this.chat.resourceEvent(tx, scope.organizationId, "message.created", message.id, thread.id, message.sequence); metadataChanged.add(thread.id); }
          }
          await tx.$executeRawUnsafe("RELEASE SAVEPOINT sync_item");
        } catch (error) {
          if (!(error instanceof AppError) || error.status !== 409) throw error;
          await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT sync_item"); await tx.$executeRawUnsafe("RELEASE SAVEPOINT sync_item");
          Object.assign(progress, before); progress.failures++; progress.rejectedItems++; progress.lastErrorCode = safeDiagnosticCode(error.code);
          observe(progress, event, error.code, "VALIDATION", "REJECTED");
          await load();
        }
      }
      progress.batches++; progress.failures += event.data.failures ?? 0; progress.lastProcessedAt = new Date().toISOString();
      if (contactsChanged) await this.chat.resourceEvent(tx, scope.organizationId, "contacts.updated", scope.connectionId);
      for (const id of historyChanged) await this.chat.resourceEvent(tx, scope.organizationId, "conversation.history.updated", id, id);
      for (const id of metadataChanged) await this.chat.resourceEvent(tx, scope.organizationId, "conversation.updated", id, id);
      await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: scope.organizationId, channelId: scope.connectionId } }, data: { syncProgress: progress, pendingReceipts: receipts, version: { increment: 1 } } });
      await this.chat.resourceEvent(tx, scope.organizationId, "provider.connection.updated", scope.connectionId);
      await tx.providerInbox.create({ data: { ...inboxKey, eventId: event.eventId, correlationId: event.correlationId, type: event.type, dataHash: hash } });
      return true;
    });
  }
}

/** Failure bookkeeping is separate from the failed domain transaction, fenced
 * and bounded. No payload or external identity is retained. Retry removes it. */
export async function recordSyncFailure(chat: Chat, scope: Scope, event: ProviderEvent, token: string, code: string, attempt?: number, deadLetter = false) {
  if (event.type !== "sync.batch") return;
  if (event.organizationId !== scope.organizationId || event.connectionId !== scope.connectionId || event.provider !== "WHATSAPP_WEB") throw new AppError(403, "PROVIDER_EVENT_SCOPE_MISMATCH");
  await chat.integrationMutation(scope.organizationId, async (tx) => {
    const connection = await tx.providerConnection.findFirst({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, leaseToken: token, leaseUntil: { gt: new Date() } } });
    if (!connection) throw new AppError(409, "STALE_PROVIDER_LEASE");
    const progress = syncProgress(connection.syncProgress); progress.diagnosticsSince ??= new Date().toISOString(); progress.failedAttempts++;
    observe(progress, event, code, "PERSISTENCE", deadLetter ? "DEAD_LETTER" : "ACTIVE", attempt);
    if (Object.keys(progress.failedBatches).length < 32 || event.deduplicationId in progress.failedBatches) progress.failedBatches[event.deduplicationId] = /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : "PERSISTENCE_FAILED";
    await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: scope.organizationId, channelId: scope.connectionId } }, data: { syncProgress: progress, version: { increment: 1 } } });
    await chat.resourceEvent(tx, scope.organizationId, "provider.connection.updated", scope.connectionId);
  });
}
