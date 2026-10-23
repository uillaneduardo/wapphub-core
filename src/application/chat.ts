import { createWebContact } from "./web-contact.js";
import { outboundSignature } from "./outbound-signature.js";
import { mediaUploadSchema, mediaLimit, validMediaKind, type MediaUpload } from "../../contracts/provider-media.js";
import { mediaReferenceSchema } from "../../contracts/provider.js";
import { createHash, randomUUID } from "node:crypto";
import { WebProviderError, publicMediaError, type WebProviderPort } from "../integrations/web-provider-client.js";
import { internationalPhoneSchema, directJidSchema } from "../../contracts/provider-outbound.js";
import { externalContactPresentation, trustedContactName, type PresentationIdentity } from "../integrations/provider-contact-presentation.js";
import { resolvePermissions } from "../domain/resources.js";
import { chatEventTypes, type ChatEventType } from "../realtime/contract.js";
import {
  Prisma,
  type PrismaClient,
  type Conversation,
  type HistoryVisibility,
  type RealtimeEvent,
} from "@prisma/client";
import { AppError } from "../domain/errors.js";
import { cursorDecode, cursorEncode, decimal } from "../domain/chat.js";
import type { Principal } from "./foundation.js";
import type { Config } from "../infrastructure/config.js";
import type { MessagingProvider } from "../integrations/messaging-provider.js";
import type { MessageIngestionService } from "./message-ingestion.js";
type DB = Prisma.TransactionClient;
export type ChatContext = {
  organizationId: string;
  userId: string;
  role: string;
  permissions: string[];
  webOutboundEnabled?: boolean;
  webMediaEnabled?: boolean;
};
export type PageQuery = {
  limit?: number;
  cursor?: string;
  before?: string;
  scope?: "mine" | "unassigned" | "all";
  archived?: boolean;
  tagId?: string;
  contactId?: string;
  q?: string;
};
type ContactPresentation = { id?: string; name: string; providerName?: string | null; primaryIdentifier?: string; channelIdentities?: PresentationIdentity[] };
const contactPresentationSelect = { id: true, name: true, providerName: true, primaryIdentifier: true, channelIdentities: { include: { channel: { select: { provider: true, webConnection: { select: { outboundEnabled: true, mediaEnabled: true, state: true, errorCode: true, lastCheckedAt: true } } } } } } } as const;
function contactPresentation(contact: ContactPresentation, includePhone = true) {
 const external = externalContactPresentation(contact.primaryIdentifier ?? "", contact.channelIdentities);
 const generated = external.external && contact.providerName == null && ["Contato", "Contato WhatsApp Web"].includes(contact.name);
 const name = (!generated ? trustedContactName(contact.name) : null) || trustedContactName(contact.providerName) || (includePhone ? external.phone : null) || `Contato ${contact.id?.slice(0, 8) ?? "externo"}`;
 return { name, identifier: external.identifier || `Contato ${contact.id?.slice(0, 8) ?? "externo"}` };
}
const contactDisplayName = (contact: ContactPresentation, includePhone = true) => contactPresentation(contact, includePhone).name;
export const contactDTO = (r: {
  id: string;
  name: string;
  primaryIdentifier: string;
  providerName?: string | null;
  createdAt: Date;
  updatedAt: Date;
  channelIdentities?: PresentationIdentity[];
}) => ({
  providers: [...new Set(r.channelIdentities?.map((identity) => identity.channel.provider) ?? [])],
  id: r.id,
  name: contactDisplayName(r),
  primaryIdentifier: r.primaryIdentifier,
  displayIdentifier: contactPresentation(r).identifier,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
// Metadata access does not grant access to message content. Reuse the same
// permission and persisted transfer boundary for history, previews and events.
const messageReadFloor = (c: ChatContext, r: Pick<Conversation, "organizationId" | "visibleFromMessage">) =>
  c.organizationId === r.organizationId && c.permissions.includes("messages.read")
    ? c.permissions.includes("conversations.supervise") ? 0n : r.visibleFromMessage
    : null;

export const conversationDTO = (
  r: Conversation & { tags?: { tagId: string }[]; channel?: { provider: string; webConnection?: { outboundEnabled: boolean; mediaEnabled?: boolean; state?: string; errorCode?: string | null; lastCheckedAt?: Date | null } | null } | null; contact?: ContactPresentation; messages?: { body: string | null; sequence: bigint; historical?: boolean; importedAt?: Date }[] },
  c: ChatContext,
  hasUnread = false,
) => {
  const floor = messageReadFloor(c, r);
  const latest = r.messages?.[0];
  return {
    id: r.id,
    contactId: r.contactId,
    hasUnread: floor !== null && hasUnread,
    status: r.status,
    assignedUserId: r.assignedUserId,
    archivedAt: r.archivedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    lastMessageAt: r.lastMessageAt.toISOString(),
    outboundEnabled: r.channel?.provider !== "WHATSAPP_WEB" || !!(c.webOutboundEnabled && r.channel.webConnection?.outboundEnabled && r.channel.webConnection.state === "CONNECTED" && !r.channel.webConnection.errorCode && r.channel.webConnection.lastCheckedAt && r.channel.webConnection.lastCheckedAt.getTime() > Date.now() - 30000),
    mediaEnabled: !!(c.webMediaEnabled && r.channel?.webConnection?.mediaEnabled),
    visibility: r.visibility,
    // Cache invalidation only, never an authorization token. Uses effective
    // message/note boundaries, not mutable lastMessageAt or status metadata.
    readScope: createHash('sha256').update(JSON.stringify([c.organizationId, c.userId, r.id, r.channelId, floor?.toString() ?? null,
      c.permissions.includes('notes.read') ? c.permissions.includes('conversations.supervise') ? '0' : r.visibleFromEvent.toString() : null,
      c.permissions.includes('conversations.supervise') || r.visibility === 'FULL' ? null : r.historyBoundaryAt?.toISOString() ?? null,
      c.permissions.includes('contacts.read')])).digest('hex'),
    tagIds: r.tags?.map((t) => t.tagId) ?? [],
    provider: r.channel?.provider ?? null,
    contactName: r.contact ? contactDisplayName(r.contact, c.permissions.includes("contacts.read")) : null,
    lastMessagePreview: floor !== null && latest && latest.sequence >= floor && (!latest.historical || r.visibility === "FULL" || c.permissions.includes("conversations.supervise") || r.historyBoundaryAt && latest.importedAt && latest.importedAt <= r.historyBoundaryAt)
      ? latest.body : null,
  };
};
const messageAuthors = { sender: { select: { name: true } }, senderContact: { select: contactPresentationSelect } } as const;
export const messageDTO = (r: {
  id: string;
  conversationId: string;
  senderUserId: string | null;
  senderDisplayName?: string | null;
  senderContactId: string | null;
  sender?: { name: string } | null;
  senderContact?: ContactPresentation | null;
  clientMessageId: string | null;
  direction: string;
  type: string;
  body: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  historical?: boolean;
  mediaMetadata?: Prisma.JsonValue | null;
  deliveryOutcome?: string | null;
}, includePhone = true) => ({
  id: r.id,
  conversationId: r.conversationId,
  senderUserId: r.senderUserId,
  senderContactId: r.senderContactId,
  senderName: r.direction === "INBOUND" ? r.senderContact ? contactDisplayName(r.senderContact, includePhone) : null : r.senderUserId ? r.senderDisplayName ?? r.sender?.name ?? null : null,
  clientMessageId: r.clientMessageId,
  direction: r.direction,
  type: r.type,
  body: r.body,
  status: r.status,
  deliveryOutcome: r.deliveryOutcome ?? null,
  historical: r.historical ?? false,
  media: r.mediaMetadata ?? null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
export const noteDTO = (r: {
  id: string;
  authorUserId: string;
  body: string;
  createdAt: Date;
}) => ({
  id: r.id,
  authorUserId: r.authorUserId,
  body: r.body,
  createdAt: r.createdAt.toISOString(),
});
export const tagDTO = (r: { id: string; name: string }) => ({
  id: r.id,
  name: r.name,
});
export class Chat {
  webProvider?: WebProviderPort;
  get outboundExecutionEnabled() { return this.config.PROVIDER_OUTBOUND_ENABLED; }
  get mediaExecutionEnabled() { return this.config.PROVIDER_MEDIA_ENABLED; }
  get historyExecutionEnabled() { return this.config.PROVIDER_HISTORY_EXECUTION_ENABLED; }
  constructor(
    public db: PrismaClient,
    private config: Config,
    private notify: (organizationId: string) => Promise<void>,
    private provider: MessagingProvider,
    private ingestion: MessageIngestionService,
  ) {}
  async context(
    principal: Principal,
    permission: string | string[],
    tx: DB = this.db,
  ): Promise<ChatContext> {
    const organizationId = principal.session.currentOrganizationId;
    if (!organizationId)
      throw new AppError(409, "ORGANIZATION_CONTEXT_REQUIRED");
    const session = await tx.session.findFirst({
      where: {
        id: principal.session.id,
        userId: principal.user.id,
        revokedAt: null,
        currentOrganizationId: organizationId,
        expiresAt: { gt: new Date() },
        lastSeenAt: {
          gt: new Date(Date.now() - this.config.SESSION_IDLE_SECONDS * 1000),
        },
        user: { status: "ACTIVE" },
      },
    });
    if (!session) throw new AppError(401, "UNAUTHENTICATED");
    const m = await tx.membership.findFirst({
      where: {
        userId: principal.user.id,
        organizationId,
        status: "ACTIVE",
        organization: { status: "ACTIVE" },
      },
      include: {
        permissionOverrides: { include: { permission: true } },
        role: { include: { permissions: { include: { permission: true } } } },
      },
    });
    if (!m) throw new AppError(403, "ORGANIZATION_ACCESS_DENIED");
    const permissions = resolvePermissions(m);
    const requiredPermissions = Array.isArray(permission)
      ? permission
      : [permission];
    if (!requiredPermissions.some((required) => permissions.includes(required)))
      throw new AppError(403, "PERMISSION_DENIED");
    return { organizationId, userId: principal.user.id, role: m.role.code, permissions, webOutboundEnabled: this.outboundExecutionEnabled, webMediaEnabled: this.mediaExecutionEnabled };
  }
  async teamMembers(principal: Principal, q: PageQuery = {}) {
    const c = await this.context(principal, [
      "conversations.assign",
      "conversations.transfer",
    ]);
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 100);
    const scope = `team-members:${c.organizationId}`;
    const after = cursorDecode(this.config.ENCRYPTION_KEY, scope, q.cursor);
    const rows = await this.db.membership.findMany({
      where: {
        organizationId: c.organizationId,
        status: "ACTIVE",
        organization: { status: "ACTIVE" },
        user: { status: "ACTIVE" },
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit + 1,
      select: {
        permissionOverrides: { include: { permission: true } },
        id: true,
        displayName: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
          },
        },
        role: {
          select: {
            permissions: {
              select: { permission: { select: { code: true } } },
            },
          },
        },
      },
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      items: page.map((membership) => {
        const permissions = resolvePermissions(membership);
        return {
          userId: membership.user.id,
          name: membership.displayName ?? membership.user.name,
          email: membership.user.email,
          status: "ACTIVE" as const,
          canReceiveAssignment:
            permissions.includes("conversations.read") &&
            permissions.includes("messages.read"),
        };
      }),
      nextCursor:
        hasMore && page.length
          ? cursorEncode(
              this.config.ENCRYPTION_KEY,
              scope,
              page[page.length - 1]!.id,
            )
          : null,
    };
  }
  require(c: ChatContext, p: string) {
    if (!c.permissions.includes(p))
      throw new AppError(403, "PERMISSION_DENIED");
  }
  async conversation(c: ChatContext, id: string, tx: DB = this.db, withPreview = false) {
    this.require(c, "conversations.read");
    const r = await tx.conversation.findFirst({
      include: { tags: true, channel: { select: { provider: true, webConnection: { select: { outboundEnabled: true, mediaEnabled: true, state: true, errorCode: true, lastCheckedAt: true } } } }, contact: { select: contactPresentationSelect }, messages: withPreview && c.permissions.includes("messages.read") ? { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { body: true, sequence: true, historical: true, importedAt: true } } : false },
      where: { id, organizationId: c.organizationId },
    });
    if (
      !r ||
      (c.role === "AGENT" && r.assignedUserId !== c.userId) ||
      (r.assignedUserId &&
        r.assignedUserId !== c.userId &&
        !c.permissions.includes("conversations.supervise"))
    )
      throw new AppError(404, "NOT_FOUND");
    return r;
  }
  private async audit(tx: DB, c: ChatContext, action: string) {
    await tx.auditEvent.create({
      data: { organizationId: c.organizationId, actorUserId: c.userId, action },
    });
  }
  private async event(
    tx: DB,
    c: ChatContext,
    type: ChatEventType,
    entityId: string,
    conversationId?: string,
    messageSequence?: bigint,
    audienceUserId?: string,
  ) {
    return this.resourceEvent(tx, c.organizationId, type, entityId, conversationId, messageSequence, audienceUserId);
  }
  async resourceEvent(
    tx: DB, organizationId: string, type: ChatEventType, entityId: string,
    conversationId?: string, messageSequence?: bigint, audienceUserId?: string,
  ) {
    return tx.realtimeEvent.create({
      data: {
        organizationId,
        type,
        entityId,
        conversationId,
        messageSequence,
        audienceUserId,
        payload: {
          resourceId: entityId,
          ...(conversationId ? { conversationId } : {}),
        },
      },
    });
  }
  /** Trusted integration entry; caller must resolve a tenant-scoped Channel.
   * Uses the same ordering/commit barrier as human Chat operations. */
  async integrationMutation<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>, shouldNotify: (result: T) => boolean = () => true) {
    const result = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Organization WHERE id=${organizationId} FOR UPDATE`;
      const organization = await tx.organization.findFirst({ where: { id: organizationId, status: "ACTIVE" } });
      if (!organization) throw new AppError(403, "ORGANIZATION_ACCESS_DENIED");
      return fn(tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
    if (shouldNotify(result)) await this.notify(organizationId).catch(() => {});
    return result;
  }
  // Per-tenant row lock serializes writes and event allocation through commit.
  // A stream cursor never skips a same-tenant transaction that commits later.
  async mutation<T>(
    p: Principal,
    permission: string | string[],
    fn: (tx: DB, c: ChatContext) => Promise<T>,
  ) {
    const org = p.session.currentOrganizationId;
    if (!org) throw new AppError(409, "ORGANIZATION_CONTEXT_REQUIRED");
    try {
      const result = await this.db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM Organization WHERE id=${org} FOR UPDATE`;
          const c = await this.context(p, permission, tx);
          return fn(tx, c);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          timeout: 15000,
        },
      );
      await this.notify(org).catch(() => {}); // persisted events survive notification failure
      return result;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      )
        throw new AppError(409, "RESOURCE_CONFLICT");
      throw e;
    }
  }
  private scope(c: ChatContext, kind: string, extra = "") {
    return `${c.organizationId}:${c.userId}:${kind}:${extra}`;
  }
  async contacts(p: Principal, q: PageQuery) {
    const c = await this.context(p, "contacts.read"),
      search = q.q?.trim() ?? "",
      scope = this.scope(c, "contacts", search ? JSON.stringify(search) : "");
    const id = cursorDecode(this.config.ENCRYPTION_KEY, scope, q.cursor);
    const limit = q.limit ?? 50;
    const rows = await this.db.contact.findMany({
      where: {
        organizationId: c.organizationId,
        ...(id ? { id: { gt: id } } : {}),
        ...(search ? { OR: [{ name: { contains: search.replace(/[\\%_]/g, "\\$&") } }, { primaryIdentifier: { contains: search.replace(/[\\%_]/g, "\\$&") } }] } : {}),
      },
      include: { channelIdentities: { select: { externalId: true, channel: { select: { provider: true, webConnection: { select: { outboundEnabled: true, mediaEnabled: true, state: true, errorCode: true, lastCheckedAt: true } } } } } } },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return {
      items: rows.slice(0, limit).map(contactDTO),
      nextCursor:
        rows.length > limit
          ? cursorEncode(this.config.ENCRYPTION_KEY, scope, rows[limit - 1]!.id)
          : null,
    };
  }
  async getContact(p: Principal, id: string) {
    const c = await this.context(p, "contacts.read");
    const r = await this.db.contact.findFirst({
      where: { organizationId: c.organizationId, id },
      include: { channelIdentities: { select: { externalId: true, channel: { select: { provider: true, webConnection: { select: { outboundEnabled: true, mediaEnabled: true, state: true, errorCode: true, lastCheckedAt: true } } } } } } },
    });
    if (!r) throw new AppError(404, "NOT_FOUND");
    return contactDTO(r);
  }
  async saveContact(
    p: Principal,
    data: { name?: string; primaryIdentifier?: string },
    id?: string,
  ) {
    return this.mutation(p, "contacts.write", async (tx, c) => {
      if (
        id &&
        !(await tx.contact.findFirst({
          where: { id, organizationId: c.organizationId },
        }))
      )
        throw new AppError(404, "NOT_FOUND");
      const r = id
        ? await tx.contact.update({
            where: {
              organizationId_id: { organizationId: c.organizationId, id },
            },
            data,
            include: { channelIdentities: { select: { externalId: true, channel: { select: { provider: true, webConnection: { select: { outboundEnabled: true, mediaEnabled: true, state: true, errorCode: true, lastCheckedAt: true } } } } } } },
          })
        : await tx.contact.create({
            data: {
              organizationId: c.organizationId,
              name: data.name!,
              primaryIdentifier: data.primaryIdentifier!,
            },
          });
      await this.audit(tx, c, id ? "CONTACT_UPDATED" : "CONTACT_CREATED");
      if (id && data.name !== undefined) {
        const conversations = await tx.conversation.findMany({ where: { organizationId: c.organizationId, contactId: id }, select: { id: true } });
        for (const conversation of conversations) await this.event(tx, c, "conversation.updated", conversation.id, conversation.id);
      }
      return contactDTO(r);
    });
  }
  /** Latest relevant message per conversation in two bounded batched queries.
   * Historical sync and the user's own messages never turn a thread unread.
   * Uses the same tenant and visibility boundaries as message reads. */
  private async unreadFlags(c: ChatContext, threads: Conversation[], tx: DB = this.db): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    if (!c.permissions.includes("messages.read") || !threads.length) return result;
    const ids = threads.map((thread) => thread.id);
    const [checkpoints, latest] = await Promise.all([
      tx.conversationReadState.findMany({
        where: { organizationId: c.organizationId, userId: c.userId, conversationId: { in: ids } },
        select: { conversationId: true, readThroughSequence: true },
      }),
      tx.message.groupBy({
        by: ["conversationId"],
        where: {
          organizationId: c.organizationId,
          conversationId: { in: ids },
          historical: false,
          OR: [{ direction: "INBOUND" }, { direction: "INTERNAL", senderUserId: { not: c.userId } }],
        },
        _max: { sequence: true },
      }),
    ]);
    const read = new Map(checkpoints.map((row) => [row.conversationId, row.readThroughSequence]));
    const incoming = new Map(latest.map((row) => [row.conversationId, row._max.sequence ?? 0n]));
    for (const thread of threads) {
      const floor = messageReadFloor(c, thread);
      if (floor === null) continue;
      const threshold = [read.get(thread.id) ?? 0n, floor > 0n ? floor - 1n : 0n].reduce((max, value) => value > max ? value : max, 0n);
      result.set(thread.id, (incoming.get(thread.id) ?? 0n) > threshold);
    }
    return result;
  }

  /** Monotonic read acknowledgment of a message that was actually retrieved.
   * Never mark future messages read and never emit provider read receipts. */
  async markConversationRead(p: Principal, id: string, messageId: string) {
    return this.mutation(p, "messages.read", async (tx, c) => {
      const thread = await this.conversation(c, id, tx);
      const floor = messageReadFloor(c, thread);
      if (floor === null) throw new AppError(403, "PERMISSION_DENIED");
      const seen = await tx.message.findFirst({
        where: {
          id: messageId, organizationId: c.organizationId, conversationId: id,
          sequence: { gte: floor }, AND: [this.historicalMessageScope(c, thread)],
        },
        select: { sequence: true },
      });
      if (!seen) throw new AppError(404, "MESSAGE_NOT_FOUND");
      const created = await tx.conversationReadState.createMany({
        data: [{ organizationId: c.organizationId, conversationId: id, userId: c.userId, readThroughSequence: seen.sequence }],
        skipDuplicates: true,
      });
      const changed = await tx.conversationReadState.updateMany({
        where: {
          organizationId: c.organizationId, conversationId: id, userId: c.userId,
          readThroughSequence: { lt: seen.sequence },
        },
        data: { readThroughSequence: seen.sequence },
      });
      if (created.count || changed.count) await this.event(tx, c, "conversation.read.updated", id, id, undefined, c.userId);
      const unread = await this.unreadFlags(c, [thread], tx);
      return { conversationId: id, hasUnread: unread.get(id) ?? false };
    });
  }

  async conversations(p: Principal, q: PageQuery) {
    const c = await this.context(p, "conversations.read"),
      filter = q.scope ?? "mine";
    // An AGENT must wait for assignment by OWNER/SUPERVISOR; no free queue visibility.
    if (c.role === "AGENT" && filter !== "mine") throw new AppError(403, "PERMISSION_DENIED");
    if (filter === "all") this.require(c, "conversations.supervise");
    if (
      q.tagId &&
      !(await this.db.tag.findFirst({
        where: { id: q.tagId, organizationId: c.organizationId },
      }))
    )
      throw new AppError(404, "NOT_FOUND");
    if (
      q.contactId &&
      !(await this.db.contact.findFirst({
        where: { id: q.contactId, organizationId: c.organizationId },
      }))
    )
      throw new AppError(404, "NOT_FOUND");
    const scope = this.scope(
      c,
      "conversations",
      JSON.stringify([
        filter,
        !!q.archived,
        q.tagId ?? null,
        q.contactId ?? null,
      ]),
    );
    const decoded = cursorDecode(this.config.ENCRYPTION_KEY, scope, q.cursor);
    let boundary: Prisma.ConversationWhereInput = {};
    if (decoded) {
      try {
        const [t, id] = JSON.parse(decoded) as [string, string];
        const date = new Date(t);
        if (!id || !Number.isFinite(date.getTime())) throw new Error();
        boundary = {
          OR: [
            { lastMessageAt: { lt: date } },
            { lastMessageAt: date, id: { lt: id } },
          ],
        };
      } catch {
        throw new AppError(400, "INVALID_CURSOR");
      }
    }
    const limit = q.limit ?? 50;
    const rows = await this.db.conversation.findMany({
      include: { tags: true, channel: { select: { provider: true, webConnection: { select: { outboundEnabled: true, mediaEnabled: true, state: true, errorCode: true, lastCheckedAt: true } } } }, contact: { select: contactPresentationSelect }, messages: c.permissions.includes("messages.read") ? { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { body: true, sequence: true, historical: true, importedAt: true } } : false },
      where: {
        organizationId: c.organizationId,
        status: q.archived ? "ARCHIVED" : { not: "ARCHIVED" },
        ...(filter !== "all"
          ? { assignedUserId: filter === "mine" ? c.userId : null }
          : {}),
        ...(q.tagId
          ? {
              tags: {
                some: { tagId: q.tagId, organizationId: c.organizationId },
              },
            }
          : {}),
        ...(q.contactId ? { contactId: q.contactId } : {}),
        ...boundary,
      },
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    if (filter === "all")
      await this.audit(this.db, c, "CONVERSATIONS_SUPERVISED");
    const last = rows[limit - 1];
    const flags = await this.unreadFlags(c, rows.slice(0, limit));
    return {
      items: rows.slice(0, limit).map((row) => conversationDTO(row, c, flags.get(row.id))),
      nextCursor:
        rows.length > limit
          ? cursorEncode(
              this.config.ENCRYPTION_KEY,
              scope,
              JSON.stringify([last!.lastMessageAt.toISOString(), last!.id]),
            )
          : null,
    };
  }
  async getConversation(p: Principal, id: string) {
    const c = await this.context(p, "conversations.read"),
      r = await this.conversation(c, id, this.db, true);
    if (c.permissions.includes("conversations.supervise"))
      await this.audit(this.db, c, "CONVERSATION_SUPERVISED");
    const flags = await this.unreadFlags(c, [r]);
    return conversationDTO(r, c, flags.get(r.id));
  }
  async setWebCapabilities(p: Principal, channelId: string, data: { outboundEnabled: boolean; mediaEnabled: boolean }) {
    if (data.outboundEnabled && !this.outboundExecutionEnabled || data.mediaEnabled && !this.mediaExecutionEnabled) throw new AppError(409, "CAPABILITY_DISABLED");
    return this.mutation(p, "providers.manage", async (tx, c) => {
      const row = await tx.providerConnection.findFirst({ where: { organizationId: c.organizationId, channelId, channel: { provider: "WHATSAPP_WEB" } } });
      if (!row) throw new AppError(404, "NOT_FOUND");
      if (data.mediaEnabled && !data.outboundEnabled) throw new AppError(400, "INVALID_CAPABILITY_POLICY");
      await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: c.organizationId, channelId } }, data: { ...data, version: { increment: 1 } } });
      await tx.auditEvent.create({ data: { organizationId: c.organizationId, actorUserId: c.userId, action: "WHATSAPP_WEB_CAPABILITIES_UPDATED", details: { channelId, ...data } } });
      await this.resourceEvent(tx, c.organizationId, "provider.connection.updated", channelId);
      return data;
    });
  }
  async webChannels(p: Principal) {
    const c = await this.context(p, "conversations.create"); this.require(c, "contacts.read");
    return { items: (await this.db.channel.findMany({ where: { organizationId: c.organizationId, provider: "WHATSAPP_WEB" }, include: { webConnection: true } })).map(row => ({ id: row.id, name: "WhatsApp", outboundEnabled: this.outboundExecutionEnabled && row.webConnection?.outboundEnabled === true && row.status === "ENABLED" && row.webConnection.state === "CONNECTED" && !row.webConnection.errorCode, mediaEnabled: this.mediaExecutionEnabled && row.webConnection?.mediaEnabled === true })) };
  }
  async webConnectionReady(tx: DB, organizationId: string, channelId: string) {
    const row = await tx.providerConnection.findFirst({ where: { organizationId, channelId, channel: { provider: "WHATSAPP_WEB", status: "ENABLED" } } });
    if (await tx.providerCommand.count({ where: { organizationId, channelId, action: { in: ["disconnect", "logout"] }, status: { in: ["PENDING", "PROCESSING"] } } })) throw new AppError(409, "CONNECTION_STOP_AUTHORIZED");
    if (!this.outboundExecutionEnabled || !row?.outboundEnabled) throw new AppError(409, "PROVIDER_SEND_UNAVAILABLE");
    if (row.state !== "CONNECTED" || row.errorCode || !row.lastCheckedAt || row.lastCheckedAt.getTime() < Date.now() - 30000) throw new AppError(409, "PROVIDER_UNAVAILABLE");
    return row;
  }
  async createWebConversation(p: Principal, data: { channelId: string; contactId?: string; phone?: string }) {
    const initial = await this.context(p, ["conversations.create", "conversations.read", "contacts.read"]);
    if (initial.role === "AGENT") throw new AppError(403, "PERMISSION_DENIED");
    for (const permission of ["conversations.create", "conversations.read", "contacts.read"]) this.require(initial, permission);
    await this.webConnectionReady(this.db, initial.organizationId, data.channelId);
    if ((!data.contactId) === (!data.phone)) throw new AppError(400, "RECIPIENT_REQUIRED");
    let destination: string;
    if (data.contactId) {
      const person = await this.db.contact.findFirst({ where: { organizationId: initial.organizationId, id: data.contactId }, include: { channelIdentities: { where: { channelId: data.channelId } } } });
      if (!person) throw new AppError(404, "NOT_FOUND");
      const known = person.channelIdentities.find(x => directJidSchema.safeParse(x.externalId).success);
      if (known) destination = known.externalId;
      else {
        if (!internationalPhoneSchema.safeParse(person.primaryIdentifier).success) throw new AppError(409, "RECIPIENT_UNVERIFIED");
        data = { ...data, phone: person.primaryIdentifier };
        destination = "";
      }
    } else destination = "";
    if (!destination) {
      if (!data.contactId) this.require(initial, "contacts.write");
      const phone = internationalPhoneSchema.safeParse(data.phone);
      if (!phone.success) throw new AppError(400, "INVALID_PHONE");
      if (!this.webProvider?.resolveRecipient) throw new AppError(503, "PROVIDER_UNAVAILABLE");
      let result;
      try { result = await this.webProvider.resolveRecipient({ organizationId: initial.organizationId, connectionId: data.channelId }, phone.data); } catch { throw new AppError(503, "RECIPIENT_UNKNOWN"); }
      if (result.state !== "VALID" || !result.jid || !directJidSchema.safeParse(result.jid).success) throw new AppError(409, result.state === "NOT_FOUND" ? "RECIPIENT_NOT_FOUND" : "RECIPIENT_UNKNOWN");
      // onWhatsApp must resolve the queried PN; a LID cannot invent a phone alias.
      if (result.jid !== phone.data.slice(1) + "@s.whatsapp.net") throw new AppError(409, "RECIPIENT_UNKNOWN");
      destination = result.jid;
    }
    return this.mutation(p, ["conversations.create", "conversations.read", "contacts.read"], async (tx, c) => {
      for (const permission of ["conversations.create", "conversations.read", "contacts.read"]) this.require(c, permission);
      if (c.organizationId !== initial.organizationId) throw new AppError(403, "ORGANIZATION_ACCESS_DENIED");
      await this.webConnectionReady(tx, c.organizationId, data.channelId);
      const identity = await tx.contactIdentity.findUnique({ where: { organizationId_channelId_externalId: { organizationId: c.organizationId, channelId: data.channelId, externalId: destination } } });
      if (identity && data.contactId && identity.contactId !== data.contactId) throw new AppError(409, "IDENTITY_MAPPING_CONFLICT");
      let contactId = identity?.contactId ?? data.contactId;
      if (!contactId) {
        this.require(c, "contacts.write");
        const person = await createWebContact(tx, { organizationId: c.organizationId, connectionId: data.channelId }, { externalId: destination });
        contactId = person.id;
      } else if (!await tx.contact.findFirst({ where: { organizationId: c.organizationId, id: contactId } })) throw new AppError(404, "NOT_FOUND");
      if (!identity) await tx.contactIdentity.create({ data: { organizationId: c.organizationId, channelId: data.channelId, contactId, externalId: destination } });
      let row = await tx.conversation.findFirst({ where: { organizationId: c.organizationId, channelId: data.channelId, OR: [{ providerConversationId: destination }, { contactId }] }, include: { channel: { select: { provider: true, webConnection: { select: { outboundEnabled: true, mediaEnabled: true, state: true, errorCode: true, lastCheckedAt: true } } } }, contact: { select: contactPresentationSelect }, tags: true } });
      if (row) { await this.conversation(c, row.id, tx); return { ...conversationDTO(row, c), reused: true }; }
      row = await tx.conversation.create({ data: { organizationId: c.organizationId, channelId: data.channelId, providerConversationId: destination, contactId, assignedUserId: c.userId }, include: { channel: { select: { provider: true, webConnection: { select: { outboundEnabled: true, mediaEnabled: true, state: true, errorCode: true, lastCheckedAt: true } } } }, contact: { select: contactPresentationSelect }, tags: true } });
      await this.audit(tx, c, "EXTERNAL_CONVERSATION_CREATED");
      await this.resourceEvent(tx, c.organizationId, "conversation.created", row.id, row.id);
      return { ...conversationDTO(row, c), reused: false };
    });
  }
  async createConversation(p: Principal, contactId: string, reuseExisting = false) {
    return this.mutation(p, "conversations.create", async (tx, c) => {
      if (c.role === "AGENT") throw new AppError(403, "PERMISSION_DENIED");
      if (
        !(await tx.contact.findFirst({
          where: { id: contactId, organizationId: c.organizationId },
        }))
      )
        throw new AppError(404, "NOT_FOUND");
      if (reuseExisting) {
        this.require(c, "conversations.read");
        const existing = await tx.conversation.findFirst({
          where: { organizationId: c.organizationId, contactId, channelId: null, status: { in: ["OPEN", "PENDING"] },
            ...(c.permissions.includes("conversations.supervise") ? {} : { OR: [{ assignedUserId: c.userId }, { assignedUserId: null }] }),
          },
          include: { contact: { select: contactPresentationSelect }, tags: { select: { tagId: true } } },
          orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
        });
        if (existing) { await this.audit(tx, c, "CONVERSATION_REUSED"); return { ...conversationDTO(existing, c), reused: true }; }
      }
      const r = await tx.conversation.create({
        include: { contact: { select: contactPresentationSelect } },
        data: { organizationId: c.organizationId, contactId },
      });
      await this.audit(tx, c, "CONVERSATION_CREATED");
      await this.event(tx, c, "conversation.created", r.id, r.id);
      return reuseExisting ? { ...conversationDTO(r, c), reused: false } : conversationDTO(r, c);
    });
  }
  async archive(p: Principal, id: string, archived: boolean) {
    return this.mutation(p, "conversations.archive", async (tx, c) => {
      await this.conversation(c, id, tx);
      const r = await tx.conversation.update({
        include: { tags: true, channel: { select: { provider: true, webConnection: { select: { outboundEnabled: true, mediaEnabled: true, state: true, errorCode: true, lastCheckedAt: true } } } }, contact: { select: contactPresentationSelect } },
        where: { organizationId_id: { organizationId: c.organizationId, id } },
        data: {
          status: archived ? "ARCHIVED" : "OPEN",
          archivedAt: archived ? new Date() : null,
        },
      });
      await this.audit(
        tx,
        c,
        archived ? "CONVERSATION_ARCHIVED" : "CONVERSATION_UNARCHIVED",
      );
      await this.event(
        tx,
        c,
        archived ? "conversation.archived" : "conversation.updated",
        id,
        id,
      );
      return conversationDTO(r, c);
    });
  }
  async assign(
    p: Principal,
    id: string,
    data: {
      userId: string;
      visibility?: HistoryVisibility;
      lastN?: number;
      note?: string;
    },
    transfer = false,
  ) {
    return this.mutation(
      p,
      transfer ? "conversations.transfer" : "conversations.assign",
      async (tx, c) => {
        if (c.role === "AGENT") throw new AppError(403, "PERMISSION_DENIED");
        const r = await this.conversation(c, id, tx);
        if (r.status === "ARCHIVED")
          throw new AppError(409, "CONVERSATION_ARCHIVED");
        if (!transfer && r.assignedUserId)
          throw new AppError(409, "TRANSFER_REQUIRED");
        if (transfer && !r.assignedUserId)
          throw new AppError(409, "ASSIGNMENT_REQUIRED");
        if (r.assignedUserId === data.userId)
          throw new AppError(409, "ALREADY_ASSIGNED");
        if (!transfer && data.userId !== c.userId)
          this.require(c, "conversations.supervise");
        const target = await tx.membership.findFirst({
          where: {
            organizationId: c.organizationId,
            userId: data.userId,
            status: "ACTIVE",
            user: { status: "ACTIVE" },
          },
          include: {
            permissionOverrides: { include: { permission: true } },
            role: {
              include: { permissions: { include: { permission: true } } },
            },
          },
        });
        if (!target) throw new AppError(404, "ASSIGNEE_NOT_FOUND");
        const permissions = resolvePermissions(target);
        if (
          !permissions.includes("conversations.read") ||
          !permissions.includes("messages.read")
        )
          throw new AppError(409, "ASSIGNEE_PERMISSION_REQUIRED");
        const visibility = transfer ? data.visibility! : "FULL";
        if (
          !["FULL", "LIMITED", "NONE"].includes(visibility) ||
          (visibility === "LIMITED"
            ? !data.lastN || data.lastN < 1 || data.lastN > 1000
            : data.lastN !== undefined)
        )
          throw new AppError(400, "INVALID_VISIBILITY");
        const newest = await tx.message.findFirst({
          where: { organizationId: c.organizationId, conversationId: id },
          orderBy: { sequence: "desc" },
        });
        let visibleFromMessage = 0n;
        if (visibility === "NONE")
          visibleFromMessage = (newest?.sequence ?? 0n) + 1n;
        if (visibility === "LIMITED") {
          const recent = await tx.message.findMany({
            where: { organizationId: c.organizationId, conversationId: id },
            orderBy: { sequence: "desc" },
            take: data.lastN,
            select: { sequence: true },
          });
          visibleFromMessage =
            recent.at(-1)?.sequence ?? (newest?.sequence ?? 0n) + 1n;
        }
        await tx.conversationAssignmentHistory.create({
          data: {
            organizationId: c.organizationId,
            conversationId: id,
            actorUserId: c.userId,
            fromUserId: r.assignedUserId,
            toUserId: data.userId,
            visibility,
            lastN: visibility === "LIMITED" ? data.lastN : null,
            visibleFromMessage,
            note: data.note,
          },
        });
        const ev = await this.event(
          tx,
          c,
          transfer ? "conversation.transferred" : "conversation.assigned",
          id,
          id,
          undefined,
          transfer ? (r.assignedUserId ?? undefined) : undefined,
        );
        const updated = await tx.conversation.update({
          include: { tags: true, channel: { select: { provider: true, webConnection: { select: { outboundEnabled: true, mediaEnabled: true, state: true, errorCode: true, lastCheckedAt: true } } } }, contact: { select: contactPresentationSelect } },
          where: {
            organizationId_id: { organizationId: c.organizationId, id },
          },
          data: {
            assignedUserId: data.userId,
            visibility,
            visibleFromMessage,
            visibleFromEvent: visibility === "FULL" ? 0n : ev.id,
            historyBoundaryAt: visibility === "FULL" ? null : new Date(),
          },
        });
        if (transfer && data.note) {
          const noteId = crypto.randomUUID();
          const handover = await this.event(tx, c, "note.created", noteId, id);
          await tx.internalNote.create({
            data: {
              id: noteId,
              organizationId: c.organizationId,
              conversationId: id,
              authorUserId: c.userId,
              body: data.note,
              eventSequence: handover.id,
            },
          });
          await this.audit(tx, c, "NOTE_CREATED");
        }
        await this.audit(
          tx,
          c,
          transfer ? "CONVERSATION_TRANSFERRED" : "CONVERSATION_ASSIGNED",
        );
        return conversationDTO(updated, c);
      },
    );
  }
  private historicalMessageScope(c: ChatContext, r: Awaited<ReturnType<Chat['conversation']>>): Prisma.MessageWhereInput {
    return r.channel?.provider === 'WHATSAPP_WEB' && !c.permissions.includes('conversations.supervise') && r.visibility !== 'FULL'
      ? { OR: [{ historical: false }, { historical: true, importedAt: { lte: r.historyBoundaryAt ?? new Date(0) } }] } : {};
  }
  async getMessage(p: Principal, conversationId: string, messageId: string) {
    const c = await this.context(p, 'messages.read'), r = await this.conversation(c, conversationId);
    const floor = messageReadFloor(c, r);
    if (floor === null) throw new AppError(403, 'PERMISSION_DENIED');
    const row = await this.db.message.findFirst({ where: { id: messageId, organizationId: c.organizationId, conversationId, sequence: { gte: floor }, AND: [this.historicalMessageScope(c, r)] }, include: messageAuthors });
    if (!row) throw new AppError(404, 'MESSAGE_NOT_FOUND');
    if (c.permissions.includes('conversations.supervise')) await this.audit(this.db, c, 'MESSAGES_SUPERVISED');
    return messageDTO(row, c.permissions.includes('contacts.read'));
  }
  async messages(p: Principal, id: string, q: PageQuery) {
    const c = await this.context(p, "messages.read"),
      r = await this.conversation(c, id);
    const web = r.channel?.provider === "WHATSAPP_WEB";
    const scope = this.scope(c, web ? "web-message-time" : "messages", id),
      before = cursorDecode(
        this.config.ENCRYPTION_KEY,
        scope,
        q.before ?? q.cursor,
      ),
      limit = q.limit ?? 50;
    const floor = messageReadFloor(c, r);
    if (floor === null) throw new AppError(403, "PERMISSION_DENIED");
    let timeCursor: { createdAt: Date; id: string } | undefined;
    if (web && before) {
      try { const [date, messageId] = JSON.parse(before); if (typeof messageId !== "string" || !/^[a-f0-9-]{36}$/i.test(messageId) || !Number.isFinite(Date.parse(date))) throw new Error(); timeCursor = { createdAt: new Date(date), id: messageId }; }
      catch { throw new AppError(400, "INVALID_CURSOR"); }
    }
    const rows = await this.db.message.findMany({
      where: {
        organizationId: c.organizationId,
        conversationId: id,
        sequence: { gte: floor, ...(!web && before ? { lt: decimal(before) } : {}) },
        AND: [
          this.historicalMessageScope(c, r),
          ...(timeCursor ? [{ OR: [{ createdAt: { lt: timeCursor.createdAt } }, { createdAt: timeCursor.createdAt, id: { lt: timeCursor.id } }] }] : []),
        ],
      },
      orderBy: web ? [{ createdAt: "desc" }, { id: "desc" }] : { sequence: "desc" },
      take: limit + 1,
      include: messageAuthors,
    });
    if (c.permissions.includes("conversations.supervise"))
      await this.audit(this.db, c, "MESSAGES_SUPERVISED");
    return {
      items: rows.slice(0, limit).map((row) => messageDTO(row, c.permissions.includes("contacts.read"))),
      nextCursor:
        rows.length > limit
          ? cursorEncode(
              this.config.ENCRYPTION_KEY,
              scope,
              web ? JSON.stringify([rows[limit - 1]!.createdAt.toISOString(), rows[limit - 1]!.id]) : rows[limit - 1]!.sequence.toString(),
            )
          : null,
    };
  }
  async uploadMedia(p: Principal, conversationId: string, input: MediaUpload, source: AsyncIterable<Uint8Array>, requestId?: string) {
    const meta = mediaUploadSchema.safeParse(input);
    if (!meta.success || !validMediaKind(meta.data.type, meta.data.mimeType) || meta.data.size > mediaLimit(meta.data.type)) throw new AppError(415, "MEDIA_SIZE_OR_TYPE_DENIED");
    const c = await this.context(p, "messages.send"), conversation = await this.conversation(c, conversationId);
    if (conversation.status === "ARCHIVED" || !conversation.channelId) throw new AppError(409, "MEDIA_UNAVAILABLE");
    const connection = await this.webConnectionReady(this.db, c.organizationId, conversation.channelId);
    if (!this.mediaExecutionEnabled || !connection.mediaEnabled || !this.webProvider?.uploadMedia) throw new AppError(409, "MEDIA_DISABLED");
    // Quotas are per actor and organization; aborted uploads expire in Provider.
    if (await this.db.media.count({ where: { organizationId: c.organizationId, expiresAt: { gt: new Date() }, messageId: null } }) >= 64) throw new AppError(429, "MEDIA_QUOTA_EXHAUSTED");
    let result;
    try { result = await this.webProvider.uploadMedia({ organizationId: c.organizationId, connectionId: conversation.channelId }, meta.data, source, requestId); } catch (error) { if (error instanceof WebProviderError && ["MEDIA_BUSY", "MEDIA_MEMORY_PRESSURE", "MEDIA_CACHE_LIMIT", "MEDIA_INTEGRITY_FAILED", "MEDIA_SIZE_MISMATCH", "MEDIA_TYPE_MISMATCH", "MEDIA_CODEC_INVALID", "MEDIA_CODEC_UNAVAILABLE", "MEDIA_TRANSFER_TIMEOUT"].includes(error.code)) throw new AppError(error.status, error.code); throw new AppError(503, "MEDIA_UPLOAD_FAILED"); }
    if (result.mediaId !== meta.data.mediaId || result.type !== meta.data.type || !result.sha256 || result.size > mediaLimit(meta.data.type) || result.state !== "READY") throw new AppError(409, "MEDIA_INTEGRITY_FAILED");
    return this.mutation(p, "messages.send", async (tx, current) => {
      if (current.organizationId !== c.organizationId) throw new AppError(403, "ORGANIZATION_ACCESS_DENIED");
      const thread = await this.conversation(current, conversationId, tx);
      const row = await this.webConnectionReady(tx, current.organizationId, conversation.channelId!);
      if (!row.mediaEnabled || thread.status === "ARCHIVED") throw new AppError(409, "MEDIA_DISABLED");
      await tx.media.create({ data: { id: result.mediaId, organizationId: current.organizationId, channelId: conversation.channelId!, conversationId, actorUserId: current.userId, type: result.type, mimeType: result.mimeType, fileName: result.fileName, size: result.size, sha256: result.sha256!, expiresAt: new Date(Date.now() + 24 * 3600000) } });
      await this.audit(tx, current, "MEDIA_UPLOADED"); return result;
    });
  }
  async messageMedia(p: Principal, conversationId: string, messageId: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const c = await this.context(p, "messages.read"), thread = await this.conversation(c, conversationId);
    const floor = messageReadFloor(c, thread);
    const message = floor === null ? null : await this.db.message.findFirst({ where: { id: messageId, organizationId: c.organizationId, conversationId, sequence: { gte: floor }, ...(thread.channel?.provider === "WHATSAPP_WEB" && !c.permissions.includes("conversations.supervise") && thread.visibility !== "FULL" ? { OR: [{ historical: false }, { historical: true, importedAt: { lte: thread.historyBoundaryAt ?? new Date(0) } }] } : {}) } });
    const meta = mediaReferenceSchema.safeParse(message?.mediaMetadata);
    if (!message?.channelId || !meta.success || meta.data.type === "DOCUMENT" || !mediaUploadSchema.shape.mimeType.safeParse(meta.data.mimeType).success || !validMediaKind(meta.data.type, meta.data.mimeType) || meta.data.size > mediaLimit(meta.data.type) || !this.mediaExecutionEnabled || !this.webProvider?.readMedia) throw new AppError(404, "MEDIA_UNAVAILABLE");
    const connection = await this.db.providerConnection.findFirst({ where: { organizationId: c.organizationId, channelId: message.channelId, mediaEnabled: true } });
    if (!connection) throw new AppError(404, "MEDIA_UNAVAILABLE");
    let result;
    try { result = await this.webProvider.readMedia({ organizationId: c.organizationId, connectionId: message.channelId }, meta.data.mediaId, signal); } catch (reason) { const error = publicMediaError(reason); throw new AppError(error.status, error.code); }
    // Revalidate after demand fetch: organization/assignment may have changed.
    try {
      signal?.throwIfAborted();
      const current = await this.context(p, "messages.read");
      if (current.organizationId !== c.organizationId) throw new AppError(403, "ORGANIZATION_ACCESS_DENIED");
      const currentThread = await this.conversation(current, conversationId), currentFloor = messageReadFloor(current, currentThread);
      if (currentFloor === null || message.sequence < currentFloor || message.historical && currentThread.visibility !== "FULL" && !current.permissions.includes("conversations.supervise") && message.importedAt > (currentThread.historyBoundaryAt ?? new Date(0))) throw new AppError(404, "MEDIA_UNAVAILABLE");
      if (result.size !== meta.data.size || result.sha256 !== meta.data.sha256 || result.mimeType !== meta.data.mimeType) throw new AppError(409, "MEDIA_INTEGRITY_FAILED");
      await this.audit(this.db, current, "MEDIA_VIEWED"); return { ...result, fileName: meta.data.fileName };
    } catch (error) { result.stream.destroy(); throw error; }
  }
  async send(
    p: Principal,
    id: string,
    data: { body: string; clientMessageId: string; mediaId?: string },
  ) {
    return this.mutation(p, "messages.send", async (tx, c) => {
      const r = await this.conversation(c, id, tx);
      const existing = await tx.message.findUnique({
        include: messageAuthors,
        where: {
          organizationId_conversationId_clientMessageId: {
            organizationId: c.organizationId,
            conversationId: id,
            clientMessageId: data.clientMessageId,
          },
        },
      });
      if (existing) {
        if (existing.senderUserId !== c.userId || (existing.type === "TEXT" ? existing.body : existing.body ?? "") !== data.body || (existing.mediaMetadata && typeof existing.mediaMetadata === "object" && !Array.isArray(existing.mediaMetadata) ? existing.mediaMetadata.mediaId : undefined) !== data.mediaId)
          throw new AppError(409, "IDEMPOTENCY_CONFLICT");
        if (
          !c.permissions.includes("conversations.supervise") &&
          existing.sequence < r.visibleFromMessage
        )
          throw new AppError(409, "IDEMPOTENCY_CONFLICT");
        if (existing.status === "FAILED" && existing.deliveryOutcome === "NOT_SENT" && r.channelId) {
          await this.webConnectionReady(tx, c.organizationId, r.channelId);
          if (r.status === "ARCHIVED") throw new AppError(409, "CONVERSATION_ARCHIVED");
          const command = await tx.providerCommand.findFirst({ where: { organizationId: c.organizationId, channelId: r.channelId, action: "send", status: "FAILED", errorCode: "SEND_AUTHORIZATION_FAILED", payload: { path: "$.messageId", equals: existing.id } } });
          const payload = command?.payload as { expiresAt?: string } | undefined;
          if (!command || !payload?.expiresAt || Date.parse(payload.expiresAt) <= Date.now()) throw new AppError(409, "SEND_RETRY_UNAVAILABLE");
          if (data.mediaId && !await tx.media.findFirst({ where: { id: data.mediaId, organizationId: c.organizationId, channelId: r.channelId, conversationId: id, actorUserId: c.userId, messageId: existing.id, expiresAt: { gt: new Date() } } })) throw new AppError(409, "MEDIA_UNAVAILABLE");
          await tx.providerCommand.update({ where: { id: command.id }, data: { status: "PENDING", attempts: 0, errorCode: null, sessionId: p.session.id, nextAttemptAt: new Date() } });
          const retry = await tx.message.update({ where: { id: existing.id }, data: { status: "PENDING", deliveryOutcome: null }, include: messageAuthors });
          await this.resourceEvent(tx, c.organizationId, "message.updated", retry.id, id, retry.sequence);
          await this.audit(tx, c, "MESSAGE_SEND_RETRY_REQUESTED"); return messageDTO(retry);
        }
        return messageDTO(existing);
      }
      if (r.status === "ARCHIVED")
        throw new AppError(409, "CONVERSATION_ARCHIVED");
      // Snapshot the organization-specific author name for every new message.
      const identity = await tx.membership.findFirst({
        where: { organizationId: c.organizationId, userId: c.userId, status: "ACTIVE" },
        select: { displayName: true, user: { select: { name: true } } },
      });
      if (!identity) throw new AppError(403, "ORGANIZATION_ACCESS_DENIED");
      const senderDisplayName = identity.displayName ?? identity.user.name;
      if (r.channelId) {
        const channel = await tx.channel.findFirst({
          where: { id: r.channelId, organizationId: c.organizationId },
        });
        if (channel?.provider === "WHATSAPP_WEB") {
          await this.webConnectionReady(tx, c.organizationId, channel.id);
          if (!directJidSchema.safeParse(r.providerConversationId).success) throw new AppError(409, "RECIPIENT_UNVERIFIED");
          let media: import("zod").infer<typeof mediaReferenceSchema> | undefined;
          if (data.mediaId) {
            const record = await tx.media.findFirst({ where: { id: data.mediaId, organizationId: c.organizationId, channelId: channel.id, conversationId: id, actorUserId: c.userId, expiresAt: { gt: new Date() }, messageId: null } });
            const connection = await this.webConnectionReady(tx, c.organizationId, channel.id);
            if (!record || !this.mediaExecutionEnabled || !connection.mediaEnabled) throw new AppError(409, "MEDIA_UNAVAILABLE");
            media = mediaReferenceSchema.parse({ mediaId: record.id, type: record.type, mimeType: record.mimeType, fileName: record.fileName, size: record.size, sha256: record.sha256, state: "READY" });
          }
          const providerMessageId = randomUUID().replaceAll("-", "").toUpperCase();
          const transmittedBody = outboundSignature(data.body, senderDisplayName, !!media);
          const message = await tx.message.create({ include: messageAuthors, data: { organizationId: c.organizationId, conversationId: id, channelId: channel.id, senderUserId: c.userId, senderDisplayName, clientMessageId: data.clientMessageId, providerMessageId, direction: "OUTBOUND", body: media && !data.body ? null : data.body, transmittedBody, status: "PENDING", ...(media ? { type: media.type, mediaMetadata: media } : {}) } });
          if (media) await tx.media.update({ where: { id: media.mediaId }, data: { messageId: message.id } });
          await tx.providerCommand.create({ data: { id: randomUUID(), organizationId: c.organizationId, channelId: channel.id, actorUserId: c.userId, sessionId: p.session.id, action: "send", payload: { messageId: message.id, expiresAt: new Date(Date.now() + 6 * 86400000).toISOString() } } });
          await tx.conversation.update({ where: { organizationId_id: { organizationId: c.organizationId, id } }, data: { lastMessageAt: message.createdAt } });
          await this.resourceEvent(tx, c.organizationId, "message.created", message.id, id, message.sequence);
          await this.resourceEvent(tx, c.organizationId, "conversation.updated", id, id);
          await this.audit(tx, c, "MESSAGE_SEND_QUEUED");
          return messageDTO(message);
        }
        if (!channel || channel.provider !== "DEMO" || channel.status !== "ENABLED")
          throw new AppError(409, "PROVIDER_DISABLED");
      }
      if (data.mediaId) throw new AppError(409, "MEDIA_DISABLED");
      const providerReceipt = r.channelId
        ? await this.provider.sendText({
            organizationId: c.organizationId,
            channelId: r.channelId,
            providerConversationId: r.providerConversationId ?? r.id,
            clientMessageId: data.clientMessageId,
            body: data.body,
          })
        : null;
      const message = await tx.message.create({
        include: messageAuthors,
        data: {
          organizationId: c.organizationId,
          conversationId: id,
          senderUserId: c.userId,
          senderDisplayName,
          clientMessageId: data.clientMessageId,
          ...(r.channelId
            ? {
                channelId: r.channelId,
                direction: "OUTBOUND",
                providerMessageId: providerReceipt!.providerMessageId,
              }
            : {}),
          body: data.body,
          status: "SENT",
        },
      });
      await tx.conversation.update({
        where: { organizationId_id: { organizationId: c.organizationId, id } },
        data: { lastMessageAt: message.createdAt },
      });
      await this.event(
        tx,
        c,
        "message.created",
        message.id,
        id,
        message.sequence,
      );
      await this.event(tx, c, "conversation.updated", id, id);
      await this.audit(tx, c, "MESSAGE_SENT");
      return messageDTO(message);
    });
  }
  async messageStatus(
    p: Principal,
    id: string,
    messageId: string,
    status: "DELIVERED" | "READ",
  ) {
    return this.mutation(p, "messages.read", async (tx, c) => {
      const r = await this.conversation(c, id, tx);
      const floor = messageReadFloor(c, r);
      if (floor === null) throw new AppError(403, "PERMISSION_DENIED");
      const m = await tx.message.findFirst({
        include: messageAuthors,
        where: {
          id: messageId,
          organizationId: c.organizationId,
          conversationId: id,
          sequence: {
            gte: floor,
          },
        },
      });
      if (!m) throw new AppError(404, "NOT_FOUND");
      if (m.direction !== "INTERNAL")
        throw new AppError(409, "EXTERNAL_RECEIPT_UNSUPPORTED");
      const rank = { PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: -1 };
      if (
        rank[m.status] > rank[status] ||
        m.status === "FAILED" ||
        m.status === "PENDING"
      )
        throw new AppError(409, "INVALID_MESSAGE_TRANSITION");
      if (m.status === status) return messageDTO(m);
      const updated = await tx.message.update({
        include: messageAuthors,
        where: { id: m.id },
        data: { status },
      });
      await this.event(tx, c, "message.updated", m.id, id, m.sequence);
      await this.audit(tx, c, "MESSAGE_STATUS_UPDATED");
      return messageDTO(updated);
    });
  }
  async tags(p: Principal, q: PageQuery) {
    const c = await this.context(p, "tags.read"),
      scope = this.scope(c, "tags"),
      after = cursorDecode(this.config.ENCRYPTION_KEY, scope, q.cursor),
      limit = q.limit ?? 50;
    const rows = await this.db.tag.findMany({
      where: {
        organizationId: c.organizationId,
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return {
      items: rows.slice(0, limit).map(tagDTO),
      nextCursor:
        rows.length > limit
          ? cursorEncode(this.config.ENCRYPTION_KEY, scope, rows[limit - 1]!.id)
          : null,
    };
  }
  async saveTag(p: Principal, name: string, id?: string, remove = false) {
    return this.mutation(p, "tags.manage", async (tx, c) => {
      if (
        id &&
        !(await tx.tag.findFirst({
          where: { id, organizationId: c.organizationId },
        }))
      )
        throw new AppError(404, "NOT_FOUND");
      // Explicit per-conversation removals keep filtered clients coherent after deletion.
      if (remove) {
        const links = await tx.conversationTag.findMany({
          where: { organizationId: c.organizationId, tagId: id },
        });
        for (const link of links)
          await this.event(
            tx,
            c,
            "conversation.tag.removed",
            id!,
            link.conversationId,
          );
      }
      const r = remove
        ? await tx.tag.delete({
            where: {
              organizationId_id: { organizationId: c.organizationId, id: id! },
            },
          })
        : id
          ? await tx.tag.update({
              where: {
                organizationId_id: { organizationId: c.organizationId, id },
              },
              data: { name },
            })
          : await tx.tag.create({
              data: { organizationId: c.organizationId, name },
            });
      await this.audit(
        tx,
        c,
        remove ? "TAG_DELETED" : id ? "TAG_UPDATED" : "TAG_CREATED",
      );
      await this.event(
        tx,
        c,
        remove ? "tag.deleted" : id ? "tag.updated" : "tag.created",
        r.id,
      );
      return tagDTO(r);
    });
  }
  async conversationTag(
    p: Principal,
    id: string,
    tagId: string,
    remove = false,
  ) {
    return this.mutation(p, "tags.manage", async (tx, c) => {
      await this.conversation(c, id, tx);
      if (
        !(await tx.tag.findFirst({
          where: { id: tagId, organizationId: c.organizationId },
        }))
      )
        throw new AppError(404, "NOT_FOUND");
      const key = {
        organizationId: c.organizationId,
        conversationId: id,
        tagId,
      };
      if (remove) await tx.conversationTag.deleteMany({ where: key });
      else
        await tx.conversationTag.upsert({
          where: { organizationId_conversationId_tagId: key },
          create: key,
          update: {},
        });
      await this.audit(
        tx,
        c,
        remove ? "CONVERSATION_TAG_REMOVED" : "CONVERSATION_TAG_ADDED",
      );
      await this.event(
        tx,
        c,
        remove ? "conversation.tag.removed" : "conversation.tag.added",
        tagId,
        id,
      );
      return { tagId };
    });
  }
  async notes(p: Principal, id: string, q: PageQuery) {
    const c = await this.context(p, "notes.read"),
      r = await this.conversation(c, id);
    const scope = this.scope(c, "notes", id),
      after = cursorDecode(this.config.ENCRYPTION_KEY, scope, q.cursor),
      limit = q.limit ?? 50;
    const floor = c.permissions.includes("conversations.supervise")
      ? 0n
      : r.visibleFromEvent;
    const rows = await this.db.internalNote.findMany({
      where: {
        organizationId: c.organizationId,
        conversationId: id,
        eventSequence: { gte: floor, ...(after ? { gt: decimal(after) } : {}) },
      },
      orderBy: { eventSequence: "asc" },
      take: limit + 1,
    });
    if (c.permissions.includes("conversations.supervise"))
      await this.audit(this.db, c, "NOTES_SUPERVISED");
    return {
      items: rows.slice(0, limit).map(noteDTO),
      nextCursor:
        rows.length > limit
          ? cursorEncode(
              this.config.ENCRYPTION_KEY,
              scope,
              rows[limit - 1]!.eventSequence.toString(),
            )
          : null,
    };
  }
  async createNote(p: Principal, id: string, body: string) {
    return this.mutation(p, "notes.create", async (tx, c) => {
      await this.conversation(c, id, tx);
      const noteId = crypto.randomUUID();
      const ev = await this.event(tx, c, "note.created", noteId, id);
      const note = await tx.internalNote.create({
        data: {
          id: noteId,
          organizationId: c.organizationId,
          conversationId: id,
          authorUserId: c.userId,
          body,
          eventSequence: ev.id,
        },
      });
      await this.audit(tx, c, "NOTE_CREATED");
      return noteDTO(note);
    });
  }
  async providerCatalog(p: Principal) {
    const c = await this.context(p, "providers.manage");
    const channel = await this.db.channel.findUnique({
      where: { organizationId_provider: { organizationId: c.organizationId, provider: "DEMO" } },
      select: { status: true },
    });
    const web = this.config.PROVIDER_WEB_ENABLED ? await this.db.providerConnection.findFirst({ where: { organizationId: c.organizationId, channel: { provider: "WHATSAPP_WEB" } }, select: { state: true } }) : null;
    return { items: [
      { code: "DEMO", name: "Demo Provider", description: "Canal de demonstração com contatos simulados.", state: "AVAILABLE", enabled: channel?.status === "ENABLED" },
      { code: "META", name: "Meta", description: "Integração em desenvolvimento.", state: "IN_DEVELOPMENT", enabled: false },
      ...(this.config.PROVIDER_WEB_ENABLED ? [{ code: "WHATSAPP_WEB", name: "WhatsApp Web", description: "Conexão por QR Code usando protocolo não oficial.", state: "AVAILABLE", enabled: web?.state === "CONNECTED" }] : []),
    ] };
  }
  async setDemoProvider(p: Principal, enabled: boolean) {
    return this.mutation(p, "providers.manage", async (tx, c) => {
      const channel = await tx.channel.upsert({
        where: { organizationId_provider: { organizationId: c.organizationId, provider: "DEMO" } },
        create: { organizationId: c.organizationId, provider: "DEMO", status: enabled ? "ENABLED" : "DISABLED" },
        update: { status: enabled ? "ENABLED" : "DISABLED" },
      });
      if (enabled) {
        let provisioned = false;
        const fixtures = [
          { externalId: "demo-contact-01", providerConversationId: "demo-conversation-01", providerMessageId: "demo-initial-01-v1", name: "Contato Demo 01", identifier: "demo:contact-01", body: "Olá! Gostaria de saber mais sobre os serviços de vocês." },
          { externalId: "demo-contact-02", providerConversationId: "demo-conversation-02", providerMessageId: "demo-initial-02-v1", name: "Contato Demo 02", identifier: "demo:contact-02", body: "Bom dia! Preciso de ajuda com um problema." },
        ];
        for (const fixture of fixtures) {
          let identity = await tx.contactIdentity.findUnique({
            where: { organizationId_channelId_externalId: { organizationId: c.organizationId, channelId: channel.id, externalId: fixture.externalId } },
          });
          if (!identity) {
            const contact = await tx.contact.create({ data: { organizationId: c.organizationId, name: fixture.name, primaryIdentifier: fixture.identifier } });
            identity = await tx.contactIdentity.create({ data: { organizationId: c.organizationId, channelId: channel.id, contactId: contact.id, externalId: fixture.externalId } });
            provisioned = true;
          }
          let conversation = await tx.conversation.findFirst({
            where: { organizationId: c.organizationId, channelId: channel.id, providerConversationId: fixture.providerConversationId },
          });
          if (!conversation) {
            conversation = await tx.conversation.create({ data: { organizationId: c.organizationId, contactId: identity.contactId, channelId: channel.id, providerConversationId: fixture.providerConversationId } });
            await this.event(tx, c, "conversation.created", conversation.id, conversation.id);
            provisioned = true;
          }
          const normalized = this.provider.parseInbound({ externalMessageId: fixture.providerMessageId, body: fixture.body });
          const initial = await tx.message.findFirst({ where: { organizationId: c.organizationId, channelId: channel.id, providerMessageId: normalized.providerMessageId } });
          if (!initial) {
            const message = await this.ingestion.persistInbound(tx, { organizationId: c.organizationId, conversationId: conversation.id, contactId: identity.contactId, channelId: channel.id, providerMessageId: normalized.providerMessageId, body: normalized.body });
            await this.event(tx, c, "message.created", message.id, conversation.id, message.sequence);
            await this.event(tx, c, "conversation.updated", conversation.id, conversation.id);
            provisioned = true;
          }
        }
        if (provisioned) await this.audit(tx, c, "DEMO_FIXTURES_PROVISIONED");
        await this.audit(tx, c, "DEMO_PROVIDER_ENABLED");
      } else {
        await this.audit(tx, c, "DEMO_PROVIDER_DISABLED");
      }
      return { enabled: channel.status === "ENABLED" };
    });
  }
  async demoContacts(p: Principal) {
    const c = await this.context(p, "providers.simulate");
    const channel = await this.db.channel.findUnique({
      where: { organizationId_provider: { organizationId: c.organizationId, provider: "DEMO" } },
      select: { id: true, status: true },
    });
    if (!channel) return { enabled: false, items: [] };
    const identities = await this.db.contactIdentity.findMany({
      where: { organizationId: c.organizationId, channelId: channel.id },
      include: { contact: { select: { id: true, name: true } } },
      orderBy: { externalId: "asc" },
    });
    const items = await Promise.all(identities.map(async (identity) => {
      const conversation = await this.db.conversation.findFirst({
        where: { organizationId: c.organizationId, channelId: channel.id, contactId: identity.contactId },
        select: { id: true },
      });
      return { contactId: identity.contactId, name: identity.contact.name, conversationId: conversation?.id ?? null };
    }));
    return { enabled: channel.status === "ENABLED", items };
  }
  async receiveDemoMessage(p: Principal, data: { contactId: string; externalMessageId: string; body: string }) {
    return this.mutation(p, "providers.simulate", async (tx, c) => {
      const channel = await tx.channel.findUnique({ where: { organizationId_provider: { organizationId: c.organizationId, provider: "DEMO" } } });
      if (!channel || channel.provider !== this.provider.code || channel.status !== "ENABLED") throw new AppError(409, "PROVIDER_DISABLED");
      const identity = await tx.contactIdentity.findFirst({ where: { organizationId: c.organizationId, channelId: channel.id, contactId: data.contactId } });
      if (!identity) throw new AppError(404, "NOT_FOUND");
      const conversation = await tx.conversation.findFirst({ where: { organizationId: c.organizationId, channelId: channel.id, contactId: identity.contactId } });
      if (!conversation) throw new AppError(404, "NOT_FOUND");
      const inbound = this.provider.parseInbound(data);
      const existing = await tx.message.findFirst({ include: messageAuthors, where: { organizationId: c.organizationId, channelId: channel.id, providerMessageId: inbound.providerMessageId } });
      if (existing) {
        if (existing.conversationId !== conversation.id || existing.body !== inbound.body) throw new AppError(409, "IDEMPOTENCY_CONFLICT");
        return messageDTO(existing);
      }
      const message = await this.ingestion.persistInbound(tx, { organizationId: c.organizationId, conversationId: conversation.id, contactId: identity.contactId, channelId: channel.id, providerMessageId: inbound.providerMessageId, body: inbound.body });
      await this.event(tx, c, "message.created", message.id, conversation.id, message.sequence);
      await this.event(tx, c, "conversation.updated", conversation.id, conversation.id);
      await this.audit(tx, c, "DEMO_MESSAGE_RECEIVED");
      return messageDTO(message);
    });
  }
  async eventVisible(c: ChatContext, e: RealtimeEvent) {
    if (
      e.organizationId !== c.organizationId ||
      !chatEventTypes.includes(e.type as ChatEventType)
    )
      return false;
    if (e.type === "provider.connection.updated") return c.permissions.includes("providers.manage");
    if (e.type === "contacts.updated") return c.permissions.includes("contacts.read");
    // Former assignee receives only this identifier invalidation, never new content.
    if (
      e.type === "conversation.transferred" &&
      e.audienceUserId === c.userId &&
      c.permissions.includes("conversations.read")
    )
      return true;
    if (e.type.startsWith("tag.")) return c.permissions.includes("tags.read");
    if (!e.conversationId) return false;
    let r: Conversation;
    try {
      r = await this.conversation(c, e.conversationId);
    } catch (err) {
      if (err instanceof AppError && [403, 404].includes(err.status))
        return false;
      throw err;
    }
    const superView = c.permissions.includes("conversations.supervise");
    if (e.type.startsWith("message.")) {
      const floor = messageReadFloor(c, r);
      return floor !== null && (superView ||
        (e.messageSequence !== null && e.messageSequence >= floor));
    }
    if (e.type === "note.created")
      return (
        c.permissions.includes("notes.read") &&
        (superView || e.id >= r.visibleFromEvent)
      );
    if (e.type.startsWith("conversation.tag."))
      return c.permissions.includes("tags.read");
    return true;
  }
  async stream(p: Principal, after: string = "0", limit = 100, providersOnly = false, contactsOnly = false) {
    const c = await this.context(p, providersOnly ? "providers.manage" : contactsOnly ? "contacts.read" : "conversations.read"),
      id = decimal(after);
    const rows = await this.db.realtimeEvent.findMany({
      where: { organizationId: c.organizationId, id: { gt: id } },
      orderBy: { id: "asc" },
      take: limit,
    });
    if (rows.length && c.permissions.includes("conversations.supervise"))
      await this.audit(this.db, c, "REALTIME_SUPERVISED");
    const events = [];
    for (const e of rows)
      if ((!providersOnly || e.type === "provider.connection.updated") && (!contactsOnly || e.type === "contacts.updated") && await this.eventVisible(c, e))
        events.push({
          version: 1,
          eventId: e.id.toString(),
          organizationId: e.organizationId,
          type: e.type,
          entityId: e.entityId,
          occurredAt: e.createdAt.toISOString(),
          payload: e.payload,
        });
    return {
      events,
      lastEventId: rows.at(-1)?.id.toString() ?? after,
      hasMore: rows.length === limit,
    };
  }
}
