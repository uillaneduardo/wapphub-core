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
  async function command(path: string, body: object) {
    const r = await fetch(base + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    assert.equal(r.status, 200);
    return (await r.json()) as { id: string; status?: string };
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
    frames.some(
      (f) => f.type === "message.created" && f.entityId === message.id,
    ),
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
    "M1 real HTTP/WebSocket smoke: commands, idempotency, live events and reconnect passed\n",
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
