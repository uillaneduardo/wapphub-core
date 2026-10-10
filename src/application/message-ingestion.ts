import { normalizeText } from "../../contracts/provider.js";
import type { Prisma } from "@prisma/client";

/** Shared normalized-message persistence for provider ingress and the Demo adapter. */
export class MessageIngestionService {
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
