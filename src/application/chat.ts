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
export const conversationDTO = (
  r: Conversation & { tags?: { tagId: string }[] },
) => ({
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
});
export const messageDTO = (r: {
  id: string;
  conversationId: string;
  senderUserId: string | null;
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
  async conversation(c: ChatContext, id: string, tx: DB = this.db) {
    this.require(c, "conversations.read");
    const r = await tx.conversation.findFirst({
      include: { tags: true },
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
      include: { tags: true },
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
      items: rows.slice(0, limit).map(conversationDTO),
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
      r = await this.conversation(c, id);
    if (c.permissions.includes("conversations.supervise"))
      await this.audit(this.db, c, "CONVERSATION_SUPERVISED");
    return conversationDTO(r);
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
        data: { organizationId: c.organizationId, contactId },
      });
      await this.audit(tx, c, "CONVERSATION_CREATED");
      await this.event(tx, c, "conversation.created", r.id, r.id);
      return conversationDTO(r);
    });
  }
  async archive(p: Principal, id: string, archived: boolean) {
    return this.mutation(p, "conversations.archive", async (tx, c) => {
      await this.conversation(c, id, tx);
      const r = await tx.conversation.update({
        include: { tags: true },
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
      return conversationDTO(r);
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
          include: { tags: true },
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
        return conversationDTO(updated);
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
    const floor = c.permissions.includes("conversations.supervise")
      ? 0n
      : r.visibleFromMessage;
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
      const message = await tx.message.create({
        data: {
          organizationId: c.organizationId,
          conversationId: id,
          senderUserId: c.userId,
          clientMessageId: data.clientMessageId,
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
      const m = await tx.message.findFirst({
        where: {
          id: messageId,
          organizationId: c.organizationId,
          conversationId: id,
          sequence: {
            gte: c.permissions.includes("conversations.supervise")
              ? 0n
              : r.visibleFromMessage,
          },
        },
      });
      if (!m) throw new AppError(404, "NOT_FOUND");
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
    if (e.type.startsWith("message."))
      return (
        c.permissions.includes("messages.read") &&
        (superView ||
          (e.messageSequence !== null &&
            e.messageSequence >= r.visibleFromMessage))
      );
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
