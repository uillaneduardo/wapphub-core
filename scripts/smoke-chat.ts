import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import WebSocket from "ws";
import { newToken } from "../src/infrastructure/crypto.js";
import { loadConfig } from "../src/infrastructure/config.js";
if (
  process.env.NODE_ENV !== "test" ||
  !new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")
)
  throw new Error("Chat smoke requires isolated test database");
const config = loadConfig(),
  db = new PrismaClient(),
  email = `chat-smoke-${randomUUID()}@example.test`,
  password = newToken();
let org: string | undefined, user: string | undefined;
const sockets: WebSocket[] = [];
try {
  const boot = spawnSync(process.execPath, ["dist/scripts/bootstrap.js"], {
    env: {
      ...process.env,
      BOOTSTRAP_EMAIL: email,
      BOOTSTRAP_PASSWORD: password,
      BOOTSTRAP_ORGANIZATION: "M1 smoke fixture",
    },
    encoding: "utf8",
  });
  assert.equal(boot.status, 0);
  const identity = await db.user.findUniqueOrThrow({
    where: { email },
    include: { memberships: true },
  });
  user = identity.id;
  org = identity.memberships[0]!.organizationId;
  const base = "http://wapphub-core-api:3000/api/v1",
    origin = config.origins[0]!;
  const login = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers
      .getSetCookie()
      .map((x) => x.split(";")[0])
      .join("; "),
    csrf = ((await login.json()) as { csrfToken: string }).csrfToken;
  const headers = {
    origin,
    cookie,
    "x-csrf-token": csrf,
    "content-type": "application/json",
  };
  async function api<T extends Record<string, unknown> = Record<string, unknown>>(
    method: string,
    path: string,
    body?: object,
    status = 200,
  ): Promise<T> {
    const r = await fetch(base + path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await r.json();
    assert.equal(r.status, status, JSON.stringify(payload));
    return payload as T;
  }
  async function command(path: string, body: object) {
    return api<{ id: string; status?: string }>("POST", path, body);
  }
  await command("/session/organization", { organizationId: org });
  const frames: { type: string; entityId?: string; lastEventId?: string }[] =
    [];
  async function connect(lastEventId = "0") {
    const ws = new WebSocket(
      `ws://wapphub-core-api:3000/api/v1/realtime?lastEventId=${lastEventId}`,
      { headers: { origin, cookie } },
    );
    sockets.push(ws);
    ws.on("message", (x) => frames.push(JSON.parse(x.toString())));
    ws.on("error", () => {});
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    return ws;
  }
  async function wait(fn: () => boolean) {
    const end = Date.now() + 6000;
    while (!fn()) {
      assert.ok(Date.now() < end, "Realtime deadline");
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  const ws = await connect();
  await wait(() => frames.some((f) => f.type === "sync.checkpoint"));
  const checkpoint = frames.at(-1)!.lastEventId!;
  await api("PUT", "/providers/demo", { enabled: true });
  const demoContacts = await api<{ enabled: boolean; items: { contactId: string; conversationId: string }[] }>("GET", "/providers/demo/contacts");
  assert.equal(demoContacts.enabled, true);
  assert.equal(demoContacts.items.length, 2);
  const demoContact = demoContacts.items[0]!;
  const initialPage = await api<{ items: { direction: string; senderContactId: string | null }[] }>("GET", `/conversations/${demoContact.conversationId}/messages`);
  assert.equal(initialPage.items[0]?.direction, "INBOUND");
  assert.equal(initialPage.items[0]?.senderContactId, demoContact.contactId);
  const externalMessageId = randomUUID();
  const inbound = await api<{ id: string; direction: string; senderUserId: string | null; senderContactId: string }>("POST", "/providers/demo/messages", {
    contactId: demoContact.contactId,
    externalMessageId,
    body: "Smoke received from Demo contact",
  });
  assert.equal(inbound.direction, "INBOUND");
  assert.equal(inbound.senderUserId, null);
  assert.equal(inbound.senderContactId, demoContact.contactId);
  assert.equal((await api("POST", "/providers/demo/messages", {
    contactId: demoContact.contactId,
    externalMessageId,
    body: "Smoke received from Demo contact",
  })).id, inbound.id);
  await wait(() => frames.some((f) => f.type === "message.created" && f.entityId === inbound.id));
  const demoOutbound = await api<{ id: string; direction: string; senderUserId: string }>("POST", `/conversations/${demoContact.conversationId}/messages`, {
    clientMessageId: randomUUID(),
    body: "Smoke reply from agent",
  });
  assert.equal(demoOutbound.direction, "OUTBOUND");
  assert.equal(demoOutbound.senderUserId, user);
  await wait(() => frames.some((f) => f.type === "message.created" && f.entityId === demoOutbound.id));
  await api("PUT", "/providers/demo", { enabled: false });
  await api("POST", "/providers/demo/messages", {
    contactId: demoContact.contactId,
    externalMessageId: randomUUID(),
    body: "Should be blocked while disabled",
  }, 409);
  await api("POST", `/conversations/${demoContact.conversationId}/messages`, {
    clientMessageId: randomUUID(),
    body: "Should be blocked while disabled",
  }, 409);
  const disabledMessages = await api<{ items: { id: string }[] }>("GET", `/conversations/${demoContact.conversationId}/messages`);
  assert.equal(disabledMessages.items.length, 3);
  await api("PUT", "/providers/demo", { enabled: true });
  const reactivatedContacts = await api<{ items: { contactId: string; conversationId: string }[] }>("GET", "/providers/demo/contacts");
  assert.equal(reactivatedContacts.items.length, 2);
  assert.equal(reactivatedContacts.items[0]?.conversationId, demoContact.conversationId);
  const reactivatedMessages = await api<{ items: { id: string }[] }>("GET", `/conversations/${demoContact.conversationId}/messages`);
  assert.equal(reactivatedMessages.items.length, 3);
  const contact = await command("/contacts", {
    name: "Smoke contact",
    primaryIdentifier: randomUUID(),
  });
  const convo = await command("/conversations", { contactId: contact.id });
  await command(`/conversations/${convo.id}/assign`, { userId: user });
  const clientMessageId = randomUUID(),
    message = await command(`/conversations/${convo.id}/messages`, {
      clientMessageId,
      body: "Smoke internal message",
    });
  assert.equal(
    (
      await command(`/conversations/${convo.id}/messages`, {
        clientMessageId,
        body: "Smoke internal message",
      })
    ).id,
    message.id,
  );
  await wait(() =>
    frames.some(
      (f) => f.type === "message.created" && f.entityId === message.id,
    ),
  );
  ws.close();
  frames.length = 0;
  await connect(checkpoint);
  await wait(() =>
    frames.some((f) => f.type === "message.created" && f.entityId === message.id) &&
      frames.some((f) => f.type === "message.created" && f.entityId === demoOutbound.id),
  );
  await command(`/conversations/${convo.id}/notes`, { body: "Smoke note" });
  await command(`/conversations/${convo.id}/archive`, {});
  await command(`/conversations/${convo.id}/unarchive`, {});
  for (const path of [
    "/health",
    "/health/ready",
    `/conversations/${convo.id}/messages`,
  ])
    assert.equal((await fetch(base + path, { headers })).status, 200);
  process.stdout.write(
    "M1 HTTP/WebSocket smoke: Demo provision, inbound/outbound, disabled/re-enabled, idempotency, live events and replay passed\n",
  );
} catch {
  process.stderr.write("M1 HTTP/WebSocket smoke failed\n");
  process.exitCode = 1;
} finally {
  for (const s of sockets) s.terminate();
  if (org) {
    const where = { organizationId: org };
    await db.realtimeEvent.deleteMany({ where });
    await db.internalNote.deleteMany({ where });
    await db.conversationAssignmentHistory.deleteMany({ where });
    await db.conversationTag.deleteMany({ where });
    await db.message.deleteMany({ where });
    await db.conversation.deleteMany({ where });
    await db.contactIdentity.deleteMany({ where });
    await db.channel.deleteMany({ where });
    await db.contact.deleteMany({ where });
    await db.auditEvent.deleteMany({ where });
  }
  if (user) {
    await db.securityEvent.deleteMany({ where: { userId: user } });
    await db.session.deleteMany({ where: { userId: user } });
    await db.membership.deleteMany({ where: { userId: user } });
    await db.user.delete({ where: { id: user } });
  }
  if (org) await db.organization.delete({ where: { id: org } });
  await db.$disconnect();
}
