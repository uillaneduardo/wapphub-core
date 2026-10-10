import { randomUUID } from "node:crypto";
import { parseProviderEvent, providerDeduplicationId, type ProviderEvent } from "../../../contracts/provider.js";
import { ServiceError } from "./errors.js";
import { Vault, type Scope, type Session } from "./vault.js";

export const webCapabilities = Object.freeze({ contentTypes: ["TEXT"], receipts: "PROVIDER", messageDeletion: false, groups: false, unofficial: true } as const);
export function envelope(scope: Scope, type: ProviderEvent["type"], externalId: string, revision = "") {
  return {
    ...scope, version: 1, eventId: randomUUID(), correlationId: randomUUID(),
    provider: "WHATSAPP_WEB", type, occurredAt: new Date().toISOString(),
    capabilities: webCapabilities,
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
  async pull(scope: Scope, limit: number) {
    return this.vault.update(scope, (record) => {
      const available = record.events.filter((item) => !item.dead && item.leaseUntil <= this.now()).slice(0, limit);
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
    const { pending, dead } = this.vault.metrics();
    return { pending, dead };
  }
}
