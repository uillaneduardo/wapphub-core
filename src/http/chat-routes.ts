import { chatEventTypes } from "../realtime/contract.js";
import type { FastifyInstance, FastifyRequest, FastifySchema } from "fastify";
import type { HistoryVisibility } from "@prisma/client";
import type { Foundation } from "../application/foundation.js";
import type { Chat, PageQuery } from "../application/chat.js";
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({
  type: "object",
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {}),
});
const str = { type: "string" },
  uuid = { type: "string", format: "uuid" },
  date = { type: "string", format: "date-time" },
  nullableId = { anyOf: [uuid, { type: "null" }] },
  nullableDate = { anyOf: [date, { type: "null" }] };
const error = obj({ error: obj({ code: str, requestId: str }) });
const contact = obj({
  id: uuid,
  name: str,
  primaryIdentifier: str,
  createdAt: date,
  updatedAt: date,
});
const conversation = obj({
  tagIds: { type: "array", items: uuid },
  provider: { anyOf: [{ type: "string", enum: ["DEMO", "META"] }, { type: "null" }] },
  contactName: { anyOf: [str, { type: "null" }] },
  lastMessagePreview: { anyOf: [str, { type: "null" }] },
  id: uuid,
  contactId: uuid,
  status: { type: "string", enum: ["OPEN", "PENDING", "ARCHIVED"] },
  assignedUserId: nullableId,
  archivedAt: nullableDate,
  createdAt: date,
  updatedAt: date,
  lastMessageAt: date,
  visibility: { type: "string", enum: ["FULL", "LIMITED", "NONE"] },
});
const message = obj({
  id: uuid,
  conversationId: uuid,
  senderUserId: nullableId,
  senderContactId: nullableId,
  clientMessageId: { type: ["string", "null"] },
  direction: { type: "string", enum: ["INTERNAL", "INBOUND", "OUTBOUND"] },
  type: { type: "string", enum: ["TEXT"] },
  body: { type: ["string", "null"] },
  status: {
    type: "string",
    enum: ["PENDING", "SENT", "DELIVERED", "READ", "FAILED"],
  },
  createdAt: date,
  updatedAt: date,
});
const note = obj({ id: uuid, authorUserId: uuid, body: str, createdAt: date }),
  tag = obj({ id: uuid, name: str }),
  teamMember = obj({
    userId: uuid,
    name: str,
    email: { type: "string", format: "email" },
    status: { type: "string", enum: ["ACTIVE"] },
    canReceiveAssignment: { type: "boolean" },
  });
const page = (items: unknown) =>
  obj({
    items: { type: "array", items },
    nextCursor: { type: ["string", "null"] },
  });
const limit = { type: "integer", minimum: 1, maximum: 100, default: 50 },
  cursor = { type: "string", maxLength: 1500, minLength: 1 };
const query = obj({ limit, cursor }, []),
  ids = obj({ id: uuid }),
  text = (max: number) => ({
    type: "string",
    minLength: 1,
    maxLength: max,
    pattern: "\\S",
  });
const errors = {
  400: error,
  401: error,
  403: error,
  404: error,
  409: error,
  413: error,
  415: error,
  429: error,
  500: error,
  503: error,
};
export async function chatRoutes(
  app: FastifyInstance,
  foundation: Foundation,
  chat: Chat,
  cookieName: string,
) {
  const principal = async (req: FastifyRequest) => {
    const p = await foundation.authenticate(req.cookies[cookieName]);
    if (!["GET", "HEAD"].includes(req.method))
      foundation.csrf(p, req.headers["x-csrf-token"] as string | undefined);
    return p;
  };
  const schema = (
    dto: unknown,
    mutable = false,
    extra: FastifySchema = {},
  ): FastifySchema => ({
    tags: ["M1 Internal Chat"],
    security: [mutable ? { webSession: [], csrf: [] } : { webSession: [] }],
    response: { ...errors, 200: dto },
    ...extra,
  });
  app.get<{ Querystring: PageQuery }>(
    "/api/v1/team/members",
    { schema: schema(page(teamMember), false, { querystring: query }) },
    async (r) => chat.teamMembers(await principal(r), r.query),
  );
  app.get(
    "/api/v1/providers",
    { schema: schema(obj({ items: { type: "array", items: obj({ code: { type: "string", enum: ["DEMO", "META"] }, name: str, description: str, state: { type: "string", enum: ["AVAILABLE", "IN_DEVELOPMENT"] }, enabled: { type: "boolean" } }) } }), false, { tags: ["M1 Providers"] }) },
    async (r) => chat.providerCatalog(await principal(r)),
  );
  app.put<{ Body: { enabled: boolean } }>(
    "/api/v1/providers/demo",
    { schema: schema(obj({ enabled: { type: "boolean" } }), true, { body: obj({ enabled: { type: "boolean" } }), tags: ["M1 Providers"] }) },
    async (r) => chat.setDemoProvider(await principal(r), r.body.enabled),
  );
  app.get(
    "/api/v1/providers/demo/contacts",
    { schema: schema(obj({ enabled: { type: "boolean" }, items: { type: "array", items: obj({ contactId: uuid, name: str, conversationId: nullableId }) } }), false, { tags: ["M1 Providers"] }) },
    async (r) => chat.demoContacts(await principal(r)),
  );
  app.post<{ Body: { contactId: string; externalMessageId: string; body: string } }>(
    "/api/v1/providers/demo/messages",
    { schema: schema(message, true, { body: obj({ contactId: uuid, externalMessageId: text(120), body: text(8000) }), tags: ["M1 Providers"] }) },
    async (r) => chat.receiveDemoMessage(await principal(r), r.body),
  );
  app.get<{ Querystring: PageQuery }>(
    "/api/v1/contacts",
    { schema: schema(page(contact), false, { querystring: query }) },
    async (r) => chat.contacts(await principal(r), r.query),
  );
  app.post<{ Body: { name: string; primaryIdentifier: string } }>(
    "/api/v1/contacts",
    {
      schema: schema(contact, true, {
        body: obj({ name: text(120), primaryIdentifier: text(254) }),
      }),
    },
    async (r) => chat.saveContact(await principal(r), r.body),
  );
  app.get<{ Params: { id: string } }>(
    "/api/v1/contacts/:id",
    { schema: schema(contact, false, { params: ids }) },
    async (r) => chat.getContact(await principal(r), r.params.id),
  );
  app.patch<{
    Params: { id: string };
    Body: { name?: string; primaryIdentifier?: string };
  }>(
    "/api/v1/contacts/:id",
    {
      schema: schema(contact, true, {
        params: ids,
        body: {
          ...obj({ name: text(120), primaryIdentifier: text(254) }, []),
          minProperties: 1,
        },
      }),
    },
    async (r) => chat.saveContact(await principal(r), r.body, r.params.id),
  );
  app.get<{ Querystring: PageQuery }>(
    "/api/v1/conversations",
    {
      schema: schema(page(conversation), false, {
        querystring: obj(
          {
            limit,
            cursor,
            scope: { type: "string", enum: ["mine", "unassigned", "all"] },
            archived: { type: "boolean" },
            tagId: uuid,
            contactId: uuid,
          },
          [],
        ),
      }),
    },
    async (r) => chat.conversations(await principal(r), r.query),
  );
  app.post<{ Body: { contactId: string } }>(
    "/api/v1/conversations",
    { schema: schema(conversation, true, { body: obj({ contactId: uuid }) }) },
    async (r) => chat.createConversation(await principal(r), r.body.contactId),
  );
  app.get<{ Params: { id: string } }>(
    "/api/v1/conversations/:id",
    { schema: schema(conversation, false, { params: ids }) },
    async (r) => chat.getConversation(await principal(r), r.params.id),
  );
  for (const [action, archived] of [
    ["archive", true],
    ["unarchive", false],
  ] as const)
    app.post<{ Params: { id: string } }>(
      `/api/v1/conversations/:id/${action}`,
      { schema: schema(conversation, true, { params: ids }) },
      async (r) => chat.archive(await principal(r), r.params.id, archived),
    );
  app.get<{ Params: { id: string }; Querystring: PageQuery }>(
    "/api/v1/conversations/:id/messages",
    {
      schema: schema(page(message), false, {
        params: ids,
        querystring: obj({ limit, before: cursor }, []),
      }),
    },
    async (r) => chat.messages(await principal(r), r.params.id, r.query),
  );
  app.post<{
    Params: { id: string };
    Body: { body: string; clientMessageId: string };
  }>(
    "/api/v1/conversations/:id/messages",
    {
      schema: schema(message, true, {
        params: ids,
        body: obj({ body: text(8000), clientMessageId: text(100) }),
      }),
    },
    async (r) => chat.send(await principal(r), r.params.id, r.body),
  );
  app.post<{
    Params: { id: string; messageId: string };
    Body: { status: "DELIVERED" | "READ" };
  }>(
    "/api/v1/conversations/:id/messages/:messageId/status",
    {
      schema: schema(message, true, {
        params: obj({ id: uuid, messageId: uuid }),
        body: obj({ status: { type: "string", enum: ["DELIVERED", "READ"] } }),
      }),
    },
    async (r) =>
      chat.messageStatus(
        await principal(r),
        r.params.id,
        r.params.messageId,
        r.body.status,
      ),
  );
  app.post<{ Params: { id: string }; Body: { userId: string } }>(
    "/api/v1/conversations/:id/assign",
    {
      schema: schema(conversation, true, {
        params: ids,
        body: obj({ userId: uuid }),
      }),
    },
    async (r) => chat.assign(await principal(r), r.params.id, r.body),
  );
  app.post<{
    Params: { id: string };
    Body: {
      userId: string;
      visibility: HistoryVisibility;
      lastN?: number;
      note?: string;
    };
  }>(
    "/api/v1/conversations/:id/transfer",
    {
      schema: schema(conversation, true, {
        params: ids,
        body: obj(
          {
            userId: uuid,
            visibility: { type: "string", enum: ["FULL", "LIMITED", "NONE"] },
            lastN: { type: "integer", minimum: 1, maximum: 1000 },
            note: text(2000),
          },
          ["userId", "visibility"],
        ),
      }),
    },
    async (r) => chat.assign(await principal(r), r.params.id, r.body, true),
  );
  app.get<{ Querystring: PageQuery }>(
    "/api/v1/tags",
    { schema: schema(page(tag), false, { querystring: query }) },
    async (r) => chat.tags(await principal(r), r.query),
  );
  app.post<{ Body: { name: string } }>(
    "/api/v1/tags",
    { schema: schema(tag, true, { body: obj({ name: text(80) }) }) },
    async (r) => chat.saveTag(await principal(r), r.body.name),
  );
  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/api/v1/tags/:id",
    {
      schema: schema(tag, true, { params: ids, body: obj({ name: text(80) }) }),
    },
    async (r) => chat.saveTag(await principal(r), r.body.name, r.params.id),
  );
  app.delete<{ Params: { id: string } }>(
    "/api/v1/tags/:id",
    { schema: schema(tag, true, { params: ids }) },
    async (r) => chat.saveTag(await principal(r), "", r.params.id, true),
  );
  for (const method of ["POST", "DELETE"] as const)
    app.route<{ Params: { id: string; tagId: string } }>({
      method,
      url: "/api/v1/conversations/:id/tags/:tagId",
      schema: schema(obj({ tagId: uuid }), true, {
        params: obj({ id: uuid, tagId: uuid }),
      }),
      handler: async (r) =>
        chat.conversationTag(
          await principal(r),
          r.params.id,
          r.params.tagId,
          method === "DELETE",
        ),
    });
  app.get<{ Params: { id: string }; Querystring: PageQuery }>(
    "/api/v1/conversations/:id/notes",
    { schema: schema(page(note), false, { params: ids, querystring: query }) },
    async (r) => chat.notes(await principal(r), r.params.id, r.query),
  );
  app.post<{ Params: { id: string }; Body: { body: string } }>(
    "/api/v1/conversations/:id/notes",
    {
      schema: schema(note, true, {
        params: ids,
        body: obj({ body: text(8000) }),
      }),
    },
    async (r) => chat.createNote(await principal(r), r.params.id, r.body.body),
  );
  const event = obj({
    version: { type: "integer", enum: [1] },
    eventId: str,
    organizationId: uuid,
    type: { type: "string", enum: [...chatEventTypes] },
    entityId: uuid,
    occurredAt: date,
    payload: obj({ resourceId: uuid, conversationId: uuid }, ["resourceId"]),
  });
  app.get<{ Querystring: { lastEventId?: string; limit?: number } }>(
    "/api/v1/realtime/events",
    {
      schema: schema(
        obj({
          events: { type: "array", items: event },
          lastEventId: str,
          hasMore: { type: "boolean" },
        }),
        false,
        {
          querystring: obj(
            {
              lastEventId: {
                type: "string",
                pattern: "^(0|[1-9][0-9]{0,18})$",
              },
              limit,
            },
            [],
          ),
        },
      ),
    },
    async (r) =>
      chat.stream(await principal(r), r.query.lastEventId, r.query.limit),
  );
}
