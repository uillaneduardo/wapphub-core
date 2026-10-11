import { normalizeText, normalizedContentSchema } from "../../contracts/provider.js";
import type { Prisma } from "@prisma/client";

/** Shared normalized-message persistence for provider ingress and the Demo adapter. */
export class MessageIngestionService {
  async persistExternal(tx: Prisma.TransactionClient, input: {
    organizationId: string; channelId: string; conversationId: string; contactId: string;
    providerMessageId: string; direction: "INBOUND" | "OUTBOUND"; body: string;
    transmittedBody?: string; occurredAt: Date; historical?: boolean; content?: unknown; status?: "SENT" | "DELIVERED" | "READ";
  }) {
    const content = input.content === undefined ? normalizeText(input.body) : normalizedContentSchema.parse(input.content);
    if (input.transmittedBody !== undefined) normalizeText(input.transmittedBody);
    const message = await tx.message.create({ data: {
      organizationId: input.organizationId, conversationId: input.conversationId,
      channelId: input.channelId, senderContactId: input.direction === "INBOUND" ? input.contactId : null,
      providerMessageId: input.providerMessageId, direction: input.direction, type: content.type,
      body: content.originalBody, transmittedBody: input.transmittedBody,
      providerOccurredAt: input.occurredAt, createdAt: input.occurredAt, historical: input.historical ?? false,
      ...(content.type !== "TEXT" ? { mediaMetadata: content.media } : {}), status: input.status ?? "SENT",
    } });
    await tx.conversation.updateMany({ where: { organizationId: input.organizationId, id: input.conversationId, lastMessageAt: { lt: message.createdAt } }, data: { lastMessageAt: message.createdAt } });
    return message;
  }
  async persistInbound(tx: Prisma.TransactionClient, input: {
    organizationId: string;
    channelId: string;
    conversationId: string;
    contactId: string;
    providerMessageId: string;
    body: string;
  }) {
    const content = normalizeText(input.body);
    const message = await tx.message.create({
      include: { senderContact: { select: { name: true } } },
      data: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        channelId: input.channelId,
        senderContactId: input.contactId,
        providerMessageId: input.providerMessageId,
        direction: "INBOUND",
        type: "TEXT",
        body: content.originalBody,
        status: "SENT",
      },
    });
    await tx.conversation.update({
      where: { organizationId_id: { organizationId: input.organizationId, id: input.conversationId } },
      data: { lastMessageAt: message.createdAt },
    });
    return message;
  }
}
