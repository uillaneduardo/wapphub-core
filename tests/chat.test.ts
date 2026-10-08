import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import WebSocket from "ws";
import { buildApp } from "../src/http/app.js";
import { loadConfig } from "../src/infrastructure/config.js";
import {
  digest,
  hashPassword,
  newToken,
} from "../src/infrastructure/crypto.js";
import { chatPermissions, agentPermissions } from "../src/domain/chat.js";
import { DemoProvider } from "../src/integrations/demo-provider.js";
import { MessageIngestionService } from "../src/application/message-ingestion.js";
// Fail closed rather than ever run M1 fixtures against the production schema.
if (
  process.env.NODE_ENV !== "test" ||
  !new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")
)
  throw new Error(
    "M1 tests require an isolated test database and NODE_ENV=test",
  );
const origin = "https://web-client.example.test";
const config = loadConfig({
  ...process.env,
  WEB_ORIGINS: origin,
  NODE_ENV: "test",
});
const db = new PrismaClient();
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1 });
redis.on("error", () => {});
const app = await buildApp(config, db, redis, false);
const run = randomUUID();
let orgA: string,
  orgB: string,
  orgC: string,
  superRole: string,
  agentRole: string,
  deniedRole: string,
  base: string;
type Auth = {
  userId: string;
  sessionId: string;
  token: string;
  csrf: string;
  cookie: string;
};
let supervisor: Auth, agent: Auth, recipient: Auth, tenantB: Auth, denied: Auth;
const roles: string[] = [],
  users: string[] = [];
async function auth(roleId: string, organizationId: string): Promise<Auth> {
  const user = await db.user.create({
    data: {
      name: "Chat test",
      email: `${randomUUID()}@example.test`,
      passwordHash: await hashPassword(newToken()),
    },
  });
  users.push(user.id);
  await db.membership.create({
    data: { userId: user.id, organizationId, roleId },
  });
  return session(user.id, organizationId);
}
async function session(userId: string, organizationId: string): Promise<Auth> {
  const token = newToken(),
    csrf = newToken();
  const row = await db.session.create({
    data: {
      userId,
      tokenHash: digest(token),
      csrfHash: digest(csrf),
      currentOrganizationId: organizationId,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  return {
    userId,
    sessionId: row.id,
    token,
    csrf,
    cookie: `wapphub_session=${token}`,
  };
}
async function request(
  a: Auth,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  status = 200,
) {
  const r = await app.inject({
    method,
    url: "/api/v1" + url,
    headers: { origin, cookie: a.cookie, "x-csrf-token": a.csrf },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  assert.equal(r.statusCode, status, r.body);
  return status === 200 ? r.json() : r;
}
async function conversation(a = supervisor) {
  const c = await request(a, "POST", "/contacts", {
    name: "Contact",
    primaryIdentifier: randomUUID(),
  });
  return request(a, "POST", "/conversations", { contactId: c.id });
}
async function send(
  a: Auth,
  id: string,
  body = "Internal text",
  clientMessageId = randomUUID(),
) {
  return request(a, "POST", `/conversations/${id}/messages`, {
    body,
    clientMessageId,
  });
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
type Frame = {
  type: string;
  eventId?: string;
  entityId?: string;
  organizationId?: string;
  lastEventId?: string;
  payload?: unknown;
};
async function socket(a: Auth, lastEventId = "0") {
  const frames: Frame[] = [];
  const ws = new WebSocket(
    base.replace("http:", "ws:") +
      `/api/v1/realtime?lastEventId=${lastEventId}`,
    { headers: { origin, cookie: a.cookie } },
  );
  ws.on("message", (x) => frames.push(JSON.parse(x.toString())));
  ws.on("error", () => {});
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  await until(() => frames.some((f) => f.type === "sync.checkpoint"));
  return { ws, frames };
}
async function until(fn: () => boolean) {
  const end = Date.now() + 6000;
  while (!fn()) {
    if (Date.now() > end) throw new Error("Realtime deadline exceeded");
    await pause(20);
  }
}
before(async () => {
  orgA = (await db.organization.create({ data: { name: `Chat A ${run}` } })).id;
  orgB = (await db.organization.create({ data: { name: `Chat B ${run}` } })).id;
  orgC = (await db.organization.create({ data: { name: `Chat C ${run}` } })).id;
  for (const [label, permissions] of [
    ["super", ["organization.read", ...chatPermissions, "providers.manage", "providers.simulate"]],
    ["agent", ["organization.read", ...agentPermissions]],
    ["deny", ["organization.read"]],
  ] as const) {
    const role = await db.role.create({
      data: { code: `${label}-${run.slice(0, 30)}` },
    });
    roles.push(role.id);
    for (const code of permissions) {
      const p = await db.permission.upsert({
        where: { code },
        create: { code },
        update: {},
      });
      await db.rolePermission.create({
        data: { roleId: role.id, permissionId: p.id },
      });
    }
  }
  [superRole, agentRole, deniedRole] = roles as [string, string, string];
  supervisor = await auth(superRole, orgA);
  agent = await auth(agentRole, orgA);
  recipient = await auth(agentRole, orgA);
  tenantB = await auth(superRole, orgB);
  denied = await auth(deniedRole, orgA);
  await db.membership.create({
    data: {
      userId: supervisor.userId,
      organizationId: orgC,
      roleId: superRole,
    },
  });
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});
after(async () => {
  await app.close();
  const where = { organizationId: { in: [orgA, orgB, orgC] } };
  await db.realtimeEvent.deleteMany({ where });
  await db.internalNote.deleteMany({ where });
  await db.conversationAssignmentHistory.deleteMany({ where });
  await db.conversationTag.deleteMany({ where });
  await db.message.deleteMany({ where });
  await db.conversation.deleteMany({ where });
  await db.tag.deleteMany({ where });
  await db.contactIdentity.deleteMany({ where });
  await db.channel.deleteMany({ where });
  await db.contact.deleteMany({ where });
  await db.auditEvent.deleteMany({ where });
  await db.securityEvent.deleteMany({ where: { userId: { in: users } } });
  await db.session.deleteMany({ where: { userId: { in: users } } });
  await db.membership.deleteMany({ where: { userId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.organization.deleteMany({
    where: { id: { in: [orgA, orgB, orgC] } },
  });
  await db.rolePermission.deleteMany({ where: { roleId: { in: roles } } });
  await db.role.deleteMany({ where: { id: { in: roles } } });
  await db.$disconnect();
  await redis.quit();
});
test("contacts create/list/update, cursor integrity and identifier uniqueness are tenant scoped", async () => {
  const c = await request(supervisor, "POST", "/contacts", {
    name: "First",
    primaryIdentifier: randomUUID(),
  });
  assert.equal(
    (await request(supervisor, "GET", `/contacts/${c.id}`)).name,
    "First",
  );
  assert.equal(
    (
      await request(supervisor, "PATCH", `/contacts/${c.id}`, {
        name: "Changed",
      })
    ).name,
    "Changed",
  );
  await request(
    supervisor,
    "POST",
    "/contacts",
    { name: "Duplicate", primaryIdentifier: c.primaryIdentifier },
    409,
  );
  await request(tenantB, "GET", `/contacts/${c.id}`, undefined, 404);
  await request(tenantB, "PATCH", `/contacts/${c.id}`, { name: "hack" }, 404);
  await request(tenantB, "POST", "/conversations", { contactId: c.id }, 404);
  const list = await request(supervisor, "GET", "/contacts?limit=1");
  assert.ok(list.items.every((x: { id: string }) => x.id !== undefined));
  await request(supervisor, "GET", "/contacts?cursor=forged", undefined, 400);
});

test("Demo provider is permission-gated, tenant-scoped, idempotent and uses shared message history", async () => {
  await request(agent, "PUT", "/providers/demo", { enabled: true }, 403);
  await request(agent, "GET", "/providers/demo/contacts", undefined, 403);
  assert.deepEqual((await request(supervisor, "PUT", "/providers/demo", { enabled: true })).enabled, true);
  const catalog = await request(supervisor, "GET", "/providers");
  assert.equal(catalog.items.find((x: { code: string }) => x.code === "META").state, "IN_DEVELOPMENT");
  const contacts = await request(supervisor, "GET", "/providers/demo/contacts");
  assert.equal(contacts.items.length, 2);
  assert.equal(contacts.enabled, true);
  const first = contacts.items[0];
  const initial = await request(supervisor, "GET", `/conversations/${first.conversationId}/messages`);
  assert.equal(initial.items[0].direction, "INBOUND");
  assert.equal(initial.items[0].senderUserId, null);
  assert.equal(initial.items[0].senderContactId, first.contactId);
  assert.equal(initial.items[0].body, "Olá! Gostaria de saber mais sobre os serviços de vocês.");
  const secondContact = contacts.items[1];
  const secondInitial = await request(supervisor, "GET", `/conversations/${secondContact.conversationId}/messages`);
  assert.equal(secondInitial.items[0].senderUserId, null);
  assert.equal(secondInitial.items[0].senderContactId, secondContact.contactId);
  assert.equal(secondInitial.items[0].body, "Bom dia! Preciso de ajuda com um problema.");
  await request(supervisor, "PUT", "/providers/demo", { enabled: true });
  assert.equal((await request(supervisor, "GET", "/providers/demo/contacts")).items.length, 2);
  await request(tenantB, "PUT", "/providers/demo", { enabled: true });
  await request(tenantB, "POST", "/providers/demo/messages", { contactId: first.contactId, externalMessageId: randomUUID(), body: "fora do tenant" }, 404);
  const live = await socket(supervisor);
  const externalMessageId = randomUUID();
  const inbound = await request(supervisor, "POST", "/providers/demo/messages", { contactId: first.contactId, externalMessageId, body: "Nova mensagem do contato" });
  assert.equal(inbound.direction, "INBOUND");
  assert.equal(inbound.senderUserId, null);
  assert.equal((await request(supervisor, "POST", "/providers/demo/messages", { contactId: first.contactId, externalMessageId, body: "Nova mensagem do contato" })).id, inbound.id);
  await until(() => live.frames.some((frame) => frame.type === "message.created" && frame.entityId === inbound.id));
  const outbound = await send(agent, first.conversationId, "Resposta do atendimento");
  assert.equal(outbound.direction, "OUTBOUND");
  assert.equal(outbound.senderUserId, agent.userId);
  await until(() => live.frames.some((frame) => frame.type === "message.created" && frame.entityId === outbound.id));
  live.ws.close();
  const tag = await request(supervisor, "POST", "/tags", { name: `Demo ${run}` });
  await request(supervisor, "POST", `/conversations/${first.conversationId}/tags/${tag.id}`);
  assert.ok((await request(supervisor, "GET", `/conversations/${first.conversationId}`)).tagIds.includes(tag.id));
  await request(supervisor, "POST", `/conversations/${first.conversationId}/notes`, { body: "Nota de homologação" });
  assert.ok((await request(supervisor, "GET", `/conversations/${first.conversationId}/notes`)).items.some((note: { body: string }) => note.body === "Nota de homologação"));
  await request(supervisor, "POST", `/conversations/${first.conversationId}/assign`, { userId: agent.userId });
  await request(supervisor, "POST", `/conversations/${first.conversationId}/transfer`, { userId: recipient.userId, visibility: "FULL", note: "Repasse Demo" });
  await request(supervisor, "POST", `/conversations/${first.conversationId}/archive`);
  await request(supervisor, "POST", `/conversations/${first.conversationId}/unarchive`);
  await request(supervisor, "PUT", "/providers/demo", { enabled: false });
  await request(supervisor, "POST", "/providers/demo/messages", { contactId: first.contactId, externalMessageId: randomUUID(), body: "bloqueada" }, 409);
  await request(supervisor, "POST", `/conversations/${first.conversationId}/messages`, { body: "bloqueada", clientMessageId: randomUUID() }, 409);
  assert.equal((await request(supervisor, "GET", `/conversations/${first.conversationId}/messages`)).items.length, 3);
});

test("team roster is permission gated, tenant scoped, active only and paginated", async () => {
  const inactiveUser = await db.user.create({
    data: {
      name: "Inactive membership",
      email: `${randomUUID()}@example.test`,
      passwordHash: await hashPassword(newToken()),
    },
  });
  users.push(inactiveUser.id);
  const inactiveMembership = await db.membership.create({
    data: {
      userId: inactiveUser.id,
      organizationId: orgA,
      roleId: agentRole,
      status: "INACTIVE",
    },
  });
  try {
    const roster = await request(supervisor, "GET", "/team/members");
    const members = roster.items as {
      userId: string;
      name: string;
      email: string;
      status: string;
      canReceiveAssignment: boolean;
    }[];
    assert.ok(members.some((member) => member.userId === agent.userId));
    assert.ok(members.some((member) => member.userId === recipient.userId));
    assert.ok(!members.some((member) => member.userId === tenantB.userId));
    assert.ok(!members.some((member) => member.userId === inactiveUser.id));
    assert.equal(
      members.find((member) => member.userId === denied.userId)
        ?.canReceiveAssignment,
      false,
    );
    assert.equal(
      members.find((member) => member.userId === agent.userId)
        ?.canReceiveAssignment,
      true,
    );
    assert.equal(members.find((member) => member.userId === agent.userId)?.status, "ACTIVE");
    assert.deepEqual(Object.keys(members[0]!).sort(), [
      "canReceiveAssignment",
      "email",
      "name",
      "status",
      "userId",
    ]);

    const firstPage = await request(supervisor, "GET", "/team/members?limit=1");
    assert.equal(firstPage.items.length, 1);
    assert.ok(firstPage.nextCursor);
    const secondPage = await request(
      supervisor,
      "GET",
      `/team/members?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
    );
    assert.equal(secondPage.items.length, 1);
    assert.notEqual(firstPage.items[0].userId, secondPage.items[0].userId);

    const tenantRoster = await request(tenantB, "GET", "/team/members");
    assert.deepEqual(
      tenantRoster.items.map((member: { userId: string }) => member.userId),
      [tenantB.userId],
    );
    await request(supervisor, "GET", `/team/members?organizationId=${orgB}`, undefined, 400);
    await request(denied, "GET", "/team/members", undefined, 403);
  } finally {
    await db.membership.delete({ where: { id: inactiveMembership.id } });
  }
});
test("contacts pagination never repeats records and cursors cannot cross tenants", async () => {
  for (let n = 0; n < 3; n++)
    await request(supervisor, "POST", "/contacts", {
      name: `Page ${n}`,
      primaryIdentifier: randomUUID(),
    });
  const first = await request(supervisor, "GET", "/contacts?limit=1");
  assert.ok(first.nextCursor);
  const next = await request(
    supervisor,
    "GET",
    `/contacts?limit=1&cursor=${first.nextCursor}`,
  );
  assert.notEqual(first.items[0].id, next.items[0].id);
  await request(
    tenantB,
    "GET",
    `/contacts?cursor=${first.nextCursor}`,
    undefined,
    400,
  );
});
test("conversation filters enforce mine/unassigned/all, contact/tag and archived scopes", async () => {
  const c = await conversation();
  await request(supervisor, "POST", `/conversations/${c.id}/assign`, {
    userId: agent.userId,
  });
  assert.ok(
    (await request(agent, "GET", "/conversations?scope=mine")).items.some(
      (x: { id: string }) => x.id === c.id,
    ),
  );
  assert.ok(
    !(
      await request(agent, "GET", "/conversations?scope=unassigned")
    ).items.some((x: { id: string }) => x.id === c.id),
  );
  await request(agent, "GET", "/conversations?scope=all", undefined, 403);
  assert.ok(
    (
      await request(
        supervisor,
        "GET",
        `/conversations?scope=all&contactId=${c.contactId}`,
      )
    ).items.some((x: { id: string }) => x.id === c.id),
  );
  const t = await request(supervisor, "POST", "/tags", { name: randomUUID() });
  await request(supervisor, "POST", `/conversations/${c.id}/tags/${t.id}`);
  assert.equal(
    (await request(supervisor, "GET", `/conversations?scope=all&tagId=${t.id}`))
      .items[0].id,
    c.id,
  );
  await request(
    tenantB,
    "GET",
    `/conversations?scope=all&contactId=${c.contactId}`,
    undefined,
    404,
  );
  await request(
    tenantB,
    "GET",
    `/conversations?scope=all&tagId=${t.id}`,
    undefined,
    404,
  );
  await request(agent, "POST", `/conversations/${c.id}/archive`);
  assert.equal(
    (
      await request(
        agent,
        "GET",
        `/conversations?archived=true&contactId=${c.contactId}`,
      )
    ).items[0].id,
    c.id,
  );
  await request(
    agent,
    "POST",
    `/conversations/${c.id}/messages`,
    { body: "no", clientMessageId: randomUUID() },
    409,
  );
  await request(agent, "POST", `/conversations/${c.id}/unarchive`);
  assert.equal(
    (await request(agent, "GET", `/conversations/${c.id}`)).status,
    "OPEN",
  );
});
test("conversation cursor uses deterministic tuple and is bound to filters/user/tenant", async () => {
  for (let n = 0; n < 3; n++) await conversation();
  const a = await request(
    supervisor,
    "GET",
    "/conversations?scope=all&limit=2",
  );
  assert.ok(a.nextCursor);
  const b = await request(
    supervisor,
    "GET",
    `/conversations?scope=all&limit=2&cursor=${a.nextCursor}`,
  );
  assert.ok(
    !b.items.some((x: { id: string }) =>
      a.items.some((y: { id: string }) => x.id === y.id),
    ),
  );
  await request(
    supervisor,
    "GET",
    `/conversations?scope=mine&cursor=${a.nextCursor}`,
    undefined,
    400,
  );
  await request(
    tenantB,
    "GET",
    `/conversations?scope=all&cursor=${a.nextCursor}`,
    undefined,
    400,
  );
});
test("send is idempotent and rejects reuse with another payload or sender", async () => {
  const c = await conversation();
  const id = randomUUID();
  const a = await send(supervisor, c.id, "one", id),
    b = await send(supervisor, c.id, "one", id);
  assert.equal(a.id, b.id);
  assert.equal(a.status, "SENT");
  assert.equal(a.direction, "INTERNAL");
  await request(
    supervisor,
    "POST",
    `/conversations/${c.id}/messages`,
    { body: "different", clientMessageId: id },
    409,
  );
  await request(
    agent,
    "POST",
    `/conversations/${c.id}/messages`,
    { body: "one", clientMessageId: id },
    409,
  );
  assert.equal(
    await db.message.count({
      where: {
        organizationId: orgA,
        conversationId: c.id,
        clientMessageId: id,
      },
    }),
    1,
  );
  assert.equal(
    await db.realtimeEvent.count({
      where: { organizationId: orgA, entityId: a.id, type: "message.created" },
    }),
    1,
  );
});
test("message cursor supports progressive history with no overlap and refuses forged/cross-conversation cursor", async () => {
  const c = await conversation();
  for (let i = 0; i < 5; i++) await send(supervisor, c.id, String(i));
  const a = await request(
    supervisor,
    "GET",
    `/conversations/${c.id}/messages?limit=2`,
  );
  assert.deepEqual(
    a.items.map((x: { body: string }) => x.body),
    ["4", "3"],
  );
  const b = await request(
    supervisor,
    "GET",
    `/conversations/${c.id}/messages?limit=2&before=${a.nextCursor}`,
  );
  assert.deepEqual(
    b.items.map((x: { body: string }) => x.body),
    ["2", "1"],
  );
  const other = await conversation();
  await request(
    supervisor,
    "GET",
    `/conversations/${other.id}/messages?before=${a.nextCursor}`,
    undefined,
    400,
  );
});
test("local message receipts allow monotonic delivered/read and reject invalid transitions", async () => {
  const c = await conversation(),
    m = await send(supervisor, c.id);
  assert.equal(
    (
      await request(
        supervisor,
        "POST",
        `/conversations/${c.id}/messages/${m.id}/status`,
        { status: "DELIVERED" },
      )
    ).status,
    "DELIVERED",
  );
  assert.equal(
    (
      await request(
        supervisor,
        "POST",
        `/conversations/${c.id}/messages/${m.id}/status`,
        { status: "READ" },
      )
    ).status,
    "READ",
  );
  await request(
    supervisor,
    "POST",
    `/conversations/${c.id}/messages/${m.id}/status`,
    { status: "DELIVERED" },
    409,
  );
  await request(
    supervisor,
    "POST",
    `/conversations/${c.id}/messages/${m.id}/status`,
    { status: "FAILED" },
    400,
  );
});
for (const mode of ["FULL", "LIMITED", "NONE"] as const)
  test(`transfer ${mode} preserves history and enforces current assignee visibility on REST/replay/notes`, async () => {
    const c = await conversation();
    await request(supervisor, "POST", `/conversations/${c.id}/assign`, {
      userId: agent.userId,
    });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++)
      ids.push((await send(agent, c.id, `history-${i}`)).id);
    const oldNote = await request(
      agent,
      "POST",
      `/conversations/${c.id}/notes`,
      { body: "old note" },
    );
    await request(agent, "POST", `/conversations/${c.id}/transfer`, {
      userId: recipient.userId,
      visibility: mode,
      ...(mode === "LIMITED" ? { lastN: 2 } : {}),
      note: "handover",
    });
    const messages = await request(
      recipient,
      "GET",
      `/conversations/${c.id}/messages`,
    );
    assert.equal(
      messages.items.length,
      mode === "FULL" ? 4 : mode === "LIMITED" ? 2 : 0,
    );
    await request(agent, "GET", `/conversations/${c.id}`, undefined, 404);
    await request(
      agent,
      "GET",
      `/conversations/${c.id}/messages`,
      undefined,
      404,
    );
    await request(
      agent,
      "POST",
      `/conversations/${c.id}/notes`,
      { body: "denied" },
      404,
    );
    assert.equal(
      (await request(supervisor, "GET", `/conversations/${c.id}/messages`))
        .items.length,
      4,
    );
    const notes = await request(
      recipient,
      "GET",
      `/conversations/${c.id}/notes`,
    );
    assert.equal(
      notes.items.some((n: { id: string }) => n.id === oldNote.id),
      mode === "FULL",
    );
    const replay = { events: [] as { type: string; entityId: string }[] };
    let last = "0";
    do {
      const page = await request(
        recipient,
        "GET",
        `/realtime/events?limit=100&lastEventId=${last}`,
      );
      replay.events.push(...page.events);
      last = page.lastEventId;
      if (!page.hasMore) break;
    } while (last !== "0");
    const visible = replay.events.filter(
      (e: { type: string; entityId: string }) =>
        e.type === "message.created" && ids.includes(e.entityId),
    );
    assert.equal(
      visible.length,
      mode === "FULL" ? 4 : mode === "LIMITED" ? 2 : 0,
    );
    const fresh = await send(recipient, c.id, "after");
    assert.ok(
      (
        await request(recipient, "GET", `/conversations/${c.id}/messages`)
      ).items.some((m: { id: string }) => m.id === fresh.id),
    );
    assert.equal(
      await db.message.count({
        where: { organizationId: orgA, conversationId: c.id },
      }),
      5,
    );
    const history = await db.conversationAssignmentHistory.findMany({
      where: { organizationId: orgA, conversationId: c.id },
    });
    assert.equal(history.length, 2);
    assert.equal(history[1]!.visibility, mode);
  });
test("assignment validates active tenant membership/user/permissions; replaces only through transfer", async () => {
  const c = await conversation();
  await request(
    agent,
    "POST",
    `/conversations/${c.id}/assign`,
    { userId: recipient.userId },
    403,
  );
  await request(
    supervisor,
    "POST",
    `/conversations/${c.id}/assign`,
    { userId: tenantB.userId },
    404,
  );
  await request(
    supervisor,
    "POST",
    `/conversations/${c.id}/assign`,
    { userId: denied.userId },
    409,
  );
  await request(agent, "POST", `/conversations/${c.id}/assign`, {
    userId: agent.userId,
  });
  await request(
    agent,
    "POST",
    `/conversations/${c.id}/assign`,
    { userId: recipient.userId },
    409,
  );
  await request(
    agent,
    "POST",
    `/conversations/${c.id}/transfer`,
    { userId: recipient.userId, visibility: "LIMITED" },
    400,
  );
  await request(
    agent,
    "POST",
    `/conversations/${c.id}/transfer`,
    { userId: recipient.userId, visibility: "NONE", lastN: 2 },
    400,
  );
  await db.membership.update({
    where: {
      userId_organizationId: { userId: recipient.userId, organizationId: orgA },
    },
    data: { status: "SUSPENDED" },
  });
  try {
    await request(
      agent,
      "POST",
      `/conversations/${c.id}/transfer`,
      { userId: recipient.userId, visibility: "FULL" },
      404,
    );
  } finally {
    await db.membership.update({
      where: {
        userId_organizationId: {
          userId: recipient.userId,
          organizationId: orgA,
        },
      },
      data: { status: "ACTIVE" },
    });
  }
});
test("tags create/update/delete and notes are auditable, bounded and tenant scoped", async () => {
  const c = await conversation(),
    tag = await request(supervisor, "POST", "/tags", { name: randomUUID() });
  await request(supervisor, "PATCH", `/tags/${tag.id}`, { name: randomUUID() });
  await request(supervisor, "POST", `/conversations/${c.id}/tags/${tag.id}`);
  await request(supervisor, "DELETE", `/conversations/${c.id}/tags/${tag.id}`);
  const note = await request(
    supervisor,
    "POST",
    `/conversations/${c.id}/notes`,
    { body: "Private internal note" },
  );
  assert.equal(
    (await request(supervisor, "GET", `/conversations/${c.id}/notes`)).items[0]
      .id,
    note.id,
  );
  await request(tenantB, "PATCH", `/tags/${tag.id}`, { name: "cross" }, 404);
  await request(tenantB, "DELETE", `/tags/${tag.id}`, undefined, 404);
  await request(supervisor, "DELETE", `/tags/${tag.id}`);
  await request(supervisor, "PATCH", `/tags/${tag.id}`, { name: "gone" }, 404);
  const audits = await db.auditEvent.findMany({
    where: { organizationId: orgA },
  });
  for (const code of [
    "CONTACT_CREATED",
    "CONVERSATION_CREATED",
    "CONVERSATION_ARCHIVED",
    "CONVERSATION_UNARCHIVED",
    "CONVERSATION_ASSIGNED",
    "CONVERSATION_TRANSFERRED",
    "NOTE_CREATED",
    "TAG_CREATED",
    "TAG_UPDATED",
    "TAG_DELETED",
    "MESSAGES_SUPERVISED",
  ])
    assert.ok(
      audits.some((a) => a.action === code),
      code,
    );
  assert.ok(!JSON.stringify(audits).includes(note.body));
});
test("all operational resources reject valid foreign tenant IDs", async () => {
  const c = await conversation(),
    m = await send(supervisor, c.id),
    t = await request(supervisor, "POST", "/tags", { name: randomUUID() });
  for (const [method, path, payload] of [
    ["GET", `/conversations/${c.id}`, undefined],
    ["GET", `/conversations/${c.id}/messages`, undefined],
    [
      "POST",
      `/conversations/${c.id}/messages`,
      { body: "hack", clientMessageId: randomUUID() },
    ],
    ["POST", `/conversations/${c.id}/archive`, undefined],
    ["POST", `/conversations/${c.id}/unarchive`, undefined],
    ["POST", `/conversations/${c.id}/assign`, { userId: tenantB.userId }],
    [
      "POST",
      `/conversations/${c.id}/transfer`,
      { userId: tenantB.userId, visibility: "FULL" },
    ],
    ["GET", `/conversations/${c.id}/notes`, undefined],
    ["POST", `/conversations/${c.id}/notes`, { body: "hack" }],
    ["POST", `/conversations/${c.id}/tags/${t.id}`, undefined],
    ["DELETE", `/conversations/${c.id}/tags/${t.id}`, undefined],
    [
      "POST",
      `/conversations/${c.id}/messages/${m.id}/status`,
      { status: "READ" },
    ],
  ] as const)
    await request(tenantB, method, path, payload, 404);
  const b = await conversation(tenantB);
  await request(
    tenantB,
    "POST",
    `/conversations/${b.id}/tags/${t.id}`,
    undefined,
    404,
  );
  await request(
    tenantB,
    "POST",
    `/conversations/${b.id}/messages/${m.id}/status`,
    { status: "READ" },
    404,
  );
});
test("permissions protect every command/read independent of role names", async () => {
  for (const url of [
    "/contacts",
    "/conversations",
    "/tags",
    "/realtime/events",
  ])
    await request(denied, "GET", url, undefined, 403);
  const c = await conversation();
  for (const [url, payload] of [
    ["/contacts", { name: "no", primaryIdentifier: randomUUID() }],
    ["/conversations", { contactId: c.contactId }],
    [
      `/conversations/${c.id}/messages`,
      { body: "no", clientMessageId: randomUUID() },
    ],
    [`/conversations/${c.id}/notes`, { body: "no" }],
    ["/tags", { name: "no" }],
  ] as const)
    await request(denied, "POST", url, payload, 403);
  await request(agent, "POST", "/tags", { name: "no" }, 403);
});
test("payload validation rejects organization spoofing, malformed IDs, blank text, unknown types and oversized pages", async () => {
  await request(
    supervisor,
    "POST",
    "/contacts",
    { name: "bad", primaryIdentifier: "id", organizationId: orgB },
    400,
  );
  const c = await conversation();
  for (const payload of [
    { body: " ", clientMessageId: randomUUID() },
    { body: "no", clientMessageId: randomUUID(), type: "IMAGE" },
    { body: "no" },
  ])
    await request(
      supervisor,
      "POST",
      `/conversations/${c.id}/messages`,
      payload,
      400,
    );
  await request(supervisor, "GET", "/contacts/not-a-uuid", undefined, 400);
  await request(supervisor, "GET", "/conversations?limit=101", undefined, 400);
  const r = await app.inject({
    method: "PATCH",
    url: `/api/v1/contacts/${c.contactId}`,
    headers: { origin, cookie: supervisor.cookie },
    payload: { name: "no" },
  });
  assert.equal(r.statusCode, 403);
});
test("composite persistence constraints reject cross-tenant contact and tag links", async () => {
  const c = await conversation(),
    b = await conversation(tenantB),
    tag = await request(supervisor, "POST", "/tags", { name: randomUUID() });
  await assert.rejects(
    db.conversation.create({
      data: { organizationId: orgB, contactId: c.contactId },
    }),
  );
  await assert.rejects(
    db.conversationTag.create({
      data: { organizationId: orgB, conversationId: b.id, tagId: tag.id },
    }),
  );
});
test("WebSocket rejects missing authentication, unapproved Origin and absent permission before upgrade", async () => {
  for (const headers of [
    { origin },
    { origin: "https://evil.test", cookie: supervisor.cookie },
    { origin, cookie: denied.cookie },
  ]) {
    const code = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(
        base.replace("http:", "ws:") + "/api/v1/realtime",
        { headers },
      );
      ws.on("unexpected-response", (_req, res) => {
        resolve(res.statusCode!);
        res.resume();
        ws.terminate();
      });
      ws.on("open", () => reject(new Error("Unauthorized upgrade")));
      ws.on("error", () => {});
    });
    assert.ok([401, 403].includes(code));
  }
});
test("authenticated WebSockets receive only authorized organization events and replay after reconnect", async () => {
  const a = await socket(supervisor),
    b = await socket(tenantB);
  try {
    const checkpoint = a.frames
      .filter((f) => f.type === "sync.checkpoint")
      .at(-1)!.lastEventId!;
    const c = await conversation();
    const m = await send(supervisor, c.id);
    await until(() => a.frames.some((f) => f.entityId === m.id));
    assert.ok(!b.frames.some((f) => f.entityId === m.id));
    assert.ok(
      a.frames.filter((f) => f.eventId).every((f) => f.organizationId === orgA),
    );
    a.ws.close();
    const replay = await socket(supervisor, checkpoint);
    try {
      assert.ok(replay.frames.some((f) => f.entityId === m.id));
      assert.ok(
        replay.frames
          .filter((f) => f.eventId)
          .every((f) => !JSON.stringify(f).includes("Internal text")),
      );
    } finally {
      replay.ws.close();
    }
  } finally {
    a.ws.close();
    b.ws.close();
  }
});
test("revoked sessions, inactive memberships/users/organizations and changed contexts invalidate realtime", async () => {
  for (const kind of [
    "session",
    "membership",
    "user",
    "organization",
    "context",
  ]) {
    const fresh = await session(supervisor.userId, orgA),
      s = await socket(fresh);
    try {
      if (kind === "session")
        await request(fresh, "POST", "/auth/logout", undefined, 204);
      if (kind === "membership")
        await db.membership.update({
          where: {
            userId_organizationId: {
              userId: supervisor.userId,
              organizationId: orgA,
            },
          },
          data: { status: "SUSPENDED" },
        });
      if (kind === "user")
        await db.user.update({
          where: { id: supervisor.userId },
          data: { status: "SUSPENDED" },
        });
      if (kind === "organization")
        await db.organization.update({
          where: { id: orgA },
          data: { status: "SUSPENDED" },
        });
      if (kind === "context")
        await request(fresh, "POST", "/session/organization", {
          organizationId: orgC,
        });
      await until(() => s.ws.readyState === WebSocket.CLOSED);
    } finally {
      s.ws.terminate();
      await db.membership.update({
        where: {
          userId_organizationId: {
            userId: supervisor.userId,
            organizationId: orgA,
          },
        },
        data: { status: "ACTIVE" },
      });
      await db.user.update({
        where: { id: supervisor.userId },
        data: { status: "ACTIVE" },
      });
      await db.organization.update({
        where: { id: orgA },
        data: { status: "ACTIVE" },
      });
    }
  }
});
test("event sync has bounded pages, checkpoints advance across invisible events and rejects malformed cursor", async () => {
  const r = await request(supervisor, "GET", "/realtime/events?limit=1");
  assert.equal(r.events.length, 1);
  assert.equal(r.hasMore, true);
  const next = await request(
    supervisor,
    "GET",
    `/realtime/events?limit=1&lastEventId=${r.lastEventId}`,
  );
  assert.ok(BigInt(next.lastEventId) > BigInt(r.lastEventId));
  const b = await request(tenantB, "GET", "/realtime/events?limit=100");
  assert.ok(
    b.events.every(
      (e: { organizationId: string }) => e.organizationId === orgB,
    ),
  );
  await request(
    supervisor,
    "GET",
    "/realtime/events?lastEventId=-1",
    undefined,
    400,
  );
});
test("basic concurrency smoke: eight sockets, concurrent tenants and duplicate IDs never mix or duplicate", async () => {
  const a = await conversation(),
    b = await conversation(tenantB);
  const sockets = await Promise.all(
    Array.from({ length: 8 }, (_, i) => socket(i < 4 ? supervisor : tenantB)),
  );
  try {
    const key = randomUUID();
    const start = Date.now();
    const duplicate = await Promise.all(
      Array.from({ length: 8 }, () => send(supervisor, a.id, "duplicate", key)),
    );
    assert.equal(new Set(duplicate.map((x) => x.id)).size, 1);
    const sent = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        send(
          i % 2 ? supervisor : tenantB,
          i % 2 ? a.id : b.id,
          `concurrent-${i}`,
        ),
      ),
    );
    await until(() =>
      sockets.every((s, i) =>
        sent
          .filter((_, j) => (i < 4 ? j % 2 === 1 : j % 2 === 0))
          .every((m) => s.frames.some((f) => f.entityId === m.id)),
      ),
    );
    for (let i = 0; i < sockets.length; i++)
      assert.ok(
        sockets[i]!.frames.filter((f) => f.eventId).every(
          (f) => f.organizationId === (i < 4 ? orgA : orgB),
        ),
      );
    assert.equal(
      await db.message.count({
        where: {
          organizationId: orgA,
          conversationId: a.id,
          clientMessageId: key,
        },
      }),
      1,
    );
    console.log(
      `M1 concurrency smoke: 8 WebSockets, 20 concurrent sends (8 retries + 12 unique), duration ${Date.now() - start}ms; not M5 benchmark`,
    );
  } finally {
    for (const s of sockets) s.ws.close();
  }
});

test("live transfer NONE never exposes historical messages to recipient; former agent stops receiving", async () => {
  const c = await conversation();
  await request(supervisor, "POST", `/conversations/${c.id}/assign`, {
    userId: agent.userId,
  });
  const historical = await send(agent, c.id, "restricted history");
  const old = await socket(agent),
    next = await socket(recipient);
  try {
    await request(agent, "POST", `/conversations/${c.id}/transfer`, {
      userId: recipient.userId,
      visibility: "NONE",
      note: "handover available",
    });
    await until(() =>
      next.frames.some(
        (f) => f.type === "conversation.transferred" && f.entityId === c.id,
      ),
    );
    await until(() =>
      old.frames.some(
        (f) => f.type === "conversation.transferred" && f.entityId === c.id,
      ),
    );
    const fresh = await send(recipient, c.id, "new history");
    await until(() => next.frames.some((f) => f.entityId === fresh.id));
    assert.ok(!next.frames.some((f) => f.entityId === historical.id));
    assert.ok(!old.frames.some((f) => f.entityId === fresh.id));
    assert.ok(
      (
        await request(recipient, "GET", `/conversations/${c.id}/notes`)
      ).items.some((n: { body: string }) => n.body === "handover available"),
    );
  } finally {
    old.ws.close();
    next.ws.close();
  }
});
test("lost realtime notification is recovered from persistent stream without losing a committed message", async () => {
  const { Chat } = await import("../src/application/chat.js");
  const c = await conversation(),
    s = await socket(supervisor);
  try {
    const row = await db.session.findUniqueOrThrow({
      where: { id: supervisor.sessionId },
      include: { user: true },
    });
    const chat = new Chat(db, config, async () => {
      throw new Error("Simulated unavailable notification");
    }, new DemoProvider(), new MessageIngestionService());
    const m = await chat.send({ session: row, user: row.user }, c.id, {
      body: "durable",
      clientMessageId: randomUUID(),
    });
    await until(() => s.frames.some((f) => f.entityId === m.id));
  } finally {
    s.ws.close();
  }
});
test("event stream permission removal closes socket and WebSocket commands are rejected", async () => {
  const fresh = await session(agent.userId, orgA),
    s = await socket(fresh);
  const permission = await db.permission.findUniqueOrThrow({
    where: { code: "conversations.read" },
  });
  try {
    await db.rolePermission.delete({
      where: {
        roleId_permissionId: { roleId: agentRole, permissionId: permission.id },
      },
    });
    await until(() => s.ws.readyState === WebSocket.CLOSED);
  } finally {
    await db.rolePermission.create({
      data: { roleId: agentRole, permissionId: permission.id },
    });
    s.ws.terminate();
  }
  const command = await socket(fresh);
  command.ws.send(JSON.stringify({ organizationId: orgB, type: "subscribe" }));
  await until(() => command.ws.readyState === WebSocket.CLOSED);
});
