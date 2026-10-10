import type { ProviderCapabilities } from "../../contracts/provider.js";
export type OutboundText = {
  organizationId: string;
  channelId: string;
  providerConversationId: string;
  clientMessageId: string;
  body: string;
};
export type InboundText = { providerMessageId: string; body: string };
export interface MessagingProvider {
  readonly code: string;
  readonly capabilities: ProviderCapabilities;
  sendText(message: OutboundText): Promise<{ providerMessageId: string }>;
  parseInbound(message: { externalMessageId: string; body: string }): InboundText;
}
