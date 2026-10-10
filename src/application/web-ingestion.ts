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
      if (event.type === "message.received" || event.type === "message.sent") {
        const data = event.data;
        if (data.content.type !== "TEXT" || data.messageId || data.clientMessageId || data.sender.origin === "WAPPHUB" || data.sender.userId || !["SENT"].includes(data.status)) throw new AppError(409, "UNSUPPORTED_PROVIDER_EVENT");
        if (data.sender.externalId !== data.providerConversationId) throw new AppError(409, "INVALID_PROVIDER_IDENTITY");
        if (!data.providerConversationId.endsWith("@s.whatsapp.net") && !data.providerConversationId.endsWith("@lid")) throw new AppError(409, "UNSUPPORTED_PROVIDER_EVENT");
        const existing = await tx.message.findFirst({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, providerMessageId: data.providerMessageId }, include: { conversation: true } });
        if (existing) {
          if ((existing.transmittedBody ?? undefined) !== data.content.transmittedBody || existing.body !== data.content.originalBody || existing.direction !== data.direction || existing.conversation.providerConversationId !== data.providerConversationId) throw new AppError(409, "PROVIDER_IDEMPOTENCY_CONFLICT");
        } else {
          let contactIdentity = await tx.contactIdentity.findUnique({ where: { organizationId_channelId_externalId: { organizationId: scope.organizationId, channelId: scope.connectionId, externalId: data.providerConversationId } } });
          if (!contactIdentity) {
            const contact = await tx.contact.upsert({ where: { organizationId_primaryIdentifier: { organizationId: scope.organizationId, primaryIdentifier: data.providerConversationId } }, create: { organizationId: scope.organizationId, name: "Contato WhatsApp Web", primaryIdentifier: data.providerConversationId }, update: {} });
            contactIdentity = await tx.contactIdentity.create({ data: { organizationId: scope.organizationId, channelId: scope.connectionId, contactId: contact.id, externalId: data.providerConversationId } });
          }
          let conversation = await tx.conversation.findFirst({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, providerConversationId: data.providerConversationId } });
          if (!conversation) {
            conversation = await tx.conversation.create({ data: { organizationId: scope.organizationId, channelId: scope.connectionId, providerConversationId: data.providerConversationId, contactId: contactIdentity.contactId, lastMessageAt: new Date(event.occurredAt) } });
            await this.chat.resourceEvent(tx, scope.organizationId, "conversation.created", conversation.id, conversation.id);
          }
          const receipts = pendingReceipts(connection.pendingReceipts), receipt = receipts[receiptKey(data.providerMessageId)];
          const message = await this.messages.persistExternal(tx, { organizationId: scope.organizationId, channelId: scope.connectionId, conversationId: conversation.id, contactId: contactIdentity.contactId, providerMessageId: data.providerMessageId, direction: data.direction, body: data.content.originalBody, transmittedBody: data.content.transmittedBody, occurredAt: new Date(event.occurredAt), status: data.direction === "OUTBOUND" && receipt ? receipt.status : "SENT" });
          if (receipt) { delete receipts[receiptKey(data.providerMessageId)]; await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: scope.organizationId, channelId: scope.connectionId } }, data: { pendingReceipts: receipts } }); }
          await this.chat.resourceEvent(tx, scope.organizationId, "message.created", message.id, conversation.id, message.sequence);
          await this.chat.resourceEvent(tx, scope.organizationId, "conversation.updated", conversation.id, conversation.id);
        }
      } else if (event.type === "message.updated") {
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
          await tx.message.update({ where: { id: message.id }, data: { status: event.data.status } });
          await this.chat.resourceEvent(tx, scope.organizationId, "message.updated", message.id, message.conversationId, message.sequence);
        }
      } else if (event.type !== "connection.updated") throw new AppError(409, "UNSUPPORTED_PROVIDER_EVENT");
      await tx.providerInbox.create({ data: { ...identity, eventId: event.eventId, correlationId: event.correlationId, type: event.type, dataHash } });
      return true;
    });
  }
}
