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
import { syncProgress, recordSyncFailure } from "../src/application/web-sync.js";
import { WebIngestion } from "../src/application/web-ingestion.js";
import { WebProviderWorker } from "../src/application/web-provider-worker.js";
import { WebProviderError, type WebProviderPort, type ProviderScope, type Delivery, type InternalAction } from "../src/integrations/web-provider-client.js";
import { providerDeduplicationId, parseProviderEvent, type ProviderEvent, type SyncItem } from "../contracts/provider.js";
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
  owner = await auth(orgA, [...chatPermissions, "providers.manage", "providers.simulate", "providers.diagnostics.read"]); other = await auth(orgB, ["providers.manage", "providers.diagnostics.read"]); denied = await auth(orgA, ["conversations.read"]); manager = await auth(orgA, ["providers.manage"]);
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

const now = () => new Date(Date.now() - 1000).toISOString();
function syncMessage(externalId: string, id: string, occurredAt = now(), outbound = false): SyncItem {
  return { kind: "message", identity: { externalId }, occurredAt, message: { providerMessageId: id, providerConversationId: externalId, sender: { origin: outbound ? "DEVICE" : "CONTACT", externalId }, direction: outbound ? "OUTBOUND" : "INBOUND", status: "SENT", content: { type: "TEXT", originalBody: "  *Maria:* conteúdo original\n😀  " } } };
}
function syncBatch(items: SyncItem[], historical = true): ProviderEvent {
  const seed = event("message.received", randomUUID());
  return { ...seed, type: "sync.batch", capabilities: { ...seed.capabilities, contentTypes: ["TEXT", "IMAGE", "AUDIO", "VOICE", "VIDEO", "DOCUMENT"] }, data: { items, historical } };
}
async function leased<T>(operation: (token: string) => Promise<T>) {
  const token = await connections.claim({ organizationId: orgA, channelId }); assert.ok(token);
  try { return await operation(token); }
  finally { await db.providerConnection.updateMany({ where: { organizationId: orgA, channelId, leaseToken: token }, data: { leaseToken: null, leaseUntil: null } }); }
}
test("CP4 initial history links verified PN/LID aliases, preserves opaque identities and never merges names", async () => {
  const batch = syncBatch([
    { kind: "contact", identity: { externalId: "551111@s.whatsapp.net", aliases: ["opaque111@lid"], name: "Mesmo nome" } },
    { kind: "contact", identity: { externalId: "opaque222@lid", name: "Mesmo nome" } },
    syncMessage("opaque111@lid", "cp4-alias-incoming"), syncMessage("551111@s.whatsapp.net", "cp4-device-outgoing", now(), true),
  ]);
  await leased((token) => ingestion.apply(scope(), batch, token));
  const identities = await db.contactIdentity.findMany({ where: { organizationId: orgA, channelId, externalId: { in: ["opaque111@lid", "551111@s.whatsapp.net", "opaque222@lid"] } } });
  assert.equal(identities.length, 3); assert.equal(identities.find((row) => row.externalId === "opaque111@lid")!.contactId, identities.find((row) => row.externalId === "551111@s.whatsapp.net")!.contactId);
  assert.notEqual(identities.find((row) => row.externalId === "opaque222@lid")!.contactId, identities[0]!.contactId);
  const incoming = await db.message.findFirstOrThrow({ where: { channelId, providerMessageId: "cp4-alias-incoming" } });
  const outgoing = await db.message.findFirstOrThrow({ where: { channelId, providerMessageId: "cp4-device-outgoing" } });
  assert.equal(incoming.conversationId, outgoing.conversationId); assert.equal(outgoing.senderUserId, null); assert.equal(outgoing.senderContactId, null); assert.equal(incoming.historical, true); assert.equal(incoming.body, "  *Maria:* conteúdo original\n😀  ");
});
test("CP4 deduplicates commit replay and duplicate historical batches with real counters", async () => {
  const item = syncMessage("dedup@lid", "cp4-duplicate"), batch = syncBatch([item]);
  await leased(async (token) => {
    assert.equal(await ingestion.apply(scope(), batch, token), true);
    const count = (await db.providerConnection.findUniqueOrThrow({ where: { organizationId_channelId: { organizationId: orgA, channelId } } })).syncProgress;
    assert.equal(await ingestion.apply(scope(), batch, token), false);
    const before = syncProgress(count), after = syncProgress((await db.providerConnection.findUniqueOrThrow({ where: { organizationId_channelId: { organizationId: orgA, channelId } } })).syncProgress);
    for (const key of ["contacts", "conversations", "messages", "batches", "receivedItems", "processedItems"] as const) assert.equal(after[key], before[key]);
    assert.equal(after.duplicateItems, before.duplicateItems + 1);
    await ingestion.apply(scope(), syncBatch([item]), token);
  });
  assert.equal(await db.message.count({ where: { channelId, providerMessageId: "cp4-duplicate" } }), 1);
});
test("CP4 orders late messages by original timestamp with deterministic cursor pagination and monotonic inbox time", async () => {
  const late = new Date(Date.now() - 86400000).toISOString(), recent = new Date(Date.now() - 60000).toISOString();
  await leased(async (token) => { await ingestion.apply(scope(), syncBatch([syncMessage("ordered@lid", "cp4-newer", recent)]), token); await ingestion.apply(scope(), syncBatch([syncMessage("ordered@lid", "cp4-older", late)]), token); });
  const thread = await db.conversation.findFirstOrThrow({ where: { organizationId: orgA, channelId, providerConversationId: "ordered@lid" } });
  assert.equal(thread.lastMessageAt.toISOString(), recent);
  const first = (await request(owner, "GET", `/conversations/${thread.id}/messages?limit=1`)).json();
  assert.equal(first.items[0].createdAt, recent); assert.ok(first.nextCursor);
  const second = (await request(owner, "GET", `/conversations/${thread.id}/messages?limit=1&before=${encodeURIComponent(first.nextCursor)}`)).json(); assert.equal(second.items[0].createdAt, late);
  assert.equal((await request(owner, "GET", `/conversations/${thread.id}`)).json().lastMessageAt, recent);
});
test("CP4 stores receipts arriving before device messages and never regresses read state", async () => {
  await leased(async (token) => {
    await ingestion.apply(scope(), event("message.updated", "cp4-receipt-before", "READ"), token);
    await ingestion.apply(scope(), syncBatch([syncMessage("receipts@lid", "cp4-receipt-before", now(), true)]), token);
    await ingestion.apply(scope(), event("message.updated", "cp4-receipt-before", "DELIVERED"), token);
  });
  assert.equal((await db.message.findFirstOrThrow({ where: { channelId, providerMessageId: "cp4-receipt-before" } })).status, "READ");
});
test("CP4 metadata preserves manual names, assignment, archived state, tags and notes", async () => {
  const id = "administrative@lid";
  await leased((token) => ingestion.apply(scope(), syncBatch([{ kind: "contact", identity: { externalId: id, name: "Nome externo" } }, syncMessage(id, "cp4-administrative")]), token));
  const thread = await db.conversation.findFirstOrThrow({ where: { channelId, providerConversationId: id } });
  await db.contact.update({ where: { id: thread.contactId }, data: { name: "Nome manual" } });
  await db.conversation.update({ where: { id: thread.id }, data: { assignedUserId: owner.userId, status: "ARCHIVED", archivedAt: new Date(), visibility: "NONE", visibleFromMessage: 999999n } });
  const tag = await db.tag.create({ data: { organizationId: orgA, name: "CP4 tag" } });
  await db.conversationTag.create({ data: { organizationId: orgA, conversationId: thread.id, tagId: tag.id } });
  await db.internalNote.create({ data: { organizationId: orgA, conversationId: thread.id, authorUserId: owner.userId, body: "Nota administrativa", eventSequence: 0n } });
  await leased((token) => ingestion.apply(scope(), syncBatch([{ kind: "conversation", identity: { externalId: id, name: "Novo nome externo" }, metadata: { archived: false, unreadCount: 10 } }], false), token));
  const after = await db.conversation.findUniqueOrThrow({ where: { id: thread.id }, include: { contact: true, tags: true, notes: true } });
  assert.equal(after.contact.name, "Nome manual"); assert.equal(after.assignedUserId, owner.userId); assert.equal(after.status, "ARCHIVED"); assert.equal(after.visibility, "NONE"); assert.equal(after.visibleFromMessage, 999999n); assert.equal(after.tags.length, 1); assert.equal(after.notes[0]?.body, "Nota administrativa");
});
test("CP4 known identity conflicts are isolated and remaining batch items persist", async () => {
  await leased(async (token) => {
    await ingestion.apply(scope(), syncBatch([{ kind: "contact", identity: { externalId: "conflict-a@lid" } }, { kind: "contact", identity: { externalId: "conflict-b@s.whatsapp.net" } }]), token);
    await ingestion.apply(scope(), syncBatch([{ kind: "contact", identity: { externalId: "conflict-b@s.whatsapp.net", aliases: ["conflict-a@lid"] } }, syncMessage("good-after-conflict@lid", "cp4-partial")]), token);
  });
  assert.equal(await db.message.count({ where: { channelId, providerMessageId: "cp4-partial" } }), 1);
  const progress = (await current()).sync; assert.ok(progress.failures >= 1); assert.equal(progress.lastErrorCode, "IDENTITY_MAPPING_CONFLICT");
});
test("CP4 transient persistence failures roll back domain/inbox/progress and permit durable retry", async () => {
  class Broken extends MessageIngestionService { override async persistExternal(): Promise<never> { throw new Error("synthetic persistence outage"); } }
  const broken = new WebIngestion(chat, new Broken()), batch = syncBatch([syncMessage("retry@lid", "cp4-retry")]);
  await leased(async (token) => {
    await assert.rejects(broken.apply(scope(), batch, token), /synthetic persistence outage/);
    assert.equal(await db.message.count({ where: { channelId, providerMessageId: "cp4-retry" } }), 0);
    assert.equal(await db.providerInbox.count({ where: { channelId, deduplicationId: batch.deduplicationId } }), 0);
    await recordSyncFailure(chat, scope(), batch, token, "PERSISTENCE_FAILED");
    assert.equal((await current()).sync.pendingFailures, 1);
    await ingestion.apply(scope(), batch, token);
  });
  assert.equal(await db.message.count({ where: { channelId, providerMessageId: "cp4-retry" } }), 1);
  assert.equal((await current()).sync.pendingFailures, 0); assert.ok((await current()).sync.failedAttempts >= 1);
});
test("CP4 batches prove tenant/fencing isolation, RBAC and strict size limits", async () => {
  const batch = syncBatch([syncMessage("private@lid", "cp4-private")]);
  await leased(async (token) => {
    await assert.rejects(ingestion.apply({ organizationId: orgB, connectionId: channelId }, batch, token), /SCOPE_MISMATCH/);
    await assert.rejects(ingestion.apply(scope(), batch, randomUUID()), /STALE_PROVIDER_LEASE/);
    await ingestion.apply(scope(), batch, token);
  });
  const thread = await db.conversation.findFirstOrThrow({ where: { channelId, providerConversationId: "private@lid" } });
  await request(other, "GET", `/conversations/${thread.id}/messages`, undefined, 403);
  await request(manager, "GET", `/conversations/${thread.id}/messages`, undefined, 403);
  assert.throws(() => parseProviderEvent(syncBatch(Array.from({ length: 21 }, () => syncMessage("limit@lid", randomUUID())))), /INVALID_PROVIDER_EVENT/);
});
test("CP4 late imported history cannot widen a transferred NONE boundary and historical events are aggregated", async () => {
  const restricted = await auth(orgA, ["conversations.read", "messages.read"]), externalId = "boundary@lid";
  await leased((token) => ingestion.apply(scope(), syncBatch([syncMessage(externalId, "cp4-before-boundary")]), token));
  const thread = await db.conversation.findFirstOrThrow({ where: { channelId, providerConversationId: externalId } });
  const before = await db.message.findFirstOrThrow({ where: { conversationId: thread.id } });
  await db.conversation.update({ where: { id: thread.id }, data: { assignedUserId: restricted.userId, visibility: "NONE", visibleFromMessage: before.sequence + 1n, historyBoundaryAt: new Date(Date.now() - 1000) } });
  await leased(async (token) => { await ingestion.apply(scope(), syncBatch([syncMessage(externalId, "cp4-late-history", new Date(Date.now() - 86400000).toISOString())]), token); await ingestion.apply(scope(), syncBatch([syncMessage(externalId, "cp4-live-after-boundary")], false), token); });
  const authorized = (await request(restricted, "GET", `/conversations/${thread.id}/messages`)).json().items;
  assert.equal(authorized.length, 1); assert.equal(authorized[0].historical, false);
  const frames = await db.realtimeEvent.findMany({ where: { organizationId: orgA, conversationId: thread.id } });
  assert.equal(frames.filter((row) => row.type === "conversation.history.updated").length, 2);
  assert.equal(frames.filter((row) => row.type === "message.created").length, 1);
  assert.ok(!JSON.stringify(frames, (_, value) => typeof value === "bigint" ? value.toString() : value).includes("conteúdo original"));
});
test("CP4 stores canonical historical media references without binaries or transfer jobs", async () => {
  const item = syncMessage("media@lid", "cp4-media") as Extract<SyncItem, { kind: "message" }>;
  item.message.content = { type: "IMAGE", originalBody: "*Legenda*", media: { mediaId: randomUUID(), type: "IMAGE", mimeType: "image/jpeg", fileName: "imagem.jpg", size: 1000, state: "PENDING" } };
  await leased((token) => ingestion.apply(scope(), syncBatch([item]), token));
  const stored = await db.message.findFirstOrThrow({ where: { channelId, providerMessageId: "cp4-media" } });
  assert.equal(stored.type, "IMAGE"); assert.equal(stored.body, "*Legenda*"); assert.equal((stored.mediaMetadata as { state: string }).state, "PENDING");
  const dto = (await request(owner, "GET", `/conversations/${stored.conversationId}/messages`)).json().items[0]; assert.equal(dto.type, "IMAGE"); assert.equal(dto.media.mimeType, "image/jpeg");
});
test("CP4 contact-only replay/realtime requires contacts.read and cannot disclose conversation events", async () => {
  const reader = await auth(orgA, ["contacts.read"]);
  const response = (await request(reader, "GET", "/contacts/realtime/events")).json();
  assert.ok(response.events.length); assert.ok(response.events.every((row: { type: string }) => row.type === "contacts.updated"));
  await request(reader, "GET", "/realtime/events", undefined, 403);
  await request(manager, "GET", "/contacts/realtime/events", undefined, 403);
  const frames: string[] = [], ws = new WebSocket(baseUrl.replace("http", "ws") + "/api/v1/contacts/realtime", { headers: { origin, cookie: reader.cookie } });
  ws.on("message", (frame) => frames.push(String(frame)));
  await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  const until = Date.now() + 4000; while (!frames.some((frame) => frame.includes("sync.checkpoint")) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 20));
  ws.close(); assert.ok(frames.some((frame) => frame.includes("contacts.updated"))); assert.ok(!frames.join("").includes("message.created")); assert.ok(!frames.join("").includes("conversation.history.updated"));
});
test("CP4 synthetic load measures bounded SQL batches, live latency and deduplicated replay", async () => {
  const cpu = process.cpuUsage(), started = performance.now(); let peakRss = process.memoryUsage().rss, liveLatencyMs = 0;
  const batches = Array.from({ length: 50 }, (_, batch) => syncBatch(Array.from({ length: 20 }, (_, index) => syncMessage(`load-${index % 10}@lid`, `cp4-load-${batch}-${index}`, new Date(Date.now() - 86400000 + batch * 20 + index).toISOString()))));
  for (let index = 0; index < batches.length; index++) {
    await leased((token) => ingestion.apply(scope(), batches[index]!, token));
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    if (index === 25) { const liveStart = performance.now(); await leased((token) => ingestion.apply(scope(), syncBatch([syncMessage("load-live@lid", "cp4-load-priority")], false), token)); liveLatencyMs = performance.now() - liveStart; }
  }
  for (const batch of batches) assert.equal(await leased((token) => ingestion.apply(scope(), batch, token)), false);
  assert.equal(await db.message.count({ where: { channelId, providerMessageId: { startsWith: "cp4-load-" } } }), 1001);
  const usage = process.cpuUsage(cpu);
  console.log(JSON.stringify({ metric: "cp4.sql.synthetic", historicalMessages: 1000, liveMessages: 1, batches: 50, replayedBatches: 50, durationMs: Math.round(performance.now() - started), cpuMs: (usage.user + usage.system) / 1000, peakRssBytes: peakRss, liveLatencyMs: Math.round(liveLatencyMs), isolated: true }));
});

test("CP4 fix first live message creates one unassigned contact/thread, is visible by RBAC and arrives through realtime", async () => {
  const reader = await auth(orgA, ["conversations.read", "messages.read"]), lid = "first-live-fix@lid", pn = "5511112222@s.whatsapp.net";
  const checkpoint = String((await db.realtimeEvent.findFirst({ orderBy: { id: "desc" } }))?.id ?? 0), frames: string[] = [];
  const ws = new WebSocket(baseUrl.replace("http", "ws") + "/api/v1/realtime?lastEventId=" + checkpoint, { headers: { origin, cookie: reader.cookie } });
  ws.on("message", (frame) => frames.push(String(frame)));
  await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  try {
    const batch = syncBatch([syncMessage(lid, "cp4fix-first-live")], false);
    await leased((token) => ingestion.apply(scope(), batch, token));
    const message = await db.message.findFirstOrThrow({ where: { channelId, providerMessageId: "cp4fix-first-live" } });
    const thread = await db.conversation.findUniqueOrThrow({ where: { id: message.conversationId } });
    assert.equal(thread.assignedUserId, null); assert.equal(message.direction, "INBOUND"); assert.equal(message.senderUserId, null); assert.equal(message.senderContactId, thread.contactId);
    const page = (await request(reader, "GET", "/conversations?scope=unassigned")).json(); assert.ok(page.items.some((row: { id: string }) => row.id === thread.id));
    assert.ok(!(await request(reader, "GET", "/conversations?scope=mine")).json().items.some((row: { id: string }) => row.id === thread.id));
    await request(reader, "GET", "/conversations?scope=all", undefined, 403);
    await request(other, "GET", `/conversations/${thread.id}`, undefined, 403);
    assert.ok((await request(reader, "GET", `/conversations/${thread.id}/messages`)).json().items.some((row: { id: string }) => row.id === message.id));
    const deadline = Date.now() + 4000; while (!frames.some((frame) => frame.includes(message.id)) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(frames.some((frame) => frame.includes(message.id) && frame.includes("message.created")));
    assert.ok(!frames.join("").includes("conteúdo original"));
    await leased(async (token) => {
      assert.equal(await ingestion.apply(scope(), batch, token), false);
      const outgoing = syncMessage(pn, "cp4fix-cell-outbound", now(), true); outgoing.identity.aliases = [lid];
      await ingestion.apply(scope(), syncBatch([outgoing, syncMessage(lid, "cp4fix-first-live")], false), token);
    });
    assert.equal(await db.message.count({ where: { channelId, providerMessageId: "cp4fix-first-live" } }), 1);
    assert.equal(await db.conversation.count({ where: { channelId, contactId: thread.contactId } }), 1);
    const aliases = await db.contactIdentity.findMany({ where: { channelId, externalId: { in: [lid, pn] } } }); assert.equal(aliases.length, 2); assert.equal(new Set(aliases.map((row) => row.contactId)).size, 1);
    const sent = await db.message.findFirstOrThrow({ where: { channelId, providerMessageId: "cp4fix-cell-outbound" } }); assert.equal(sent.conversationId, thread.id); assert.equal(sent.senderUserId, null); assert.equal(sent.direction, "OUTBOUND");
    assert.equal((await request(reader, "GET", `/conversations/${thread.id}/messages`)).json().items.length, 2);
    const progress = (await current()).sync; assert.ok(progress.duplicateItems > 0 && progress.conversationsLocated > 0); assert.ok(progress.receivedItems >= progress.processedItems); assert.ok(!("failedBatches" in progress));
  } finally { ws.close(); }
});

test("provider diagnostics requires both admin and specific authorization, isolates tenants and supports empty future providers", async () => {
 const base = "/providers/WHATSAPP_WEB/diagnostics";
 const diagnosticsOnly = await auth(orgA, ["providers.diagnostics.read"]);
 await request(diagnosticsOnly, "GET", base, undefined, 403);
 await request(manager, "GET", base, undefined, 403);
 await request(denied, "GET", `${base}/health`, undefined, 403);
 const empty = (await request(other, "GET", base)).json(); assert.deepEqual(empty.items, []);
 const meta = (await request(owner, "GET", "/providers/META/diagnostics/health")).json(); assert.equal(meta.backlog, null); assert.equal(meta.lastProcessedAt, null);
 const demo = (await request(owner, "GET", "/providers/DEMO/diagnostics")).json(); assert.equal(demo.coverage, "NO_PROCESSING_RECORDS"); assert.deepEqual(demo.items, []);
 await request(owner, "GET", `${base}?limit=51`, undefined, 400);
 await request(owner, "GET", `${base}?from=not-a-date`, undefined, 400);
 await request(owner, "GET", `${base}?from=2099-01-02T00:00:00Z&to=2099-01-01T00:00:00Z`, undefined, 400);
});
test("diagnostics records actual failed attempts, recovery, definitive rejection, filtering, pagination and safe export details", async () => {
 const base = "/providers/WHATSAPP_WEB/diagnostics";
 const batch = syncBatch([syncMessage("diagnostic-private@lid", "private-phone-token-content")], false);
 await leased(async (token) => {
  await recordSyncFailure(chat, scope(), batch, token, "PERSISTENCE_FAILED", 1);
  let page = (await request(owner, "GET", `${base}?kind=ERRORS&status=ACTIVE&stage=PERSISTENCE`)).json();
  const row = page.items.find((x: { id: string }) => x.id === batch.eventId); assert.ok(row); assert.equal(row.attempts, 1); assert.equal(row.correlationId, batch.correlationId);
  await request(other, "GET", `${base}/${batch.eventId}`, undefined, 404);
  const detail = (await request(owner, "GET", `${base}/${batch.eventId}`)).json(); assert.equal(detail.code, "PERSISTENCE_FAILED");
  assert.ok(!JSON.stringify(detail).includes("private-phone-token-content")); assert.ok(!JSON.stringify(detail).includes("diagnostic-private")); assert.ok(!("stack" in detail));
  await ingestion.apply(scope(), batch, token);
  page = (await request(owner, "GET", `${base}?kind=ERRORS&status=RECOVERED`)).json(); assert.ok(page.items.some((x: { id: string }) => x.id === batch.eventId)); assert.ok(page.counters.recovered >= 1);
  const recovered = (await request(owner, "GET", `${base}/${batch.eventId}`)).json(); assert.equal(recovered.status, "RECOVERED"); assert.equal(recovered.attempts, 2); assert.ok(recovered.recoveredAt);
  const doomed = syncBatch([syncMessage("diagnostic-dead@lid", "diagnostic-dead")], false);
  await recordSyncFailure(chat, scope(), doomed, token, "PROVIDER_IDEMPOTENCY_CONFLICT", 5, true);
  const dead = (await request(owner, "GET", `${base}?kind=ERRORS&status=DEAD_LETTER`)).json(); assert.ok(dead.items.some((x: { id: string }) => x.id === doomed.eventId));
 });
 const first = (await request(owner, "GET", `${base}?kind=EVENTS&severity=INFO&limit=1&page=1`)).json(); const next = (await request(owner, "GET", `${base}?kind=EVENTS&severity=INFO&limit=1&page=2`)).json(); assert.equal(first.items.length, 1); assert.equal(first.hasMore, true); assert.notEqual(first.items[0].id, next.items[0].id);
 const health = (await request(owner, "GET", `${base}/health`)).json(); assert.ok(health.failedAttempts >= 2); assert.ok(health.deadLetters >= 1); assert.ok(health.pendingFailures >= 1);
 assert.ok(await db.auditEvent.count({ where: { organizationId: orgA, actorUserId: owner.userId, action: "PROVIDER_DIAGNOSTICS_VIEWED" } }));
});
test("diagnostic checkpoints enforce retention, bounded volume and sanitize unexpected persisted fields", () => {
 const now = new Date().toISOString(); const good = { id: randomUUID(), correlationId: randomUUID(), code: "PERSISTENCE_FAILED", status: "ACTIVE", stage: "PERSISTENCE", component: "CORE", severity: "ERROR", occurredAt: now, lastAttemptAt: now, attempts: 1, items: 1, token: "DO_NOT_EXPOSE", body: "DO_NOT_EXPOSE" };
 const progress = syncProgress({ occurrences: Array.from({ length: 100 }, () => good) }); assert.equal(progress.occurrences.length, 64); assert.ok(!JSON.stringify(progress.occurrences).includes("DO_NOT_EXPOSE"));
 assert.equal(syncProgress({ occurrences: [{ ...good, occurredAt: "2000-01-01T00:00:00Z" }] }).occurrences.length, 0);
 assert.equal(syncProgress({ occurrences: [{ ...good, code: "SECRET_PHONE_123456789" }] }).occurrences.length, 0);
});
