import { createHash, randomUUID } from "node:crypto";
import { parseProviderEvent, providerDeduplicationId, syncItemSchema, type ProviderEvent, type SyncItem } from "../../../contracts/provider.js";
import { ServiceError } from "./errors.js";
import { Vault, type Scope, type Session } from "./vault.js";
import { syncObservationSchema, type SyncObservation, type ProviderSync } from "../../../contracts/provider-internal.js";

export const webCapabilities = Object.freeze({ contentTypes: ["TEXT"], receipts: "PROVIDER", messageDeletion: false, groups: false, unofficial: true } as const);
export const webSyncCapabilities = Object.freeze({ ...webCapabilities, contentTypes: ["TEXT", "IMAGE", "AUDIO", "VOICE", "VIDEO", "DOCUMENT"] as const });
export function envelope(scope: Scope, type: ProviderEvent["type"], externalId: string, revision = "") {
  return {
    ...scope, version: 1, eventId: randomUUID(), correlationId: randomUUID(),
    provider: "WHATSAPP_WEB", type, occurredAt: new Date().toISOString(),
    capabilities: type === "sync.batch" ? webSyncCapabilities : webCapabilities,
    deduplicationId: providerDeduplicationId({ ...scope, provider: "WHATSAPP_WEB", type, externalId, revision }),
  };
}
export function appendRecordEvent(record: Session, input: unknown) {
  const event = parseProviderEvent(input);
  if (event.organizationId !== record.organizationId || event.connectionId !== record.connectionId) throw new ServiceError("EVENT_SCOPE_MISMATCH", 403);
  if (record.dedup.includes(event.deduplicationId)) return false;
  if (record.events.length >= 512) throw new ServiceError("EVENT_QUEUE_FULL", 503);
  record.events.push({ event, attempts: 0, leaseUntil: 0, dead: false });
  record.dedup.push(event.deduplicationId);
  if (record.dedup.length > 4096) record.dedup.shift();
  return true;
}

/** Durable pull/ack transport. Delivery is at least once, Core must deduplicate
 * transactionally before ack. No fake Core endpoint or volatile Redis queue. */
export class EventJournal {
  constructor(private readonly vault: Vault, private readonly now = Date.now) {}
  async append(scope: Scope, input: unknown) {
    const event = parseProviderEvent(input);
    if (event.organizationId !== scope.organizationId || event.connectionId !== scope.connectionId) throw new ServiceError("EVENT_SCOPE_MISMATCH", 403);
    return this.vault.update(scope, (record) => appendRecordEvent(record, event));
  }
  async stage(scope: Scope, items: SyncItem[], historical: boolean, historyEnabled: boolean, completed = false, failures = 0, limited = false, observation?: SyncObservation) {
    if (historical && !historyEnabled) return;
    await this.vault.update(scope, (record) => {
      const sync = record.sync ??= { historyEnabled, phase: historyEnabled ? "AWAITING_HISTORY" : "DISABLED", queued: 0, contacts: 0, conversations: 0, messages: 0, failures: 0, limited: false, durationMs: 0, pending: [], complete: false, startedAt: this.now(), historyContacts: 0, historyConversations: 0, historyMessages: 0 };
      const diagnostics: NonNullable<ProviderSync["diagnostics"]> = sync.diagnostics ??= { since: new Date(this.now()).toISOString(), received: 0, normalized: 0, ignored: 0, rejected: 0, failures: 0, legacyFailures: sync.failures, publishedBatches: 0, acknowledgedBatches: 0, sourceCounts: {}, reasons: {} };
      if (observation) {
        const safe = syncObservationSchema.parse(observation);
        for (const key of ["received", "normalized", "ignored", "rejected", "failures"] as const) diagnostics[key] += safe[key];
        diagnostics.sourceCounts[safe.source] = (diagnostics.sourceCounts[safe.source] ?? 0) + safe.received;
        diagnostics.lastSource = safe.source;
        for (const [key, count] of Object.entries(safe.reasons)) { const code = key as keyof SyncObservation["reasons"]; diagnostics.reasons[code] = (diagnostics.reasons[code] ?? 0) + count; diagnostics.lastCode = code; }
      } else diagnostics.failures += failures;
      sync.historyEnabled = historyEnabled; sync.failures += failures; sync.limited ||= limited;
      let bytes = Buffer.byteLength(JSON.stringify(sync.pending));
      for (const item of items) {
        if (!syncItemSchema.safeParse(item).success) { diagnostics.rejected++; diagnostics.reasons.STAGING_INVALID = (diagnostics.reasons.STAGING_INVALID ?? 0) + 1; continue; }
        const kind = item.kind === "contact" ? "Contacts" : item.kind === "conversation" ? "Conversations" : "Messages";
        const budget = kind === "Messages" ? 1000 : 500;
        if (historical && (sync[`history${kind}`] >= budget || item.kind === "message" && Date.parse(item.occurredAt) < this.now() - 30 * 86400000)) { sync.limited = true; continue; }
        const identity = [item.identity.externalId, ...(item.identity.aliases ?? [])].map((id) => createHash("sha256").update(id).digest("hex"));
        const admitted = sync.historyIdentities ??= [];
        const known = admitted.find((ids) => ids.some((id) => identity.includes(id)));
        if (historical && !known && admitted.length >= 500) { sync.limited = true; continue; }
        const entry = { item, historical }, size = Buffer.byteLength(JSON.stringify(entry));
        const maxItems = historical ? 1500 : 2000, maxBytes = (historical ? 1.5 : 2) * 1024 * 1024;
        if (sync.pending.length >= maxItems || bytes + size > maxBytes) {
          if (!historical) throw new ServiceError("SYNC_BACKPRESSURE", 503);
          sync.limited = true; sync.failures++; continue;
        }
        sync.pending.push(entry); bytes += size;
        if (historical) {
          sync[`history${kind}`]++;
          if (!known) admitted.push(identity); else for (const id of identity) if (!known.includes(id) && known.length < 3) known.push(id);
        }
        if (item.kind === "contact") sync.contacts++; else if (item.kind === "conversation") sync.conversations++; else sync.messages++;
      }
      if (historical) { sync.complete ||= completed; sync.phase = sync.pending.some((entry) => entry.item.kind === "contact") ? "CONTACTS" : "MESSAGES"; }
      else if (sync.pending.length) sync.phase = sync.pending.some((entry) => entry.item.kind === "contact") ? "CONTACTS" : "MESSAGES";
      sync.durationMs = this.now() - sync.startedAt;
    });
  }
  private async promote(scope: Scope) {
    const existing = this.vault.get(scope);
    if (!existing?.sync?.pending.length || !existing.sync.pending.some((entry) => !entry.historical) && existing.events.filter((entry) => entry.event.type === "sync.batch").length >= 4 || existing.events.length >= 128) return;
    await this.vault.update(scope, (record) => {
      const sync = record.sync!;
      // Live items precede historical work, with at most two batches per pull.
      sync.pending.sort((a, b) => Number(a.historical) - Number(b.historical));
      for (let batch = 0; batch < 2 && sync.pending.length; batch++) {
        const historical = sync.pending[0]!.historical;
        const items: SyncItem[] = []; let bytes = 0;
        for (const entry of sync.pending) {
          const size = Buffer.byteLength(JSON.stringify(entry.item));
          if (entry.historical !== historical || items.length === 20 || bytes + size > 48000) break;
          items.push(entry.item); bytes += size;
        }
        if (!items.length) break;
        const event = { ...envelope(scope, "sync.batch", randomUUID()), data: { historical, items } };
        appendRecordEvent(record, event); if (sync.diagnostics) sync.diagnostics.publishedBatches++; sync.pending.splice(0, items.length);
      }
    });
  }
  async pull(scope: Scope, limit: number) {
    await this.promote(scope);
    // Idle sessions do not rewrite ciphertext/fsync on every worker scan.
    if (!this.vault.get(scope)?.events.some((item) => !item.dead && item.leaseUntil <= this.now())) return [];
    return this.vault.update(scope, (record) => {
      const available = record.events.filter((item) => !item.dead && item.leaseUntil <= this.now()).sort((a, b) => Number(a.event.type === "sync.batch" && a.event.data.historical) - Number(b.event.type === "sync.batch" && b.event.data.historical)).slice(0, limit);
      return available.flatMap((item) => {
        if (item.attempts >= 5) { item.dead = true; return []; }
        item.attempts++;
        item.leaseId = randomUUID();
        item.leaseUntil = this.now() + 30_000;
        return [{ event: item.event, leaseId: item.leaseId, attempt: item.attempts }];
      });
    });
  }
  async ack(scope: Scope, eventId: string, leaseId: string) {
    return this.vault.update(scope, (record) => {
      const item = record.events.find((entry) => entry.event.eventId === eventId);
      if (!item) return; // lost ack response is safe to repeat
      if (item.leaseId !== leaseId || item.dead) throw new ServiceError("STALE_EVENT_LEASE");
      if (item.event.type === "sync.batch" && record.sync?.diagnostics) record.sync.diagnostics.acknowledgedBatches++;
      record.events = record.events.filter((entry) => entry !== item);
    });
  }
  async nack(scope: Scope, eventId: string, leaseId: string) {
    return this.vault.update(scope, (record) => {
      const item = record.events.find((entry) => entry.event.eventId === eventId);
      if (!item || item.leaseId !== leaseId || item.dead) throw new ServiceError("STALE_EVENT_LEASE");
      item.dead = item.attempts >= 5;
      item.leaseUntil = this.now() + Math.min(60_000, 1000 * 2 ** item.attempts);
      delete item.leaseId;
    });
  }
  async retryDead(scope: Scope, eventId: string) {
    return this.vault.update(scope, (record) => {
      const item = record.events.find((entry) => entry.event.eventId === eventId);
      if (!item?.dead) throw new ServiceError("EVENT_NOT_DEAD");
      item.dead = false; item.attempts = 0; item.leaseUntil = 0; delete item.leaseId;
    });
  }
  metrics() {
    const { pending, dead, syncDead, syncQueued } = this.vault.metrics();
    return { pending, dead, syncDead, syncQueued };
  }
}
