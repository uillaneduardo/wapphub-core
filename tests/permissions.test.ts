import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import WebSocket from "ws";
import { buildApp } from "../src/http/app.js";
import { loadConfig } from "../src/infrastructure/config.js";
import { installChatRBAC } from "../src/application/chat-rbac.js";
import { digest, newToken } from "../src/infrastructure/crypto.js";
import { permissionCatalog, resourceCatalog, resolvePermissions } from "../src/domain/resources.js";
if (process.env.NODE_ENV !== "test" || !new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")) throw new Error("RBAC tests require an isolated _test database");
const db = new PrismaClient(), config = loadConfig({ ...process.env, WEB_ORIGINS: "https://web-client.example.test" });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1 });
redis.on("error", () => {});
const app = await buildApp(config, db, redis, false);
const ids: string[] = [], users: string[] = [];
type Actor = { userId: string; membershipId: string; token: string; csrf: string; sessionId: string };
let orgA: string, orgB: string, owner: Actor, owner2: Actor, supervisor: Actor, agent: Actor, foreign: Actor, second: Actor, base: string;
async function actor(role: string, organizationId: string, userId?: string): Promise<Actor> {
  const user = userId ? await db.user.findUniqueOrThrow({ where: { id: userId } }) : await db.user.create({ data: { name: "RBAC fixture", email: `${randomUUID()}@example.test`, passwordHash: "not-a-login-fixture" } });
  if (!userId) users.push(user.id);
  const r = await db.role.findUniqueOrThrow({ where: { code: role } });
  const membership = await db.membership.upsert({ where: { userId_organizationId: { userId: user.id, organizationId } }, create: { userId: user.id, organizationId, roleId: r.id }, update: {} });
  const token = newToken(), csrf = newToken();
  const session = await db.session.create({ data: { userId: user.id, tokenHash: digest(token), csrfHash: digest(csrf), currentOrganizationId: organizationId, expiresAt: new Date(Date.now() + 3600000) } });
  return { userId: user.id, membershipId: membership.id, sessionId: session.id, token, csrf };
}
async function request(a: Actor, method: "GET" | "PUT" | "POST", url: string, payload?: unknown, status = 200) {
  const result = await app.inject({ method, url, payload: payload as never, headers: { cookie: `wapphub_session=${a.token}`, origin: config.origins[0]!, "x-csrf-token": a.csrf } });
  assert.equal(result.statusCode, status, result.body);
  return result.json();
}
const path = (id: string) => `/api/v1/team/members/${id}/permissions`;
const read = (a: Actor, target = agent) => request(a, "GET", path(target.membershipId));
const update = async (a: Actor, target: Actor, grants: string[], revocations: string[], status = 200, version?: number) => request(a, "PUT", path(target.membershipId), { expectedVersion: version ?? (await read(owner, target)).version, grants, revocations }, status);
const bootstrap = (a: Actor) => request(a, "GET", "/api/v1/app/bootstrap");
before(async () => {
  await db.$transaction((tx) => installChatRBAC(tx));
  orgA = (await db.organization.create({ data: { name: "RBAC A" } })).id;
  orgB = (await db.organization.create({ data: { name: "RBAC B" } })).id; ids.push(orgA, orgB);
  owner = await actor("OWNER", orgA); owner2 = await actor("OWNER", orgA); supervisor = await actor("SUPERVISOR", orgA); agent = await actor("AGENT", orgA); second = await actor("AGENT", orgA, agent.userId); foreign = await actor("OWNER", orgB);
  await actor("AGENT", orgB, agent.userId);
  await app.listen({ port: 0, host: "127.0.0.1" }); base = app.server.address() && typeof app.server.address() !== "string" ? `ws://127.0.0.1:${(app.server.address() as { port: number }).port}` : "";
});
beforeEach(async () => {
  await db.membershipPermissionOverride.deleteMany({ where: { organizationId: { in: ids } } });
  await db.membership.updateMany({ where: { organizationId: { in: ids } }, data: { status: "ACTIVE", permissionVersion: { increment: 1 } } });
  await db.user.updateMany({ where: { id: { in: users } }, data: { status: "ACTIVE" } });
  await db.session.updateMany({ where: { id: { in: [agent.sessionId, second.sessionId] } }, data: { currentOrganizationId: orgA } });
});
after(async () => {
  await app.close();
  await db.auditEvent.deleteMany({ where: { organizationId: { in: ids } } });
  await db.session.deleteMany({ where: { userId: { in: users } } });
  await db.realtimeEvent.deleteMany({ where: { organizationId: { in: ids } } });
  await db.conversation.deleteMany({ where: { organizationId: { in: ids } } });
  await db.contact.deleteMany({ where: { organizationId: { in: ids } } });
  await db.membership.deleteMany({ where: { organizationId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.organization.deleteMany({ where: { id: { in: ids } } });
  await redis.quit(); await db.$disconnect();
});
test("catalog is unique, base resources automatic, future resources unlaunched and default M1 profiles preserved", async () => {
  assert.equal(new Set(permissionCatalog.map((p) => p.code)).size, permissionCatalog.length);
  assert.equal(new Set(resourceCatalog.map((p) => p.code)).size, resourceCatalog.length);
  assert.ok(resourceCatalog.filter((r) => r.availability !== "AVAILABLE").every((r) => r.permissions.length === 0));
  const catalog = await request(agent, "GET", "/api/v1/resources"); assert.equal(catalog.items.length, resourceCatalog.length);
  const a = await bootstrap(agent), s = await bootstrap(supervisor), o = await bootstrap(owner);
  assert.ok(a.permissions.includes("conversations.assign") && a.permissions.includes("conversations.transfer"));
  assert.ok(!a.permissions.includes("conversations.supervise") && !a.permissions.includes("team.read"));
  assert.ok(s.permissions.includes("conversations.supervise") && s.permissions.includes("team.read"));
  assert.ok(!s.permissions.includes("team.permissions.manage") && !s.permissions.includes("providers.manage"));
  assert.ok(o.permissions.includes("team.permissions.manage") && o.permissions.includes("providers.manage"));
  assert.ok(!o.permissions.some((p: string) => p.startsWith("platform.")));
  assert.deepEqual(resolvePermissions({ role: { permissions: [{ permission: { code: "platform.admin" } }] } }), []);
});
test("individual grants, revocations and restore persist atomically with before/after audit", async () => {
  const value = await update(owner, agent, ["tags.manage"], ["messages.send"]);
  assert.ok(value.effective.includes("tags.manage") && !value.effective.includes("messages.send"));
  assert.ok(value.inherited.includes("messages.send")); assert.deepEqual(value.grants, ["tags.manage"]);
  const rows = await db.auditEvent.findMany({ where: { targetMembershipId: agent.membershipId, action: "MEMBER_PERMISSIONS_UPDATED" }, orderBy: { occurredAt: "desc" } });
  assert.equal(rows[0]!.organizationId, orgA); assert.equal(rows[0]!.actorUserId, owner.userId);
  assert.deepEqual((rows[0]!.details as { after: { revocations: string[] } }).after.revocations, ["messages.send"]);
  const restored = await request(owner, "POST", path(agent.membershipId) + "/reset", { expectedVersion: value.version });
  assert.deepEqual(restored.grants, []); assert.deepEqual(restored.revocations, []); assert.ok(restored.effective.includes("messages.send"));
  assert.ok(await db.auditEvent.findFirst({ where: { targetMembershipId: agent.membershipId, action: "MEMBER_PERMISSIONS_RESTORED" } }));
});
test("deny by default, tenant isolation, self-edit and unknown/global/future permissions", async () => {
  await request(agent, "GET", "/api/v1/team/directory", undefined, 403);
  await request(supervisor, "GET", path(agent.membershipId), undefined, 403);
  await request(owner, "GET", path(foreign.membershipId), undefined, 404);
  await request(owner, "PUT", path(foreign.membershipId), { expectedVersion: 0, grants: [], revocations: [] }, 404);
  await update(owner, owner, [], [], 403);
  await request(owner, "POST", path(owner.membershipId) + "/reset", { expectedVersion: 0 }, 403);
  for (const code of ["platform.admin", "chat.bots", "organization.read", "billing.read"]) await update(owner, agent, [code], [], 400);
  await update(owner, agent, ["tags.read"], ["tags.read"], 400);
  const memberships = await db.membership.findMany({ where: { userId: agent.userId } });
  await update(owner, agent, ["tags.manage"], []);
  await request(agent, "POST", "/api/v1/session/organization", { organizationId: orgB });
  assert.ok(!(await bootstrap(agent)).permissions.includes("tags.manage"));
  assert.equal(memberships.length, 2);
});
test("delegated administrators cannot elevate themselves, delegate absent authority or strand the last functional Owner", async () => {
  await update(owner, supervisor, ["team.permissions.manage"], []);
  const result = await request(supervisor, "PUT", path(supervisor.membershipId), { expectedVersion: (await read(owner, supervisor)).version, grants: ["providers.manage"], revocations: [] }, 403);
  assert.equal(result.error.code, "SELF_PERMISSION_CHANGE_DENIED");
  await request(supervisor, "PUT", path(agent.membershipId), { expectedVersion: (await read(owner)).version, grants: ["providers.manage"], revocations: [] }, 403);
  await update(owner, owner2, [], ["team.permissions.manage"]);
  const denied = await request(supervisor, "PUT", path(owner.membershipId), { expectedVersion: (await read(owner, owner)).version, grants: [], revocations: ["team.permissions.manage"] }, 409);
  assert.equal(denied.error.code, "LAST_FUNCTIONAL_OWNER_REQUIRED");
});
test("concurrent updates use optimistic revision; no lost update or partial audit", async () => {
  const version = (await read(owner)).version;
  const send = (a: Actor, revocations: string[]) => app.inject({ method: "PUT", url: path(agent.membershipId), headers: { cookie: `wapphub_session=${a.token}`, origin: config.origins[0]!, "x-csrf-token": a.csrf }, payload: { expectedVersion: version, grants: [], revocations } });
  const beforeCount = await db.auditEvent.count({ where: { targetMembershipId: agent.membershipId, action: "MEMBER_PERMISSIONS_UPDATED" } });
  const responses = await Promise.all([send(owner, ["messages.send"]), send(owner2, ["contacts.write"])]);
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal((await read(owner)).version, version + 1);
  assert.equal(await db.auditEvent.count({ where: { targetMembershipId: agent.membershipId, action: "MEMBER_PERMISSIONS_UPDATED" } }), beforeCount + 1);
});
test("revisions apply to simultaneous sessions, providers, roster and disabled members", async () => {
  await update(owner, agent, ["providers.manage"], ["messages.read"]);
  for (const a of [agent, second]) {
    const context = await bootstrap(a); assert.ok(context.permissions.includes("providers.manage") && !context.permissions.includes("messages.read"));
    await request(a, "GET", "/api/v1/providers");
  }
  const roster = await request(owner, "GET", "/api/v1/team/members");
  assert.equal(roster.items.find((row: { userId: string }) => row.userId === agent.userId).canReceiveAssignment, false);
  await db.membership.update({ where: { id: agent.membershipId }, data: { status: "SUSPENDED" } });
  await request(agent, "GET", "/api/v1/resources", undefined, 403);
  assert.deepEqual((await read(owner)).effective, []);
});
test("REST validation rejects missing CSRF, Origin, revision, duplicate and extra fields", async () => {
  for (const payload of [{ grants: [], revocations: [] }, { expectedVersion: -1, grants: [], revocations: [] }, { expectedVersion: 0, grants: ["tags.read", "tags.read"], revocations: [] }, { expectedVersion: 0, grants: [], revocations: [], organizationId: orgB }]) await request(owner, "PUT", path(agent.membershipId), payload, 400);
  const payload = { expectedVersion: (await read(owner)).version, grants: [], revocations: [] };
  for (const headers of [{ cookie: `wapphub_session=${owner.token}`, origin: config.origins[0]! }, { cookie: `wapphub_session=${owner.token}`, "x-csrf-token": owner.csrf }]) assert.equal((await app.inject({ method: "PUT", url: path(agent.membershipId), headers, payload })).statusCode, 403);
});
async function socket(a: Actor, endpoint = "/api/v1/realtime") {
  const ws = new WebSocket(base + endpoint, { headers: { cookie: `wapphub_session=${a.token}`, origin: config.origins[0]! } });
  await new Promise<void>((resolve, reject) => { ws.once("error", reject); ws.once("message", () => resolve()); });
  return ws;
}
test("permission changes invalidate all old realtime streams without requiring login", { timeout: 10000 }, async () => {
  const sockets = await Promise.all([socket(agent), socket(second)]);
  const closed = sockets.map((ws) => new Promise<number>((resolve) => ws.once("close", (code) => resolve(code))));
  await update(owner, agent, [], ["conversations.read"]);
  assert.deepEqual(await Promise.all(closed), [4003, 4003]);
  assert.ok(!(await bootstrap(agent)).permissions.includes("conversations.read"));
  const control = await socket(agent, "/api/v1/session/updates");
  const changed = new Promise<number>((resolve) => control.once("close", (code) => resolve(code)));
  await request(owner, "POST", path(agent.membershipId) + "/reset", { expectedVersion: (await read(owner)).version });
  assert.equal(await changed, 4003); assert.ok((await bootstrap(agent)).permissions.includes("conversations.read"));
});

test("concurrent revocations on different Owners cannot eliminate the last functional Owner", async () => {
  await update(owner, supervisor, ["team.permissions.manage"], []);
  const versions = new Map([[owner.membershipId, (await read(owner, owner)).version], [owner2.membershipId, (await read(owner, owner2)).version]]);
  const send = async (target: Actor) => app.inject({ method: "PUT", url: path(target.membershipId), headers: { cookie: `wapphub_session=${supervisor.token}`, origin: config.origins[0]!, "x-csrf-token": supervisor.csrf }, payload: { expectedVersion: versions.get(target.membershipId), grants: [], revocations: ["team.permissions.manage"] } });
  const results = await Promise.all([send(owner), send(owner2)]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal(results.find((r) => r.statusCode === 409)!.json().error.code, "LAST_FUNCTIONAL_OWNER_REQUIRED");
});
test("effective revocations are enforced by assignment and provider endpoints, not only bootstrap", async () => {
  await update(owner, agent, ["providers.manage"], ["messages.read"]);
  const contact = await request(owner, "POST", "/api/v1/contacts", { name: "Override fixture", primaryIdentifier: randomUUID() });
  const conversation = await request(owner, "POST", "/api/v1/conversations", { contactId: contact.id });
  const denied = await request(owner, "POST", `/api/v1/conversations/${conversation.id}/assign`, { userId: agent.userId }, 409);
  assert.equal(denied.error.code, "ASSIGNEE_PERMISSION_REQUIRED");
  await request(owner, "POST", path(agent.membershipId) + "/reset", { expectedVersion: (await read(owner)).version });
  await request(agent, "GET", "/api/v1/providers", undefined, 403);
});

test("delegated managers may preserve existing overrides outside their authority, but cannot edit them", async () => {
  await update(owner, supervisor, ["team.permissions.manage"], []);
  await update(owner, agent, ["providers.manage"], []);
  const current = await read(supervisor);
  await request(supervisor, "PUT", path(agent.membershipId), { expectedVersion: current.version, grants: ["providers.manage"], revocations: ["messages.send"] });
  await request(supervisor, "PUT", path(agent.membershipId), { expectedVersion: (await read(supervisor)).version, grants: [], revocations: ["messages.send"] }, 403);
});
