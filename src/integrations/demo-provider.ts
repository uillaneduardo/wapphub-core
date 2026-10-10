import { demoCapabilities, normalizeText } from "../../contracts/provider.js";
import type { InboundText, MessagingProvider, OutboundText } from "./messaging-provider.js";
import { createHash } from "node:crypto";

/** Deterministic in-process transport; it never calls an external messaging service. */
export class DemoProvider implements MessagingProvider {
  readonly code = "DEMO";
  readonly capabilities = demoCapabilities;
  async sendText(message: OutboundText): Promise<{ providerMessageId: string }> {
    normalizeText(message.body);
    // clientMessageId is unique per conversation, not per channel. Derive a
    // compact deterministic provider ID from the full scope to preserve retry
    // idempotency without colliding across conversations.
    const scope = [message.organizationId, message.channelId, message.providerConversationId, message.clientMessageId].join(":");
    const digest = createHash("sha256").update(scope).digest("hex");
    return { providerMessageId: `demo:out:${digest}` };
  }
  parseInbound(message: { externalMessageId: string; body: string }): InboundText {
    return { providerMessageId: `demo:in:${message.externalMessageId}`, body: normalizeText(message.body).originalBody };
  }
}
