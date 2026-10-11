import { createHash } from "node:crypto";
import { parseProviderEvent } from "../../contracts/provider.js";
import type { Chat } from "./chat.js";
import { MessageIngestionService } from "./message-ingestion.js";
import { AppError } from "../domain/errors.js";
import { WebSync, pendingReceipts, receiptKey, higherStatus, syncProgress } from "./web-sync.js";

/** Domain authority remains in Core. Adapter events never assert an employee or
 * supply internal conversation/contact IDs. Commit domain + inbox + realtime
 * before ack; duplicate events after a crash cannot duplicate messages. */
export class WebIngestion {
  constructor(private readonly chat: Chat, private readonly messages = new MessageIngestionService()) {}
  async apply(scope: { organizationId: string; connectionId: string }, input: unknown, leaseToken: string) {
    const event = parseProviderEvent(input);
    if (event.provider !== "WHATSAPP_WEB" || event.organizationId !== scope.organizationId || event.connectionId !== scope.connectionId) throw new AppError(403, "PROVIDER_EVENT_SCOPE_MISMATCH");
    if (event.type === "sync.batch") return new WebSync(this.chat, this.messages).apply(scope, event, leaseToken);
    if (event.type === "message.received" || event.type === "message.sent") {
      const data = event.data;
      if (data.messageId || data.clientMessageId || data.sender.origin === "WAPPHUB" || data.sender.userId || data.sender.externalId !== data.providerConversationId || data.status !== "SENT") throw new AppError(409, "UNSUPPORTED_PROVIDER_EVENT");
      if (!data.providerConversationId.endsWith("@s.whatsapp.net") && !data.providerConversationId.endsWith("@lid")) throw new AppError(409, "UNSUPPORTED_PROVIDER_EVENT");
      const normalized = { ...event, type: "sync.batch" as const, data: { historical: false, items: [{ kind: "message" as const, identity: { externalId: data.providerConversationId }, message: data, occurredAt: event.occurredAt }] } };
      return new WebSync(this.chat, this.messages).apply(scope, normalized, leaseToken, event);
    }
    const dataHash = createHash("sha256").update(JSON.stringify([event.type, event.data])).digest("hex");
    return this.chat.integrationMutation(scope.organizationId, async (tx) => {
      const connection = await tx.providerConnection.findFirst({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, leaseToken, leaseUntil: { gt: new Date() }, channel: { provider: "WHATSAPP_WEB" } } });
      if (!connection) throw new AppError(409, "STALE_PROVIDER_LEASE");
      const identity = { organizationId: scope.organizationId, channelId: scope.connectionId, deduplicationId: event.deduplicationId };
      const duplicate = await tx.providerInbox.findUnique({ where: { organizationId_channelId_deduplicationId: identity } });
      if (duplicate) {
        if (duplicate.dataHash !== dataHash) throw new AppError(409, "PROVIDER_IDEMPOTENCY_CONFLICT");
        return false;
      }
      if (event.type === "message.updated") {
        if (event.data.content || event.data.messageId) throw new AppError(409, "UNSUPPORTED_PROVIDER_EVENT");
        const message = await tx.message.findFirst({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, providerMessageId: event.data.providerMessageId, direction: "OUTBOUND" }, include: { conversation: true } });
        if (message && event.data.providerConversationId && event.data.providerConversationId !== message.conversation.providerConversationId) {
          const alias = await tx.contactIdentity.findFirst({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, contactId: message.conversation.contactId, externalId: event.data.providerConversationId } });
          if (!alias) throw new AppError(409, "PROVIDER_IDENTITY_CONFLICT");
        }
        if (!message) {
          const pending = pendingReceipts(connection.pendingReceipts), key = receiptKey(event.data.providerMessageId), old = pending[key];
          if (old?.chatId && event.data.providerConversationId && old.chatId !== event.data.providerConversationId) throw new AppError(409, "PROVIDER_IDENTITY_CONFLICT");
          if (!old && Object.keys(pending).length >= 256) {
            const progress = syncProgress(connection.syncProgress); progress.failures++; progress.lastErrorCode = "RECEIPT_RETENTION_LIMIT";
            await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: scope.organizationId, channelId: scope.connectionId } }, data: { syncProgress: progress, version: { increment: 1 } } });
            await this.chat.resourceEvent(tx, scope.organizationId, "provider.connection.updated", scope.connectionId);
          } else {
            pending[key] = { status: old ? higherStatus(old.status, event.data.status) : event.data.status, expiresAt: Date.now() + 7 * 86400000, ...(event.data.providerConversationId ? { chatId: event.data.providerConversationId } : old?.chatId ? { chatId: old.chatId } : {}) };
            await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: scope.organizationId, channelId: scope.connectionId } }, data: { pendingReceipts: pending } });
          }
        }
        const order = ["PENDING", "SENT", "DELIVERED", "READ"];
        if (message && order.indexOf(event.data.status) > order.indexOf(message.status)) {
          await tx.message.update({ where: { id: message.id }, data: { status: event.data.status, deliveryOutcome: null } });
          await this.chat.resourceEvent(tx, scope.organizationId, "message.updated", message.id, message.conversationId, message.sequence);
        }
      } else if (event.type !== "connection.updated") throw new AppError(409, "UNSUPPORTED_PROVIDER_EVENT");
      await tx.providerInbox.create({ data: { ...identity, eventId: event.eventId, correlationId: event.correlationId, type: event.type, dataHash } });
      return true;
    });
  }
}
