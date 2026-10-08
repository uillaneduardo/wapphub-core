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
  permissions: string[];
};
export type PageQuery = {
  limit?: number;
  cursor?: string;
  before?: string;
  scope?: "mine" | "unassigned" | "all";
  archived?: boolean;
  tagId?: string;
  contactId?: string;
};
export const contactDTO = (r: {
  id: string;
  name: string;
  primaryIdentifier: string;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: r.id,
  name: r.name,
  primaryIdentifier: r.primaryIdentifier,
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
  r: Conversation & { tags?: { tagId: string }[]; channel?: { provider: string } | null; contact?: { name: string }; messages?: { body: string | null; sequence: bigint }[] },
  c: ChatContext,
) => {
  const floor = messageReadFloor(c, r);
  const latest = r.messages?.[0];
  return {
    id: r.id,
    contactId: r.contactId,
    status: r.status,
    assignedUserId: r.assignedUserId,
    archivedAt: r.archivedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    lastMessageAt: r.lastMessageAt.toISOString(),
    visibility: r.visibility,
    tagIds: r.tags?.map((t) => t.tagId) ?? [],
    provider: r.channel?.provider ?? null,
    contactName: r.contact?.name ?? null,
    lastMessagePreview: floor !== null && latest && latest.sequence >= floor
      ? latest.body : null,
  };
};
export const messageDTO = (r: {
  id: string;
  conversationId: string;
  senderUserId: string | null;
  senderContactId: string | null;
  clientMessageId: string | null;
  direction: string;
  type: string;
  body: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: r.id,
  conversationId: r.conversationId,
  senderUserId: r.senderUserId,
  senderContactId: r.senderContactId,
  clientMessageId: r.clientMessageId,
  direction: r.direction,
  type: r.type,
  body: r.body,
  status: r.status,
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
        role: { include: { permissions: { include: { permission: true } } } },
      },
    });
    if (!m) throw new AppError(403, "ORGANIZATION_ACCESS_DENIED");
    const permissions = m.role.permissions.map((x) => x.permission.code);
    const requiredPermissions = Array.isArray(permission)
      ? permission
      : [permission];
    if (!requiredPermissions.some((required) => permissions.includes(required)))
      throw new AppError(403, "PERMISSION_DENIED");
    return { organizationId, userId: principal.user.id, permissions };
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
        id: true,
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
        const permissions = membership.role.permissions.map(
          (entry) => entry.permission.code,
        );
        return {
          userId: membership.user.id,
          name: membership.user.name,
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
      include: { tags: true, channel: { select: { provider: true } }, contact: { select: { name: true } }, messages: withPreview && c.permissions.includes("messages.read") ? { orderBy: { sequence: "desc" }, take: 1, select: { body: true, sequence: true } } : false },
      where: { id, organizationId: c.organizationId },
    });
    if (
      !r ||
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
    return tx.realtimeEvent.create({
      data: {
        organizationId: c.organizationId,
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
  // Per-tenant row lock serializes writes and event allocation through commit.
  // A stream cursor never skips a same-tenant transaction that commits later.
  async mutation<T>(
    p: Principal,
    permission: string,
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
      scope = this.scope(c, "contacts");
    const id = cursorDecode(this.config.ENCRYPTION_KEY, scope, q.cursor);
    const limit = q.limit ?? 50;
    const rows = await this.db.contact.findMany({
      where: {
        organizationId: c.organizationId,
        ...(id ? { id: { gt: id } } : {}),
      },
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
          })
        : await tx.contact.create({
            data: {
              organizationId: c.organizationId,
              name: data.name!,
              primaryIdentifier: data.primaryIdentifier!,
            },
          });
      await this.audit(tx, c, id ? "CONTACT_UPDATED" : "CONTACT_CREATED");
      return contactDTO(r);
    });
  }
  async conversations(p: Principal, q: PageQuery) {
    const c = await this.context(p, "conversations.read"),
      filter = q.scope ?? "mine";
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
      include: { tags: true, channel: { select: { provider: true } }, contact: { select: { name: true } }, messages: c.permissions.includes("messages.read") ? { orderBy: { sequence: "desc" }, take: 1, select: { body: true, sequence: true } } : false },
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
    return {
      items: rows.slice(0, limit).map((row) => conversationDTO(row, c)),
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
    return conversationDTO(r, c);
  }
  async createConversation(p: Principal, contactId: string) {
    return this.mutation(p, "conversations.create", async (tx, c) => {
      if (
        !(await tx.contact.findFirst({
          where: { id: contactId, organizationId: c.organizationId },
        }))
      )
        throw new AppError(404, "NOT_FOUND");
      const r = await tx.conversation.create({
        include: { contact: { select: { name: true } } },
        data: { organizationId: c.organizationId, contactId },
      });
      await this.audit(tx, c, "CONVERSATION_CREATED");
      await this.event(tx, c, "conversation.created", r.id, r.id);
      return conversationDTO(r, c);
    });
  }
  async archive(p: Principal, id: string, archived: boolean) {
    return this.mutation(p, "conversations.archive", async (tx, c) => {
      await this.conversation(c, id, tx);
      const r = await tx.conversation.update({
        include: { tags: true, channel: { select: { provider: true } }, contact: { select: { name: true } } },
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
            role: {
              include: { permissions: { include: { permission: true } } },
            },
          },
        });
        if (!target) throw new AppError(404, "ASSIGNEE_NOT_FOUND");
        const permissions = target.role.permissions.map(
          (x) => x.permission.code,
        );
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
          include: { tags: true, channel: { select: { provider: true } }, contact: { select: { name: true } } },
          where: {
            organizationId_id: { organizationId: c.organizationId, id },
          },
          data: {
            assignedUserId: data.userId,
            visibility,
            visibleFromMessage,
            visibleFromEvent: visibility === "FULL" ? 0n : ev.id,
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
  async messages(p: Principal, id: string, q: PageQuery) {
    const c = await this.context(p, "messages.read"),
      r = await this.conversation(c, id);
    const scope = this.scope(c, "messages", id),
      before = cursorDecode(
        this.config.ENCRYPTION_KEY,
        scope,
        q.before ?? q.cursor,
      ),
      limit = q.limit ?? 50;
    const floor = messageReadFloor(c, r);
    if (floor === null) throw new AppError(403, "PERMISSION_DENIED");
    const rows = await this.db.message.findMany({
      where: {
        organizationId: c.organizationId,
        conversationId: id,
        sequence: { gte: floor, ...(before ? { lt: decimal(before) } : {}) },
      },
      orderBy: { sequence: "desc" },
      take: limit + 1,
    });
    if (c.permissions.includes("conversations.supervise"))
      await this.audit(this.db, c, "MESSAGES_SUPERVISED");
    return {
      items: rows.slice(0, limit).map(messageDTO),
      nextCursor:
        rows.length > limit
          ? cursorEncode(
              this.config.ENCRYPTION_KEY,
              scope,
              rows[limit - 1]!.sequence.toString(),
            )
          : null,
    };
  }
  async send(
    p: Principal,
    id: string,
    data: { body: string; clientMessageId: string },
  ) {
    return this.mutation(p, "messages.send", async (tx, c) => {
      const r = await this.conversation(c, id, tx);
      const existing = await tx.message.findUnique({
        where: {
          organizationId_conversationId_clientMessageId: {
            organizationId: c.organizationId,
            conversationId: id,
            clientMessageId: data.clientMessageId,
          },
        },
      });
      if (existing) {
        if (existing.senderUserId !== c.userId || existing.body !== data.body)
          throw new AppError(409, "IDEMPOTENCY_CONFLICT");
        if (
          !c.permissions.includes("conversations.supervise") &&
          existing.sequence < r.visibleFromMessage
        )
          throw new AppError(409, "IDEMPOTENCY_CONFLICT");
        return messageDTO(existing);
      }
      if (r.status === "ARCHIVED")
        throw new AppError(409, "CONVERSATION_ARCHIVED");
      if (r.channelId) {
        const channel = await tx.channel.findFirst({
          where: { id: r.channelId, organizationId: c.organizationId },
        });
        if (!channel || channel.provider !== "DEMO" || channel.status !== "ENABLED")
          throw new AppError(409, "PROVIDER_DISABLED");
      }
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
        data: {
          organizationId: c.organizationId,
          conversationId: id,
          senderUserId: c.userId,
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
    return { items: [
      { code: "DEMO", name: "Demo Provider", description: "Canal de demonstração com contatos simulados.", state: "AVAILABLE", enabled: channel?.status === "ENABLED" },
      { code: "META", name: "Meta", description: "Integração em desenvolvimento.", state: "IN_DEVELOPMENT", enabled: false },
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
      const existing = await tx.message.findFirst({ where: { organizationId: c.organizationId, channelId: channel.id, providerMessageId: inbound.providerMessageId } });
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
  async stream(p: Principal, after: string = "0", limit = 100) {
    const c = await this.context(p, "conversations.read"),
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
      if (await this.eventVisible(c, e))
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
