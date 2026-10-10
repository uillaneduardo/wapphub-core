/** M1 version-1 event contract; identifiers only, content is fetched with REST authorization. */
export const chatEventTypes = [
  "provider.connection.updated",
  "contacts.updated",
  "conversation.history.updated",
  "conversation.created",
  "conversation.updated",
  "conversation.archived",
  "conversation.assigned",
  "conversation.transferred",
  "message.created",
  "message.updated",
  "note.created",
  "tag.created",
  "tag.updated",
  "tag.deleted",
  "conversation.tag.added",
  "conversation.tag.removed",
] as const;
export type ChatEventType = (typeof chatEventTypes)[number];
export type TenantEvent<TType extends string, TPayload> = {
  version: 1;
  eventId: string;
  organizationId: string;
  type: TType;
  entityId: string;
  occurredAt: string;
  payload: TPayload;
};
export type ChatEvent = TenantEvent<
  ChatEventType,
  { resourceId: string; conversationId?: string }
>;
export type SyncCheckpoint = {
  version: 1;
  type: "sync.checkpoint";
  lastEventId: string;
  hasMore: boolean;
};
export type TenantScope = {
  organizationId: string;
  userId: string;
  membershipId: string;
};
