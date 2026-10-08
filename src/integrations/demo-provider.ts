import type { InboundText, MessagingProvider, OutboundText } from "./messaging-provider.js";

/** Deterministic in-process transport; it never calls an external messaging service. */
export class DemoProvider implements MessagingProvider {
  readonly code = "DEMO";
  async sendText({ clientMessageId }: OutboundText): Promise<{ providerMessageId: string }> {
    return { providerMessageId: `demo:out:${clientMessageId}` };
  }
  parseInbound(message: { externalMessageId: string; body: string }): InboundText {
    return { providerMessageId: `demo:in:${message.externalMessageId}`, body: message.body };
  }
}
