import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import WebSocket from "ws";
import { buildApp } from "../src/http/app.js";
import { loadConfig } from "../src/infrastructure/config.js";
import { digest, newToken, hashPassword } from "../src/infrastructure/crypto.js";
import { Chat } from "../src/application/chat.js";
import { DemoProvider } from "../src/integrations/demo-provider.js";
import { MessageIngestionService } from "../src/application/message-ingestion.js";
import { WebConnections } from "../src/application/web-connections.js";
import { WebIngestion } from "../src/application/web-ingestion.js";
import { WebProviderWorker } from "../src/application/web-provider-worker.js";
import { WebProviderError, type WebProviderPort, type ProviderScope, type Delivery, type InternalAction } from "../src/integrations/web-provider-client.js";
import { providerDeduplicationId, type ProviderEvent } from "../contracts/provider.js";
import type { ProviderSession, ProviderQr } from "../contracts/provider-internal.js";
import { chatPermissions } from "../src/domain/chat.js";
if (process.env.NODE_ENV !== "test" || !new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")) throw new Error("Web provider tests require isolated test infrastructure");
const config = loadConfig({ ...process.env, NODE_ENV: "test", WEB_ORIGINS: "https://web-client.example.test", PROVIDER_WEB_ENABLED: "true" });
const db = new PrismaClient(), redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1 }); redis.on("error", () => {});
const origin = config.origins[0]!;
class FakeProvider implements WebProviderPort {
  views = new Map<string, ProviderSession>(); events: Delivery[] = []; calls: string[] = []; acked: string[] = []; nacked: string[] = [];
  fail = false; qrValue: ProviderQr = { qr: "SYNTHETIC_PRIVATE_QR", revision: 1, expiresAt: new Date(Date.now() + 20000).toISOString() }; qrHook?: () => Promise<void>;
  async ready() { return !this.fail; }
  async create(scope: ProviderScope) { this.calls.push("create"); if (!this.views.has(scope.connectionId)) this.views.set(scope.connectionId, { state: "DISCONNECTED", revision: 0, qrRevision: 0, attempts: 0, connectEnabled: true }); return this.session(scope); }
  async session(scope: ProviderScope) { if (this.fail) throw new WebProviderError("PROVIDER_UNAVAILABLE"); const view = this.views.get(scope.connectionId); if (!view) throw new WebProviderError("SESSION_NOT_FOUND", 404); return view; }
  async command(scope: ProviderScope, action: InternalAction) { this.calls.push(action); const old = await this.session(scope); const view: ProviderSession = { ...old, state: action === "logout" ? "LOGGED_OUT" : "CONNECTING", revision: old.revision + 1 }; this.views.set(scope.connectionId, view); return view; }
  async qr() { await this.qrHook?.(); if (this.fail) throw new WebProviderError("PROVIDER_UNAVAILABLE"); return this.qrValue; }
  async pull(scope: ProviderScope) { return this.events.filter((item) => item.event.connectionId === scope.connectionId); }
  async ack(_scope: ProviderScope, eventId: string) { this.acked.push(eventId); this.events = this.events.filter((item) => item.event.eventId !== eventId); }
  async nack(_scope: ProviderScope, eventId: string) { this.nacked.push(eventId); }
}
const provider = new FakeProvider(), app = await buildApp(config, db, redis, false, undefined, provider);
const chat = new Chat(db, config, async (org) => { await redis.publish(`wapphub:realtime:${org}`, "wake"); }, new DemoProvider(), new MessageIngestionService());
const connections = new WebConnections(db, chat, provider), worker = new WebProviderWorker(db, chat, provider), ingestion = new WebIngestion(chat);
type Auth = { userId: string; sessionId: string; cookie: string; csrf: string };
let orgA: string, orgB: string, owner: Auth, other: Auth, denied: Auth, manager: Auth, channelId: string, baseUrl: string;
const users: string[] = [], roles: string[] = [];
async function auth(organizationId: string, codes: readonly string[]): Promise<Auth> {
  const role = await db.role.create({ data: { code: `web-${randomUUID()}` } }); roles.push(role.id);
  for (const code of codes) { const permission = await db.permission.upsert({ where: { code }, create: { code }, update: {} }); await db.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } }); }
  const user = await db.user.create({ data: { name: "Synthetic web test", email: `${randomUUID()}@example.test`, passwordHash: await hashPassword(newToken()) } }); users.push(user.id);
  await db.membership.create({ data: { userId: user.id, organizationId, roleId: role.id } });
  const token = newToken(), csrf = newToken(); const session = await db.session.create({ data: { userId: user.id, tokenHash: digest(token), csrfHash: digest(csrf), currentOrganizationId: organizationId, expiresAt: new Date(Date.now() + 3600000) } });
  return { userId: user.id, sessionId: session.id, cookie: `wapphub_session=${token}`, csrf };
}
async function request(a: Auth, method: "GET" | "POST" | "PUT", path: string, payload?: unknown, status = 200) {
  const response = await app.inject({ method, url: `/api/v1${path}`, headers: { origin, cookie: a.cookie, "x-csrf-token": a.csrf }, ...(payload === undefined ? {} : { payload: payload as object }) });
  assert.equal(response.statusCode, status, response.body); return response;
}
const route = "/providers/whatsapp-web/connections";
const scope = () => ({ organizationId: orgA, connectionId: channelId });
async function current() { return (await request(owner, "GET", route)).json().connection; }
async function command(action: InternalAction | "disconnect", commandId = randomUUID(), version?: number, status = 200) {
  return request(owner, "POST", `${route}/${channelId}/commands`, { commandId, action, expectedVersion: version ?? (await current()).version }, status);
}
async function state(value: ProviderSession["state"], revision: number, qrRevision = 0) { provider.views.set(channelId, { state: value, revision, qrRevision, attempts: 0, connectEnabled: true }); await worker.runConnection(scope()); }
function event(type: "message.received" | "message.sent" | "message.updated", id: string, body = "  Original\n😀  "): ProviderEvent {
  return { version: 1, eventId: randomUUID(), correlationId: randomUUID(), organizationId: orgA, connectionId: channelId, provider: "WHATSAPP_WEB", occurredAt: new Date().toISOString(), deduplicationId: providerDeduplicationId({ ...scope(), provider: "WHATSAPP_WEB", type, externalId: id, revision: type === "message.updated" ? body : "" }), capabilities: { contentTypes: ["TEXT"], receipts: "PROVIDER", messageDeletion: false, groups: false, unofficial: true }, type,
    data: type === "message.updated" ? { providerMessageId: id, status: body as "READ" } : { providerMessageId: id, providerConversationId: "synthetic@s.whatsapp.net", direction: type === "message.sent" ? "OUTBOUND" : "INBOUND", sender: { origin: type === "message.sent" ? "DEVICE" : "CONTACT", externalId: "synthetic@s.whatsapp.net" }, content: { type: "TEXT", originalBody: body, transmittedBody: "Presented: " + body }, status: "SENT" } } as ProviderEvent;
}
before(async () => {
  orgA = (await db.organization.create({ data: { name: `Web A ${randomUUID()}` } })).id; orgB = (await db.organization.create({ data: { name: `Web B ${randomUUID()}` } })).id;
  owner = await auth(orgA, [...chatPermissions, "providers.manage", "providers.simulate"]); other = await auth(orgB, ["providers.manage"]); denied = await auth(orgA, ["conversations.read"]); manager = await auth(orgA, ["providers.manage"]);
  baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
});
after(async () => {
  await app.close(); const where = { organizationId: { in: [orgA, orgB] } };
  await db.providerInbox.deleteMany({ where });
  await db.providerCommand.deleteMany({ where });
  await db.providerConnection.deleteMany({ where });
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
  await db.session.deleteMany({ where: { userId: { in: users } } }); await db.membership.deleteMany({ where: { userId: { in: users } } }); await db.securityEvent.deleteMany({ where: { userId: { in: users } } }); await db.user.deleteMany({ where: { id: { in: users } } }); await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } }); await db.rolePermission.deleteMany({ where: { roleId: { in: roles } } }); await db.role.deleteMany({ where: { id: { in: roles } } }); await db.$disconnect(); await redis.quit();
});
test("Core permissions protect every connection endpoint and CSRF remains required", async () => {
  await request(denied, "GET", route, undefined, 403); await request(denied, "POST", route, { commandId: randomUUID() }, 403);
  const r = await app.inject({ method: "POST", url: `/api/v1${route}`, headers: { origin, cookie: owner.cookie }, payload: { commandId: randomUUID() } }); assert.equal(r.statusCode, 403);
  const unauth = await app.inject({ method: "GET", url: `/api/v1${route}` }); assert.equal(unauth.statusCode, 401);
});
test("creation is durable, idempotent and idle; catalog preserves Demo and Meta", async () => {
  assert.equal((await request(owner, "GET", route)).json().connection, null);
  const id = randomUUID(), first = (await request(owner, "POST", route, { commandId: id })).json(); channelId = first.id;
  assert.equal(first.uiState, "DISCONNECTED"); assert.equal(first.operation.status, "PENDING"); assert.equal(provider.calls.length, 0);
  assert.equal((await request(owner, "POST", route, { commandId: id })).json().id, channelId);
  await worker.runConnection(scope()); assert.equal((await current()).operation.status, "COMPLETED"); assert.ok(!provider.calls.includes("connect"));
  assert.deepEqual((await request(owner, "GET", "/providers")).json().items.map((item: { code: string }) => item.code), ["DEMO", "META", "WHATSAPP_WEB"]);
});
test("commands and QR are tenant scoped without internal endpoint exposure", async () => {
  assert.equal((await request(other, "GET", route)).json().connection, null);
  await request(other, "GET", `${route}/${channelId}/qr`, undefined, 404); await request(other, "POST", `${route}/${channelId}/commands`, { commandId: randomUUID(), action: "connect", expectedVersion: 1 }, 404);
  await request(denied, "GET", `${route}/${channelId}/qr`, undefined, 403); await request(denied, "POST", `${route}/${channelId}/commands`, { commandId: randomUUID(), action: "connect", expectedVersion: 1 }, 403);
  assert.equal((await app.inject({ url: `/internal/v1/organizations/${orgA}/connections/${channelId}` })).statusCode, 404);
});
test("explicit connect is versioned, duplicate commands do not start duplicate sessions", async () => {
  const version = (await current()).version, id = randomUUID(); await command("connect", id, version); await command("connect", id, version);
  await command("disconnect", randomUUID(), version, 409); await worker.runConnection(scope()); assert.equal(provider.calls.filter((call) => call === "connect").length, 1); assert.equal((await current()).uiState, "CONNECTING");
  await command("disconnect", id, version, 409);
});
test("QR has restricted no-store access and never appears in audit or realtime", async () => {
  await state("QR_REQUIRED", 2, 1); provider.qrValue = { qr: "SYNTHETIC_PRIVATE_QR", revision: 1, expiresAt: new Date(Date.now() + 20000).toISOString() };
  const result = await request(owner, "GET", `${route}/${channelId}/qr`); assert.equal(result.json().qr, provider.qrValue.qr); assert.ok(result.json().expiresInMs <= 20000); assert.equal(result.headers["cache-control"], "no-store, private");
  const audits = await db.auditEvent.findMany({ where: { organizationId: orgA } }); assert.ok(audits.some((a) => a.action === "WHATSAPP_WEB_QR_VIEWED")); assert.ok(!JSON.stringify(audits).includes(provider.qrValue.qr));
  const frames = (await request(owner, "GET", "/providers/realtime/events")).json().events; assert.ok(frames.length); assert.ok(frames.every((frame: { type: string }) => frame.type === "provider.connection.updated")); assert.ok(!JSON.stringify(frames).includes(provider.qrValue.qr));
});
test("expired, stale generation and unavailable QR are rejected", async () => {
  provider.qrValue.expiresAt = new Date(Date.now() - 1).toISOString(); await request(owner, "GET", `${route}/${channelId}/qr`, undefined, 409);
  provider.qrValue.expiresAt = new Date(Date.now() + 20000).toISOString(); provider.qrValue.revision = 99; await request(owner, "GET", `${route}/${channelId}/qr`, undefined, 409); provider.qrValue.revision = 1;
  provider.fail = true; await request(owner, "GET", `${route}/${channelId}/qr`, undefined, 503); provider.fail = false;
});
test("QR reauthorizes after a remote read when organization or membership changes", async () => {
  provider.qrHook = async () => { await db.session.update({ where: { id: owner.sessionId }, data: { currentOrganizationId: orgB } }); };
  await request(owner, "GET", `${route}/${channelId}/qr`, undefined, 401); await db.session.update({ where: { id: owner.sessionId }, data: { currentOrganizationId: orgA } });
  provider.qrHook = async () => { await db.membership.updateMany({ where: { userId: owner.userId, organizationId: orgA }, data: { status: "INACTIVE" } }); };
  await request(owner, "GET", `${route}/${channelId}/qr`, undefined, 403); await db.membership.updateMany({ where: { userId: owner.userId }, data: { status: "ACTIVE" } }); provider.qrHook = undefined;
});
test("refresh is explicit and cannot disrupt an already connected session", async () => {
  await command("refresh"); await worker.runConnection(scope()); assert.equal((await current()).uiState, "CONNECTING"); await state("CONNECTED", 4, 2);
  await command("refresh", randomUUID(), undefined, 409); assert.equal((await current()).uiState, "CONNECTED"); assert.equal((await current()).sendingEnabled, false);
});
test("disconnect revokes the provider link and records the administrative action", async () => {
  await command("disconnect"); await worker.runConnection(scope()); assert.equal((await current()).state, "LOGGED_OUT"); assert.equal((await current()).uiState, "DISCONNECTED"); assert.ok(provider.calls.includes("logout"));
  assert.ok(await db.auditEvent.count({ where: { organizationId: orgA, action: "WHATSAPP_WEB_DISCONNECT_REQUESTED" } }));
});
test("Worker rechecks revoked permissions before executing an explicit command", async () => {
  await command("connect"); const membership = await db.membership.findFirstOrThrow({ where: { userId: owner.userId, organizationId: orgA } }); const permission = await db.permission.findUniqueOrThrow({ where: { code: "providers.manage" } });
  await db.membershipPermissionOverride.create({ data: { organizationId: orgA, membershipId: membership.id, permissionId: permission.id, effect: "REVOKE" } }); const before = provider.calls.length;
  await worker.runConnection(scope()); assert.equal(provider.calls.length, before); assert.equal((await db.providerCommand.findFirstOrThrow({ where: { channelId, status: "FAILED" } })).errorCode, "COMMAND_AUTHORIZATION_REVOKED");
  await db.membershipPermissionOverride.deleteMany({ where: { membershipId: membership.id } });
});
test("lease prevents concurrent consumers and expired fencing rejects writes", async () => {
  const token = await connections.claim({ organizationId: orgA, channelId }); assert.ok(token); assert.equal(await connections.claim({ organizationId: orgA, channelId }), null);
  const before = provider.calls.length; await Promise.all([worker.runConnection(scope()), worker.runConnection(scope())]); assert.equal(provider.calls.length, before);
  await db.providerConnection.updateMany({ where: { organizationId: orgA, channelId }, data: { leaseUntil: new Date(Date.now() - 1) } });
  await assert.rejects(ingestion.apply(scope(), event("message.received", "stale"), token!), /STALE_PROVIDER_LEASE/);
  await db.providerConnection.updateMany({ where: { organizationId: orgA, channelId }, data: { leaseToken: null, leaseUntil: null } });
});
test("normalized ingress is atomic, deduplicated, scoped, and preserves original content/authorship", async () => {
  const preexisting = await db.contact.create({ data: { organizationId: orgA, name: "Existing contact", primaryIdentifier: "synthetic@s.whatsapp.net" } });
  const incoming = event("message.received", "incoming"), outbound = event("message.sent", "outbound"); const token = (await connections.claim({ organizationId: orgA, channelId }))!;
  assert.equal(await ingestion.apply(scope(), incoming, token), true); assert.equal(await ingestion.apply(scope(), { ...incoming, eventId: randomUUID() }, token), false); await ingestion.apply(scope(), outbound, token);
  await assert.rejects(ingestion.apply({ ...scope(), organizationId: orgB }, incoming, token), /SCOPE_MISMATCH/);
  await assert.rejects(ingestion.apply(scope(), { ...incoming, data: { ...incoming.data, content: { type: "TEXT", originalBody: "Changed" } } }, token), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(ingestion.apply(scope(), { ...incoming, deduplicationId: "a".repeat(64), data: { ...incoming.data, content: { type: "TEXT", originalBody: "  Original\n😀  ", transmittedBody: "Altered" } } }, token), /IDEMPOTENCY_CONFLICT/);
  const messages = await db.message.findMany({ where: { organizationId: orgA, channelId } }); assert.equal(messages.length, 2); assert.ok(messages.every((m) => m.body === "  Original\n😀  " && m.transmittedBody === "Presented:   Original\n😀  " && m.senderUserId === null && m.providerOccurredAt));
  assert.equal(messages.find((m) => m.direction === "INBOUND")?.senderContactId, preexisting.id); assert.equal(messages.find((m) => m.direction === "OUTBOUND")?.senderContactId, null);
  const receipt = event("message.updated", "outbound", "READ"); await ingestion.apply(scope(), receipt, token); await ingestion.apply(scope(), event("message.updated", "outbound", "DELIVERED"), token); assert.equal((await db.message.findFirstOrThrow({ where: { channelId, providerMessageId: "outbound" } })).status, "READ");
  await db.providerConnection.updateMany({ where: { organizationId: orgA, channelId }, data: { leaseToken: null, leaseUntil: null } });
});
test("Core blocks real send while preserving existing conversation/history access", async () => {
  const conversation = await db.conversation.findFirstOrThrow({ where: { organizationId: orgA, channelId } }); const dto = (await request(owner, "GET", `/conversations/${conversation.id}`)).json(); assert.equal(dto.provider, "WHATSAPP_WEB"); assert.equal(dto.outboundEnabled, false);
  assert.equal((await request(owner, "GET", `/conversations/${conversation.id}/messages`)).json().items.length, 2);
  await request(owner, "POST", `/conversations/${conversation.id}/messages`, { body: "Never send", clientMessageId: randomUUID() }, 409);
});
test("commit-before-ack enables durable replay recovery; unsupported events are nacked", async () => {
  const incoming = event("message.received", "replay"), invalid = { ...event("message.sent", "forged"), data: { ...event("message.sent", "forged").data, sender: { origin: "WAPPHUB", userId: owner.userId } } } as ProviderEvent;
  provider.events = [{ event: incoming, leaseId: randomUUID(), attempt: 1 }, { event: invalid, leaseId: randomUUID(), attempt: 1 }]; await worker.runConnection(scope()); assert.ok(provider.acked.includes(incoming.eventId)); assert.ok(provider.nacked.includes(invalid.eventId));
  provider.events = [{ event: { ...incoming, eventId: randomUUID() }, leaseId: randomUUID(), attempt: 2 }]; await worker.runConnection(scope()); assert.equal(await db.message.count({ where: { channelId, providerMessageId: "replay" } }), 1);
});
test("provider-only realtime works without conversation authority and exposes only public IDs", async () => {
  const frames: string[] = []; const ws = new WebSocket(baseUrl.replace("http", "ws") + "/api/v1/providers/realtime", { headers: { origin, cookie: manager.cookie } }); ws.on("message", (data) => frames.push(String(data)));
  await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  const until = Date.now() + 4000; while (!frames.some((f) => f.includes("sync.checkpoint")) && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
  ws.close(); assert.ok(frames.some((f) => f.includes("provider.connection.updated"))); assert.ok(!frames.join("").includes("SYNTHETIC_PRIVATE_QR")); assert.ok(!frames.join("").includes("Original"));
  await request(denied, "GET", "/providers/realtime/events", undefined, 403);
});
test("provider outage is visible without faking lifecycle and recovers without affecting Demo", async () => {
  await state("CONNECTED", 8, 2); provider.fail = true; await worker.runConnection(scope());
  const unavailable = await current(); assert.equal(unavailable.uiState, "CONNECTED"); assert.equal(unavailable.errorCode, "PROVIDER_UNAVAILABLE");
  await request(owner, "PUT", "/providers/demo", { enabled: true }); assert.equal((await request(owner, "GET", "/providers/demo/contacts")).json().enabled, true);
  provider.fail = false; await worker.runConnection(scope()); assert.equal((await current()).errorCode, null);
});
