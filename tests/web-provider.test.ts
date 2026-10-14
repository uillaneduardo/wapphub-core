import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { bootstrapCorrelationId } from "../contracts/provider-internal.js";
import { intentDigest, type SendIntent } from "../contracts/provider-outbound.js";
import { Sessions } from "../services/wapphub-provider-web/src/sessions.js";
import { createHttp } from "../services/wapphub-provider-web/src/http.js";
import { InternalAuth } from "../services/wapphub-provider-web/src/auth.js";
import { WebProviderClient } from "../src/integrations/web-provider-client.js";
import type { TransportCallbacks } from "../services/wapphub-provider-web/src/transport.js";
import { before, after, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import WebSocket from "ws";
import { buildApp } from "../src/http/app.js";
import { loadConfig } from "../src/infrastructure/config.js";
import { digest, newToken, hashPassword } from "../src/infrastructure/crypto.js";
import { Chat } from "../src/application/chat.js";
import { DemoProvider } from "../src/integrations/demo-provider.js";
import { MessageIngestionService } from "../src/application/message-ingestion.js";
import { WebHistory, selectHistoryAnchors } from "../src/application/web-history.js";
import { HistoryImporter } from "../services/wapphub-provider-web/src/history-operation.js";
import { Vault } from "../services/wapphub-provider-web/src/vault.js";
import { EventJournal } from "../services/wapphub-provider-web/src/events.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { WebConnections } from "../src/application/web-connections.js";
import { syncProgress, recordSyncFailure } from "../src/application/web-sync.js";
import { WebIngestion } from "../src/application/web-ingestion.js";
import { WebProviderWorker } from "../src/application/web-provider-worker.js";
import { WebProviderError, type WebProviderPort, type ProviderScope, type Delivery, type InternalAction } from "../src/integrations/web-provider-client.js";
import { providerDeduplicationId, parseProviderEvent, type ProviderEvent, type SyncItem } from "../contracts/provider.js";
import type { ProviderSession, ProviderQr } from "../contracts/provider-internal.js";
import { chatPermissions } from "../src/domain/chat.js";
if (process.env.NODE_ENV !== "test" || !new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")) throw new Error("Web provider tests require isolated test infrastructure");
const config = loadConfig({ ...process.env, NODE_ENV: "test", WEB_ORIGINS: "https://web-client.example.test", PROVIDER_WEB_ENABLED: "true", PROVIDER_HISTORY_EXECUTION_ENABLED: "true" });
const db = new PrismaClient(), redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1 }); redis.on("error", () => {});
const origin = config.origins[0]!;
class FakeProvider implements WebProviderPort {
  views = new Map<string, ProviderSession>(); events: Delivery[] = []; calls: string[] = []; acked: string[] = []; nacked: string[] = [];
  fail = false; unready = false; qrValue: ProviderQr = { qr: "SYNTHETIC_PRIVATE_QR", revision: 1, expiresAt: new Date(Date.now() + 20000).toISOString() }; qrHook?: () => Promise<void>;
  async ready() { return !this.fail && !this.unready; }
  async create(scope: ProviderScope) { this.calls.push("create"); if (!this.views.has(scope.connectionId)) this.views.set(scope.connectionId, { state: "DISCONNECTED", revision: 0, qrRevision: 0, attempts: 0, connectEnabled: true }); return this.session(scope); }
  async session(scope: ProviderScope) { if (this.fail) throw new WebProviderError("PROVIDER_UNAVAILABLE"); const view = this.views.get(scope.connectionId); if (!view) throw new WebProviderError("SESSION_NOT_FOUND", 404); return view; }
  async command(scope: ProviderScope, action: InternalAction) { this.calls.push(action); const old = await this.session(scope); const view: ProviderSession = { ...old, state: action === "logout" ? "LOGGED_OUT" : action === "disconnect" ? "DISCONNECTED" : "CONNECTING", revision: old.revision + 1 }; this.views.set(scope.connectionId, view); return view; }
  async history(scope: ProviderScope, control: import("../contracts/history.js").HistoryControl) {
    this.calls.push(`history_${control.action}`); const view = await this.session(scope);
    if (control.action === "prepare") { const spec = control.spec!; view.history = { id: spec.id, state: "PREPARED", from: spec.from, to: spec.to, limits: spec.limits, contacts: 0, conversations: 0, messages: 0, requests: 0, duplicates: 0, failures: 0, limited: false, queued: 0 }; }
    else if (view.history) view.history.state = control.action === "cancel" ? "CANCELLED" : control.action === "pause" ? "PAUSED" : "RUNNING";
    return view;
  }
  async qr() { await this.qrHook?.(); if (this.fail) throw new WebProviderError("PROVIDER_UNAVAILABLE"); return this.qrValue; }
  async pull(scope: ProviderScope) { return this.events.filter((item) => item.event.connectionId === scope.connectionId); }
  async ack(_scope: ProviderScope, eventId: string, _lease?: string) { void _lease; this.acked.push(eventId); this.events = this.events.filter((item) => item.event.eventId !== eventId); }
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
  await db.media.deleteMany({ where });
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
test("disconnect stops the local provider transport and records the administrative action", async () => {
  await command("disconnect"); await worker.runConnection(scope()); assert.equal((await current()).state, "DISCONNECTED"); assert.equal((await current()).uiState, "DISCONNECTED"); assert.ok(provider.calls.includes("disconnect"));
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
function syncMessage(externalId: string, id: string, occurredAt = now(), outbound = false): Extract<SyncItem, { kind: "message" }> {
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
  await leased((token) => ingestion.apply(scope(), syncBatch([
    { kind: "contact", identity: { externalId: id, name: "Nome antigo importado" } },
    { kind: "conversation", identity: { externalId: id }, metadata: { archived: false, unreadCount: 99 } },
    syncMessage(id, "cp4-administrative"),
  ]), token));
  const after = await db.conversation.findUniqueOrThrow({ where: { id: thread.id }, include: { contact: true, tags: true, notes: true } });
  assert.equal(after.contact.name, "Nome manual"); assert.equal(after.assignedUserId, owner.userId); assert.equal(after.status, "ARCHIVED"); assert.equal(after.visibility, "NONE"); assert.equal(after.visibleFromMessage, 999999n); assert.equal(after.tags.length, 1); assert.equal(after.notes[0]?.body, "Nota administrativa");
});

test("historical preparation updates Inbox through aggregated real websocket events and persists ordered history", async () => {
  const checkpoint = String((await db.realtimeEvent.findFirst({ orderBy: { id: "desc" } }))?.id ?? 0), frames: string[] = [];
  const ws = new WebSocket(baseUrl.replace("http", "ws") + "/api/v1/realtime?lastEventId=" + checkpoint, { headers: { origin, cookie: owner.cookie } });
  ws.on("message", (frame) => frames.push(String(frame)));
  await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  try {
    const older = new Date(Date.now() - 2 * 86400000).toISOString(), newer = new Date(Date.now() - 86400000).toISOString();
    const batch = syncBatch([syncMessage("historical-inbox@lid", "history-inbox-older", older), syncMessage("historical-inbox@lid", "history-inbox-newer", newer, true)]);
    await leased((token) => ingestion.apply(scope(), batch, token));
    const thread = await db.conversation.findFirstOrThrow({ where: { channelId, providerConversationId: "historical-inbox@lid" } });
    const deadline = Date.now() + 4000;
    while (!frames.some((frame) => frame.includes(thread.id) && frame.includes("conversation.history.updated")) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(frames.some((frame) => frame.includes(thread.id) && frame.includes("conversation.history.updated")));
    assert.ok(!frames.some((frame) => frame.includes(thread.id) && frame.includes("message.created")));
    assert.ok(!frames.join("").includes("conteúdo original"));
    const page = (await request(owner, "GET", `/conversations/${thread.id}/messages`)).json();
    assert.deepEqual(page.items.map((item: { createdAt: string }) => item.createdAt), [newer, older]);
    assert.ok(page.items.every((item: { historical: boolean; senderUserId: string | null }) => item.historical && item.senderUserId === null));
    assert.ok((await request(owner, "GET", "/conversations?scope=all")).json().items.some((item: { id: string }) => item.id === thread.id));
    await leased((token) => ingestion.apply(scope(), batch, token));
    assert.equal((await request(owner, "GET", `/conversations/${thread.id}/messages`)).json().items.length, 2);
  } finally { ws.close(); }
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
 const withoutOrganization = await auth(orgA, ["providers.manage", "providers.diagnostics.read"]);
 await db.session.update({ where: { id: withoutOrganization.sessionId }, data: { currentOrganizationId: null } });
 await request(withoutOrganization, "GET", base, undefined, 409);
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
  const searched = (await request(owner, "GET", `${base}?kind=ERRORS&q=${batch.correlationId}&component=CORE&eventType=sync.batch`)).json(); assert.equal(searched.items.length, 1); assert.equal(searched.items[0].id, batch.eventId);
  assert.equal((await request(owner, "GET", `${base}?kind=ERRORS&q=${batch.correlationId}&component=PROVIDER`)).json().items.length, 0);
  const evidence = (await request(owner, "GET", `${base}?kind=EVENTS&status=ACCEPTED&q=${batch.correlationId}`)).json().items[0].pipeline;
  assert.equal(evidence.find((x: {stage: string}) => x.stage === "PERSISTENCE").confirmed, true); assert.equal(evidence.find((x: {stage: string}) => x.stage === "REALTIME").confirmed, true); assert.equal(evidence.find((x: {stage: string}) => x.stage === "INBOX_RENDERED").confirmed, false); assert.equal(evidence.find((x: {stage: string}) => x.stage === "NORMALIZED").confirmed, false);
  const recovered = (await request(owner, "GET", `${base}/${batch.eventId}`)).json(); assert.equal(recovered.status, "RECOVERED"); assert.equal(recovered.attempts, 2); assert.ok(recovered.recoveredAt);
  const doomed = syncBatch([syncMessage("diagnostic-dead@lid", "diagnostic-dead")], false);
  await recordSyncFailure(chat, scope(), doomed, token, "PROVIDER_IDEMPOTENCY_CONFLICT", 5, true);
  const dead = (await request(owner, "GET", `${base}?kind=ERRORS&status=DEAD_LETTER`)).json(); assert.ok(dead.items.some((x: { id: string }) => x.id === doomed.eventId));
 });
 const failedCommand = await db.providerCommand.create({ data: { id: randomUUID(), organizationId: orgA, channelId, actorUserId: owner.userId, sessionId: owner.sessionId, action: "connect", status: "FAILED", errorCode: "PROVIDER_OPERATION_FAILED", attempts: 5, createdAt: new Date(Date.now() - 3600000) } });
 const commandDetail = (await request(owner, "GET", `${base}/${failedCommand.id}`)).json(); assert.equal(commandDetail.status, "REJECTED"); assert.equal(commandDetail.attempts, 5);
 await request(other, "GET", `${base}/${failedCommand.id}`, undefined, 404);
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

test("unready provider metadata is refreshed without commands or reconnection; diagnostics reports actual scoped source faults", async () => {
 const previous = await provider.session(scope()), faultId = randomUUID();
 provider.views.set(channelId, { ...previous, revision: previous.revision + 1, sync: { historyEnabled: false, phase: "PARTIAL", queued: 1, contacts: 3, conversations: 2, messages: 2, failures: 14, limited: false, durationMs: 123, activeTransport: false, processingFailure: { id: faultId, code: "SYNC_BACKPRESSURE", stage: "QUEUE", occurredAt: new Date().toISOString() } } });
 provider.unready = true; const calls = provider.calls.length;
 const draining = syncBatch([syncMessage("drainable@lid", "synthetic-drain")], false); provider.events.push({ event: draining, leaseId: randomUUID(), attempt: 1 });
 try { await worker.runConnection(scope()); const connection = await current(); assert.equal(connection.errorCode, "PROVIDER_UNAVAILABLE"); assert.equal(connection.sync.provider.queued, 1); assert.ok(!("processingFailure" in connection.sync.provider)); assert.equal(provider.calls.length, calls); assert.ok(provider.acked.includes(draining.eventId));
  const health = (await request(owner, "GET", "/providers/WHATSAPP_WEB/diagnostics/health")).json(); assert.equal(health.connectionStateConfirmed, false); assert.equal(health.processingState, "UNAVAILABLE");
  const page = (await request(owner, "GET", "/providers/WHATSAPP_WEB/diagnostics?kind=ERRORS&component=PROVIDER&stage=QUEUE")).json(); assert.equal(page.items.length, 1); assert.equal(page.items[0].id, faultId); assert.equal(page.items[0].code, "SYNC_BACKPRESSURE"); assert.equal(page.items[0].attempts, 1);
  await request(other, "GET", `/providers/WHATSAPP_WEB/diagnostics/${faultId}`, undefined, 404);
 } finally { provider.unready = false; provider.views.set(channelId, previous); await worker.runConnection(scope()); }
});

test("CP4.6 administrative history API proves tenant/RBAC/CSRF, bounded prepare and no network dispatch", async () => {
 const historyRoute = `${route}/${channelId}/history`;
 await state("CONNECTED", 999, 2);
 const tenant = await auth(orgB, [...chatPermissions, "providers.manage", "providers.diagnostics.read"]);
 await request(tenant, "GET", historyRoute, undefined, 404); await request(manager, "GET", historyRoute, undefined, 403); await request(denied, "GET", historyRoute, undefined, 403);
 const missingCsrf = await app.inject({ method: "POST", url: `/api/v1${historyRoute}/prepare`, headers: { origin, cookie: owner.cookie }, payload: { commandId: randomUUID(), expectedVersion: (await current()).version } }); assert.equal(missingCsrf.statusCode, 403);
 await request(owner, "POST", `${historyRoute}/prepare`, { commandId: randomUUID(), expectedVersion: (await current()).version, messages: 1001 }, 400);
 const id = randomUUID(), version = (await current()).version;
 const first = (await request(owner, "POST", `${historyRoute}/prepare`, { commandId: id, expectedVersion: version, messages: 20 })).json(); assert.equal(first.operation.state, "PREPARED");
 await request(owner, "POST", `${historyRoute}/prepare`, { commandId: id, expectedVersion: version, messages: 20 }); await request(owner, "POST", `${historyRoute}/prepare`, { commandId: id, expectedVersion: version, messages: 21 }, 409);
 const command = await db.providerCommand.findUniqueOrThrow({ where: { id } }); assert.equal(command.action, "history_prepare");
 const payload = command.payload as { spec: { anchors: { chatId: string }[] } }; assert.ok(payload.spec.anchors.length > 0 && payload.spec.anchors.length <= 16);
 const response = await request(owner, "GET", historyRoute); assert.equal(response.headers["cache-control"], "no-store, private"); assert.ok(!response.body.includes("anchors") && !response.body.includes("@lid") && !response.body.includes("manifest") && !response.body.includes("sessionId"));
 const calls = provider.calls.length; await worker.runConnection(scope()); assert.deepEqual(provider.calls.slice(calls), ["history_prepare"]); assert.equal((await current()).uiState, "CONNECTED");
 const row = await db.session.findUniqueOrThrow({ where: { id: owner.sessionId }, include: { user: true } }), principal = { session: row, user: row.user };
 const disabledChat = new Chat(db, loadConfig({ ...process.env, NODE_ENV: "test", PROVIDER_HISTORY_EXECUTION_ENABLED: "false" }), async () => {}, new DemoProvider(), new MessageIngestionService());
 const disabled = new WebHistory(db, disabledChat, false);
 await assert.rejects(disabled.control(principal, channelId, { commandId: randomUUID(), operationId: id, action: "start", expectedVersion: (await current()).version }), /HISTORY_EXECUTION_DISABLED/);
 await leased((token) => assert.rejects(new WebIngestion(disabledChat).apply(scope(), { ...syncBatch([syncMessage("blocked@lid", "blocked")]), correlationId: id }, token), /HISTORY_EXECUTION_DISABLED/));
 await request(owner, "POST", `${historyRoute}/commands`, { commandId: randomUUID(), operationId: id, action: "cancel", expectedVersion: (await current()).version }); await worker.runConnection(scope());
 assert.equal((await request(owner, "GET", historyRoute)).json().operation.state, "CANCELLED");
});

test("CP4.6 synthetic producer to journal to SQL to websocket creates an old unassigned conversation without new messages", async () => {
 const directory = await mkdtemp(join(tmpdir(), "cp46-chain-")), key = randomBytes(32), vault = new Vault(directory, key); await vault.initialize();
 const s = { id: randomUUID(), from: new Date(Date.now() - 30 * 86400000).toISOString(), to: new Date().toISOString(), limits: { contacts: 500, conversations: 500, messages: 20 }, anchors: [{ chatId: "known@lid", messageId: "known", fromMe: false, timestamp: Date.now() }] };
 let requests = 0; const importer = new HistoryImporter(vault, scope(), async () => { requests++; return "synthetic-request"; }, async () => [], true), journal = new EventJournal(vault);
 const historyRoute = `${route}/${channelId}/history`, reader = await auth(orgA, ["conversations.read", "messages.read"]);
 const checkpoint = String((await db.realtimeEvent.findFirst({ orderBy: { id: "desc" } }))?.id ?? 0), frames: string[] = [], ws = new WebSocket(baseUrl.replace("http", "ws") + "/api/v1/realtime?lastEventId=" + checkpoint, { headers: { origin, cookie: reader.cookie } }); ws.on("message", (data) => frames.push(String(data)));
 await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
 try {
  await db.providerConnection.update({ where: { organizationId_channelId: { organizationId: orgA, channelId } }, data: { historyOperation: { ...s, actorUserId: owner.userId, sessionId: owner.sessionId, state: "RUNNING", manifest: { contacts: [], conversations: [], messages: [] }, processed: 0, duplicates: 0, rejected: 0, createdAt: s.to } } });
  await importer.command({ commandId: s.id, operationId: s.id, action: "prepare", spec: s }); await importer.command({ commandId: randomUUID(), operationId: s.id, action: "start" });
  while (!requests) await new Promise((resolve) => setTimeout(resolve, 10));
  const old = new Date(Date.now() - 2 * 86400000).toISOString();
  await importer.receive([{ kind: "contact", identity: { externalId: "metadata46@lid", name: "Synthetic old contact" } }, { kind: "conversation", identity: { externalId: "metadata46@lid" }, lastMessageAt: old, metadata: { archived: false, unreadCount: 1 } }]);
  while (!vault.metrics().syncQueued) await new Promise((resolve) => setTimeout(resolve, 10));
  const deliveries = await journal.pull(scope(), 20);
  for (const d of deliveries) { await leased((token) => ingestion.apply(scope(), d.event, token)); await journal.ack(scope(), d.event.eventId, d.leaseId); }
  const thread = await db.conversation.findFirstOrThrow({ where: { channelId, providerConversationId: "metadata46@lid" } }); assert.equal(thread.assignedUserId, null); assert.equal(thread.lastMessageAt.toISOString(), old); assert.equal(await db.message.count({ where: { conversationId: thread.id } }), 0);
  const deadline = Date.now() + 4000; while (!frames.some((f) => f.includes(thread.id) && f.includes("conversation.updated")) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(frames.some((f) => f.includes(thread.id) && f.includes("conversation.updated"))); assert.ok(!frames.some((f) => f.includes(thread.id) && f.includes("message.created")));
  assert.ok((await request(reader, "GET", "/conversations?scope=unassigned")).json().items.some((c: { id: string }) => c.id === thread.id));
  const manifest = (await request(owner, "GET", historyRoute)).json().operation; assert.equal(manifest.persisted.contacts, 1); assert.equal(manifest.persisted.conversations, 1); assert.equal(manifest.persisted.messages, 0);
  const item = syncMessage("metadata46@lid", "cp46-original-device", old, true), batch = { ...syncBatch([item]), correlationId: s.id };
  await leased(async (token) => { await ingestion.apply(scope(), batch, token); await ingestion.apply(scope(), batch, token); });
  class BrokenHistory extends MessageIngestionService { override async persistExternal(): Promise<never> { throw new Error("synthetic CP46 database outage"); } }
  const failedBatch = { ...syncBatch([syncMessage("metadata46@lid", "cp46-retry", old)]), correlationId: s.id };
  await leased((token) => assert.rejects(new WebIngestion(chat, new BrokenHistory()).apply(scope(), failedBatch, token), /database outage/));
  assert.equal((await request(owner, "GET", historyRoute)).json().operation.persisted.messages, 1);
  assert.equal(await db.providerInbox.count({ where: { channelId, deduplicationId: failedBatch.deduplicationId } }), 0);
  await leased((token) => ingestion.apply(scope(), failedBatch, token));
  const message = await db.message.findFirstOrThrow({ where: { channelId, providerMessageId: "cp46-original-device" } }); assert.equal(message.createdAt.toISOString(), old); assert.equal(message.senderUserId, null); assert.equal(message.body, "  *Maria:* conteúdo original\n😀  ");
  const final = (await request(owner, "GET", historyRoute)).json().operation; assert.equal(final.persisted.messages, 2); assert.equal(final.duplicates, 1); assert.equal(requests, 1);
 } finally { importer.close(); ws.close(); await rm(directory, { recursive: true, force: true }); await db.providerConnection.update({ where: { organizationId_channelId: { organizationId: orgA, channelId } }, data: { historyOperation: Prisma.JsonNull } }); delete provider.views.get(channelId)?.history; }
});

test("CP4.7 anchor discovery selects oldest eligible in-window message rather than an older unusable anchor", async () => {
 const organizationId = (await db.organization.create({ data: { name: "Synthetic isolated anchors" } })).id;
 const localChannel = await db.channel.create({ data: { organizationId, provider: "WHATSAPP_WEB" } });
 const person = await db.contact.create({ data: { organizationId, name: "Synthetic", primaryIdentifier: "anchor-isolated@lid" } });
 const thread = await db.conversation.create({ data: { organizationId, channelId: localChannel.id, contactId: person.id, providerConversationId: "anchor-isolated@lid" } });
 const recent = new Date(Date.now() - 86400000);
 try {
  await db.message.createMany({ data: [{ providerMessageId: "outside", createdAt: new Date(Date.now() - 31 * 86400000) }, { providerMessageId: "eligible", createdAt: recent }].map((m) => ({ ...m, organizationId, channelId: localChannel.id, conversationId: thread.id, direction: "INBOUND", body: "synthetic reference" })) });
  await db.message.createMany({ data: [
   { providerMessageId: "not-dispatched", status: "PENDING" as const, deliveryOutcome: null, senderUserId: null },
   { providerMessageId: "uncertain", status: "SENT" as const, deliveryOutcome: "UNKNOWN", senderUserId: null },
   { providerMessageId: "no-protocol-time", status: "SENT" as const, deliveryOutcome: null, senderUserId: owner.userId },
  ].map((m) => ({ ...m, organizationId, channelId: localChannel.id, conversationId: thread.id, direction: "OUTBOUND", body: "synthetic unsafe anchor", createdAt: new Date(Date.now() - 2 * 86400000) })) });
  const anchors = await db.$transaction((tx) => selectHistoryAnchors(tx, { organizationId, connectionId: localChannel.id }, new Date(Date.now() - 30 * 86400000).toISOString()));
  assert.deepEqual(anchors, [{ chatId: "anchor-isolated@lid", messageId: "eligible", fromMe: false, timestamp: recent.getTime() }]);
 } finally {
  await db.message.deleteMany({ where: { organizationId } }); await db.conversation.deleteMany({ where: { organizationId } }); await db.contact.deleteMany({ where: { organizationId } }); await db.channel.deleteMany({ where: { organizationId } }); await db.organization.delete({ where: { id: organizationId } });
 }
});

test("CP4.7 activation API drives durable Worker, real journal and SQL without an active browser session", async () => {
 await state("CONNECTED", 2000, 2);
 const historyRoute = `${route}/${channelId}/history`, admin = await auth(orgA, [...chatPermissions, "providers.manage", "providers.diagnostics.read"]);
 const directory = await mkdtemp(join(tmpdir(), "cp47-chain-")), vault = new Vault(directory, randomBytes(32)); await vault.initialize();
 let requests = 0;
 const importer = new HistoryImporter(vault, scope(), async () => { requests++; return "synthetic-47"; }, async () => [], true, Date.now, true), journal = new EventJournal(vault);
 const original = { history: provider.history, session: provider.session, pull: provider.pull, ack: provider.ack };
 const view = provider.views.get(channelId)!;
 const sourceView = () => { const op = importer.current; return { ...view, ...(op ? { history: { id: op.id, state: op.state, from: op.from, to: op.to, limits: op.limits, contacts: op.contacts, conversations: op.conversations, messages: op.messages, requests: op.requests, duplicates: op.duplicates, failures: op.failures, limited: op.limited, queued: vault.metrics().syncQueued + vault.metrics().pending, ...(op.errorCode ? { errorCode: op.errorCode } : {}) } } : {}) }; };
 provider.history = async (_scope, control) => { await importer.command(control); return sourceView(); };
 provider.session = async () => sourceView(); provider.pull = async () => journal.pull(scope(), 5); provider.ack = async (_scope, id, lease) => { await journal.ack(scope(), id, lease!); };
 try {
  await worker.runConnection(scope()); assert.equal(requests, 0); // deployment itself cannot activate
  const payload = { commandId: randomUUID(), expectedVersion: (await current()).version, action: "enable", confirmed: true };
  const foreign = await auth(orgB, [...chatPermissions, "providers.manage", "providers.diagnostics.read"]);
  await request(foreign, "POST", `${historyRoute}/authorization`, payload, 404);
  await request(manager, "POST", `${historyRoute}/authorization`, payload, 403); await request(other, "POST", `${historyRoute}/authorization`, payload, 403);
  await request(owner, "POST", `${historyRoute}/authorization`, { ...payload, confirmed: false }, 400);
  assert.equal((await app.inject({ method: "POST", url: `/api/v1${historyRoute}/authorization`, headers: { origin, cookie: owner.cookie }, payload })).statusCode, 403);
  const result = (await request(owner, "POST", `${historyRoute}/authorization`, payload)).json(); assert.equal(result.operation.authorization.state, "ENABLED"); assert.equal(result.operation.limits.messages, 20); assert.equal(requests, 0);
  await request(owner, "POST", `${historyRoute}/authorization`, payload); // replay is idempotent
  await db.session.update({ where: { id: owner.sessionId }, data: { revokedAt: new Date(), currentOrganizationId: orgB } });
  await worker.runConnection(scope()); await worker.runConnection(scope());
  for (let i = 0; i < 200 && requests === 0; i++) await new Promise((resolve) => setTimeout(resolve, 10)); assert.equal(requests, 1);
  const op = importer.current!;
  await importer.receive([syncMessage("cp47-integration@lid", "cp47-device", new Date(Date.now() - 86400000).toISOString(), true)]);
  for (let i = 0; i < 200 && !vault.metrics().syncQueued; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  await worker.runConnection(scope());
  const stored = await db.message.findFirstOrThrow({ where: { organizationId: orgA, channelId, providerMessageId: "cp47-device" } }); assert.equal(stored.historical, true); assert.equal(stored.senderUserId, null);
  assert.equal((await request(admin, "GET", historyRoute)).json().operation.persisted.messages, 1);
  const configure = async (action: string) => request(admin, "POST", `${historyRoute}/authorization`, { commandId: randomUUID(), expectedVersion: (await request(admin, "GET", historyRoute)).json().version, action, confirmed: true });
  await configure("pause"); await worker.runConnection(scope()); assert.equal(importer.current?.state, "PAUSED");
  await configure("enable"); await worker.runConnection(scope()); assert.equal(importer.current?.state, "RUNNING");
  await db.membership.updateMany({ where: { organizationId: orgA, userId: owner.userId }, data: { status: "SUSPENDED" } });
  await worker.runConnection(scope()); assert.equal(importer.current?.state, "PAUSED");
  assert.equal((await request(admin, "GET", historyRoute)).json().operation.authorization.state, "DISABLED");
  await configure("disable"); await worker.runConnection(scope()); assert.equal((await request(admin, "GET", historyRoute)).json().operation.authorization.state, "DISABLED"); assert.equal(requests, 1); assert.equal(await db.message.count({ where: { id: stored.id } }), 1);
  assert.equal(importer.current?.id, op.id);
 } finally {
  await db.membership.updateMany({ where: { organizationId: orgA, userId: owner.userId }, data: { status: "ACTIVE" } });
  await importer.close(); Object.assign(provider, original); await rm(directory, { recursive: true, force: true }); await db.session.update({ where: { id: owner.sessionId }, data: { revokedAt: null, currentOrganizationId: orgA } });
  await db.providerConnection.update({ where: { organizationId_channelId: { organizationId: orgA, channelId } }, data: { historyOperation: Prisma.JsonNull } });
 }
});

test("B1 paused reader-policy failure preserves diagnostics without generating reconciliation commands", async () => {
  await state("CONNECTED", 3000);
  const previous = await db.providerConnection.findUniqueOrThrow({ where: { organizationId_channelId: { organizationId: orgA, channelId } } });
  const view = provider.views.get(channelId)!, previousHistory = view.history;
  const id = randomUUID(), now = Date.now(), from = new Date(now - 86400000).toISOString(), to = new Date(now).toISOString();
  const source = { id, state: "PAUSED" as const, from, to, limits: { contacts: 500, conversations: 500, messages: 20 }, contacts: 0, conversations: 0, messages: 0, requests: 1, duplicates: 0, failures: 2, limited: false, queued: 0, errorCode: "HISTORY_BYTE_LIMIT" };
  view.history = source;
  await db.providerConnection.update({ where: { organizationId_channelId: { organizationId: orgA, channelId } }, data: { historyOperation: { id, from, to, limits: source.limits, state: "PAUSED", source, manifest: { contacts: [], conversations: [], messages: [] }, processed: 0, duplicates: 0, rejected: 0, createdAt: to, actorUserId: owner.userId, sessionId: owner.sessionId, authorization: { organizationId: orgA, connectionId: channelId, actorUserId: owner.userId, authorizedAt: to, state: "ENABLED", nextCheckAt: new Date(now - 3600000).toISOString() } } } });
  const count = await db.providerCommand.count({ where: { organizationId: orgA, channelId } });
  try {
    for (let i = 0; i < 25; i++) await worker.runConnection(scope());
    assert.equal(await db.providerCommand.count({ where: { organizationId: orgA, channelId } }), count);
    const op = (await db.providerConnection.findUniqueOrThrow({ where: { organizationId_channelId: { organizationId: orgA, channelId } } })).historyOperation as { source: typeof source };
    assert.equal(op.source.errorCode, "HISTORY_BYTE_LIMIT"); assert.equal(op.source.requests, 1);
  } finally {
    view.history = previousHistory;
    await db.providerConnection.update({ where: { organizationId_channelId: { organizationId: orgA, channelId } }, data: { historyOperation: previous.historyOperation ?? Prisma.JsonNull } });
  }
});

test("B2/B3 HTTP Core -> SQL outbox -> signed Provider -> durable journal -> SQL receipts and live ingress; no blind resend", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wapphub-b23-synthetic-")), key = randomBytes(32), vault = new Vault(join(directory, "sessions"), key); await vault.initialize();
  const journal = new EventJournal(vault), internalKey = randomBytes(32), auth = new InternalAuth(internalKey, join(directory, "nonces")); await auth.initialize();
  let callbacks!: TransportCallbacks, sends = 0, resolves = 0, unknown = false; let resolveHook: (() => Promise<void>) | undefined; let releaseSlow: (() => void) | undefined;
  const transmitted: SendIntent[] = [], originalName = (await db.user.findUniqueOrThrow({ where: { id: owner.userId } })).name;
  const sessions = new Sessions(vault, journal, async (_scope, cb) => { callbacks = cb; return { close() {}, logout: async () => undefined, resolveRecipient: async phone => { resolves++; await resolveHook?.(); return phone === "+5581999999999" ? { state: "VALID", jid: "5581999999999@s.whatsapp.net" } : { state: "UNKNOWN" }; }, send: async intent => { sends++; transmitted.push(intent); if (intent.body === `*Renamed attendant*\nSynthetic slow`) await new Promise<void>(resolve => { releaseSlow = resolve; }); if (unknown) throw new Error("synthetic uncertainty"); callbacks.receipt(intent.providerMessageId, "READ", intent.destination); } }; }, true, () => () => undefined, Date.now, () => undefined, { enabled: false, historyEnabled: false, outboundEnabled: true });
  const source = createHttp(sessions, journal, auth), sourceUrl = await source.listen({ host: "127.0.0.1", port: 0 }), client = new WebProviderClient(sourceUrl, internalKey);
  const activeConfig = { ...config, PROVIDER_OUTBOUND_ENABLED: true, PROVIDER_MEDIA_ENABLED: true };
  const activeApp = await buildApp(activeConfig, db, redis, false, undefined, client);
  const activeChat = new Chat(db, activeConfig, async () => { throw new Error("synthetic Redis wake unavailable"); }, new DemoProvider(), new MessageIngestionService()), activeWorker = new WebProviderWorker(db, activeChat, client);
  const original = await db.providerConnection.findUniqueOrThrow({ where: { organizationId_channelId: { organizationId: orgA, channelId } } });
  const inject = async (a: Auth, method: "GET" | "POST" | "PUT", path: string, payload?: unknown, expected = 200) => { const response = await activeApp.inject({ method, url: "/api/v1" + path, headers: { origin, cookie: a.cookie, "x-csrf-token": a.csrf }, ...(payload === undefined ? {} : { payload: payload as object }) }); assert.equal(response.statusCode, expected, response.body); return response; };
  try {
    await sessions.create(scope()); await sessions.command(scope(), "connect", randomUUID()); callbacks.connection({ state: "open" }); await sessions.settle(scope());
    await db.providerConnection.update({ where: { organizationId_channelId: { organizationId: orgA, channelId } }, data: { state: "CONNECTED", errorCode: null, lastCheckedAt: new Date(), historyOperation: Prisma.DbNull, providerRevision: 0, outboundEnabled: false, mediaEnabled: false } });
    await db.channel.update({ where: { organizationId_id: { organizationId: orgA, id: channelId } }, data: { status: "ENABLED" } });
    const opening = { channelId, phone: "+5581999999999" };
    await inject(owner, "POST", "/conversations/external", opening, 409); assert.equal(resolves, 0); assert.equal(sends, 0);
    await inject(denied, "PUT", `${route}/${channelId}/capabilities`, { outboundEnabled: true, mediaEnabled: true }, 403);
    await inject(other, "PUT", `${route}/${channelId}/capabilities`, { outboundEnabled: true, mediaEnabled: true }, 404);
    const missingCsrf = await activeApp.inject({ method: "PUT", url: "/api/v1" + `${route}/${channelId}/capabilities`, headers: { origin, cookie: owner.cookie }, payload: { outboundEnabled: true, mediaEnabled: true } }); assert.equal(missingCsrf.statusCode, 403);
    await inject(owner, "PUT", `${route}/${channelId}/capabilities`, { outboundEnabled: true, mediaEnabled: true });
    await inject(denied, "POST", "/conversations/external", opening, 403);
    await inject(owner, "POST", "/conversations/external", { channelId, phone: "81999999999" }, 400);
    await inject(owner, "POST", "/conversations/external", { channelId, phone: "+5581888888888" }, 409); assert.equal(sends, 0);
    resolveHook = async () => { await db.session.update({ where: { id: owner.sessionId }, data: { currentOrganizationId: orgB } }); };
    await inject(owner, "POST", "/conversations/external", opening, 401); assert.equal(sends, 0);
    resolveHook = undefined; await db.session.update({ where: { id: owner.sessionId }, data: { currentOrganizationId: orgA } });
    const opened = (await inject(owner, "POST", "/conversations/external", opening)).json(); assert.equal(opened.outboundEnabled, true); assert.equal(sends, 0); assert.equal(opened.assignedUserId, owner.userId);
    assert.equal((await inject(owner, "POST", "/conversations/external", { channelId, contactId: opened.contactId })).json().id, opened.id);
    const body = { body: "  Synthetic original\n😀  ", clientMessageId: randomUUID() };
    const queued = (await inject(owner, "POST", `/conversations/${opened.id}/messages`, body)).json(); assert.equal(queued.status, "PENDING"); assert.equal(queued.senderUserId, owner.userId); assert.equal(sends, 0);
    assert.equal((await inject(owner, "POST", `/conversations/${opened.id}/messages`, body)).json().id, queued.id);
    await inject(owner, "POST", `/conversations/${opened.id}/messages`, { ...body, body: "changed" }, 409);
    await inject(other, "POST", `/conversations/${opened.id}/messages`, body, 403);
    const persisted = await db.message.findUniqueOrThrow({ where: { id: queued.id } }); assert.equal(persisted.body, body.body); assert.equal(persisted.transmittedBody, `*${originalName}*\n${body.body}`); assert.equal(queued.senderName, originalName);
    await db.user.update({ where: { id: owner.userId }, data: { name: "Renamed attendant" } });
    const repeated = (await inject(owner, "POST", `/conversations/${opened.id}/messages`, body)).json(); assert.equal(repeated.id, queued.id); assert.equal(repeated.body, body.body); assert.equal(repeated.senderName, "Renamed attendant");
    assert.equal(await db.providerCommand.count({ where: { organizationId: orgA, channelId, action: "send", payload: { path: "$.messageId", equals: queued.id } } }), 1);
    await activeWorker.runConnection(scope()); await sessions.settle(scope()); await activeWorker.runConnection(scope());
    assert.equal(sends, 1); assert.equal(transmitted[0]!.body, persisted.transmittedBody); assert.equal(transmitted[0]!.providerMessageId, persisted.providerMessageId); const confirmed = await db.message.findUniqueOrThrow({ where: { id: queued.id } }); assert.equal(confirmed.status, "READ"); assert.equal(confirmed.senderUserId, owner.userId); assert.equal(confirmed.deliveryOutcome, null);
    callbacks.text({ id: "b23-live", chatId: "5581999999999@s.whatsapp.net", body: "Synthetic live", fromMe: false, timestamp: Date.now() }); await sessions.settle(scope()); await activeWorker.runConnection(scope());
    const received = await db.message.findFirstOrThrow({ where: { organizationId: orgA, channelId, providerMessageId: "b23-live" } }); assert.equal(received.conversationId, opened.id); assert.equal(received.senderUserId, null); assert.equal(received.senderContactId, opened.contactId);
    callbacks.text({ id: persisted.providerMessageId!, chatId: "5581999999999@s.whatsapp.net", body: persisted.transmittedBody!, fromMe: true, timestamp: Date.now() }); await sessions.settle(scope()); await activeWorker.runConnection(scope());
    const echoed = await db.message.findUniqueOrThrow({ where: { id: queued.id } }); assert.equal(echoed.senderUserId, owner.userId); assert.equal(echoed.createdAt.toISOString(), persisted.createdAt.toISOString()); assert.ok(echoed.providerOccurredAt);
    const slow = (await inject(owner, "POST", `/conversations/${opened.id}/messages`, { body: "Synthetic slow", clientMessageId: randomUUID() })).json();
    const inflight = activeWorker.runConnection(scope());
    for (let i = 0; i < 100 && !releaseSlow; i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(releaseSlow);
    callbacks.text({ id: "b4-live-during-send", chatId: "5581999999999@s.whatsapp.net", body: "Synthetic concurrent live", fromMe: false, timestamp: Date.now() }); await sessions.settle(scope());
    let observed = false; for (let i = 0; i < 100; i++) { if (await db.message.count({ where: { organizationId: orgA, channelId, providerMessageId: "b4-live-during-send" } })) { observed = true; break; } await new Promise(resolve => setTimeout(resolve, 20)); }
    assert.equal(observed, true); assert.equal((await db.message.findUniqueOrThrow({ where: { id: slow.id } })).status, "PENDING"); releaseSlow(); await inflight; assert.equal(sends, 2);
    // SQL failure after the Provider has transmitted: intent survives, receipt
    // wins after recovery, and a PROCESSING replay never calls transport twice.
    const sqlFailure = (await inject(owner, "POST", `/conversations/${opened.id}/messages`, { body: "Synthetic SQL recovery", clientMessageId: randomUUID() })).json();
    await db.$executeRawUnsafe("CREATE TRIGGER b23_synthetic_outbox BEFORE UPDATE ON ProviderCommand FOR EACH ROW BEGIN IF NEW.action='send' AND NEW.status='COMPLETED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic failure'; END IF; END");
    try { await activeWorker.runConnection(scope()); assert.equal(sends, 3); } finally { await db.$executeRawUnsafe("DROP TRIGGER b23_synthetic_outbox"); }
    await sessions.settle(scope()); await activeWorker.runConnection(scope()); assert.equal(sends, 3); assert.equal((await db.message.findUniqueOrThrow({ where: { id: sqlFailure.id } })).status, "READ");
    unknown = true; const uncertain = (await inject(owner, "POST", `/conversations/${opened.id}/messages`, { body: "Synthetic uncertain", clientMessageId: randomUUID() })).json(); await activeWorker.runConnection(scope()); assert.equal(sends, 4);
    assert.equal((await db.message.findUniqueOrThrow({ where: { id: uncertain.id } })).deliveryOutcome, "UNKNOWN"); await activeWorker.runConnection(scope()); assert.equal(sends, 4);
    const ownerMembership = await db.membership.findFirstOrThrow({ where: { organizationId: orgA, userId: owner.userId } }), sendPermission = await db.permission.findUniqueOrThrow({ where: { code: "messages.send" } });
    const retryBody = { body: "Synthetic revoked before transmission", clientMessageId: randomUUID() }, rejected = (await inject(owner, "POST", `/conversations/${opened.id}/messages`, retryBody)).json();
    const retrySnapshot = await db.message.findUniqueOrThrow({ where: { id: rejected.id } });
    const retryCommand = await db.providerCommand.findFirstOrThrow({ where: { organizationId: orgA, channelId, action: "send", payload: { path: "$.messageId", equals: rejected.id } } });
    await db.membershipPermissionOverride.create({ data: { organizationId: orgA, membershipId: ownerMembership.id, permissionId: sendPermission.id, effect: "REVOKE" } });
    await activeWorker.runConnection(scope()); assert.equal(sends, 4); assert.equal((await db.message.findUniqueOrThrow({ where: { id: rejected.id } })).deliveryOutcome, "NOT_SENT");
    await db.membershipPermissionOverride.deleteMany({ where: { organizationId: orgA, membershipId: ownerMembership.id, permissionId: sendPermission.id } });
    await db.user.update({ where: { id: owner.userId }, data: { name: "Changed before retry" } });
    const retried = (await inject(owner, "POST", `/conversations/${opened.id}/messages`, retryBody)).json(); assert.equal(retried.id, rejected.id); assert.equal(retried.status, "PENDING"); unknown = false; await activeWorker.runConnection(scope()); await sessions.settle(scope()); await activeWorker.runConnection(scope()); assert.equal(sends, 5);
    assert.equal(transmitted[4]!.body, retrySnapshot.transmittedBody); assert.equal(transmitted[4]!.commandId, retryCommand.id); assert.equal(transmitted[4]!.providerMessageId, retrySnapshot.providerMessageId); assert.equal(retried.clientMessageId, retryBody.clientMessageId);
    assert.equal(intentDigest(transmitted[4]!), vault.get(scope())!.sends!.find(x => x.id === retryCommand.id)!.digest);

    await inject(owner, "PUT", `${route}/${channelId}/capabilities`, { outboundEnabled: false, mediaEnabled: false });
    await inject(owner, "POST", `/conversations/${opened.id}/messages`, { body: "blocked", clientMessageId: randomUUID() }, 409); assert.equal(sends, 5);
    const history = vault.get(scope())?.historyOperation; assert.equal(history, undefined);
  } finally {
    releaseSlow?.(); await activeApp.close(); await sessions.shutdown(); await source.close(); await rm(directory, { recursive: true, force: true });
    await db.session.update({ where: { id: owner.sessionId }, data: { currentOrganizationId: orgA } });
    await db.user.update({ where: { id: owner.userId }, data: { name: originalName } });
    await db.providerConnection.update({ where: { organizationId_channelId: { organizationId: orgA, channelId } }, data: { outboundEnabled: original.outboundEnabled, mediaEnabled: original.mediaEnabled, historyOperation: original.historyOperation ?? Prisma.DbNull, state: original.state, providerRevision: original.providerRevision, errorCode: original.errorCode, lastCheckedAt: original.lastCheckedAt, leaseToken: null, leaseUntil: null } });
  }
});

test("B3 demand media revalidates tenant/visibility and keeps authenticated bytes separate from metadata", async () => {
  const payload = Buffer.from("synthetic image bytes"), hash = createHash("sha256").update(payload).digest("hex"), id = randomUUID(); let downloads = 0;
  const mediaProvider: WebProviderPort = { ...provider, ready: () => provider.ready(), create: s => provider.create(s), session: s => provider.session(s), command: (s,a) => provider.command(s,a), qr: () => provider.qr(), pull: s => provider.pull(s), ack: (s,id) => provider.ack(s,id), nack: (s,id) => provider.nack(s,id), uploadMedia: async (s, meta, source) => { assert.equal(s.organizationId, orgA); const chunks: Buffer[] = []; for await (const chunk of source) chunks.push(Buffer.from(chunk)); const bytes = Buffer.concat(chunks); assert.deepEqual(bytes, payload); assert.equal(meta.sha256, hash); return { ...meta, state: "READY" }; }, send: async (_s, intent) => { assert.equal(intent.media?.type, "IMAGE"); return { outcome: "DISPATCHED", providerMessageId: intent.providerMessageId }; }, readMedia: async s => { assert.equal(s.organizationId, orgA); downloads++; return { stream: Readable.from([payload]), size: payload.length, sha256: hash, mimeType: "image/png" }; } };
  const activeConfig = { ...config, PROVIDER_OUTBOUND_ENABLED: true, PROVIDER_MEDIA_ENABLED: true }, mediaApp = await buildApp(activeConfig, db, redis, false, undefined, mediaProvider);
  const thread = await db.conversation.findFirstOrThrow({ where: { organizationId: orgA, channelId, providerConversationId: "5581999999999@s.whatsapp.net" } });
  const meta = { mediaId: id, type: "IMAGE", mimeType: "image/png", fileName: "synthetic.png", size: payload.length, sha256: hash, state: "PENDING" };
  const message = await db.message.create({ data: { organizationId: orgA, channelId, conversationId: thread.id, type: "IMAGE", direction: "INBOUND", body: null, mediaMetadata: meta } });
  const url = `/api/v1/conversations/${thread.id}/messages/${message.id}/media`;
  await db.providerConnection.update({ where: { organizationId_channelId: { organizationId: orgA, channelId } }, data: { mediaEnabled: true, outboundEnabled: true, state: "CONNECTED", lastCheckedAt: new Date(), errorCode: null } });
  try {
    const uploadId = randomUUID(), query = new URLSearchParams({ mediaId: uploadId, type: "IMAGE", mimeType: "image/png", fileName: "synthetic.png", size: String(payload.length), sha256: hash }), uploadUrl = `/api/v1/conversations/${thread.id}/media?${query}`;
    const noCsrf = await mediaApp.inject({ method: "POST", url: uploadUrl, payload, headers: { cookie: owner.cookie, origin, "content-type": "application/octet-stream" } }); assert.equal(noCsrf.statusCode, 403);
    const uploaded = await mediaApp.inject({ method: "POST", url: uploadUrl, payload, headers: { cookie: owner.cookie, origin, "content-type": "application/octet-stream", "x-csrf-token": owner.csrf } }); assert.equal(uploaded.statusCode, 200, uploaded.body);
    const uploadRow = await db.media.findUniqueOrThrow({ where: { id: uploadId } }); assert.equal(uploadRow.organizationId, orgA); assert.equal(uploadRow.actorUserId, owner.userId);
    const accepted = await mediaApp.inject({ method: "POST", url: `/api/v1/conversations/${thread.id}/messages`, payload: { body: "", mediaId: uploadId, clientMessageId: randomUUID() }, headers: { cookie: owner.cookie, origin, "x-csrf-token": owner.csrf } }); assert.equal(accepted.statusCode, 200, accepted.body); const sent = accepted.json(); assert.equal(sent.type, "IMAGE"); assert.equal(sent.status, "PENDING");
    const mediaChat = new Chat(db, activeConfig, async () => undefined, new DemoProvider(), new MessageIngestionService()); await new WebProviderWorker(db, mediaChat, mediaProvider).runConnection(scope()); assert.equal((await db.media.findUniqueOrThrow({ where: { id: uploadId } })).messageId, sent.id);
    const foreign = await mediaApp.inject({ url, headers: { cookie: other.cookie, origin } }); assert.equal(foreign.statusCode, 403); assert.equal(downloads, 0);
    const response = await mediaApp.inject({ url, headers: { cookie: owner.cookie, origin } }); assert.equal(response.statusCode, 200, response.body); assert.deepEqual(response.rawPayload, payload); assert.equal(response.headers["cache-control"], "no-store, private"); assert.equal(downloads, 1);
    const partial = await mediaApp.inject({ url, headers: { cookie: owner.cookie, origin, range: "bytes=1-5" } }); assert.equal(partial.statusCode, 206); assert.deepEqual(partial.rawPayload, payload.subarray(1,6)); assert.equal(partial.headers["content-range"], `bytes 1-5/${payload.length}`); assert.equal(downloads, 2);
    const invalidRange = await mediaApp.inject({ url, headers: { cookie: owner.cookie, origin, range: "bytes=999-1000" } }); assert.equal(invalidRange.statusCode, 416); assert.equal(downloads, 3);
    await db.conversation.update({ where: { organizationId_id: { organizationId: orgA, id: thread.id } }, data: { assignedUserId: denied.userId, visibility: "NONE", visibleFromMessage: message.sequence + 1n } });
    const membership = await db.membership.findFirstOrThrow({ where: { organizationId: orgA, userId: denied.userId } }), permission = await db.permission.findUniqueOrThrow({ where: { code: "messages.read" } });
    await db.membershipPermissionOverride.create({ data: { organizationId: orgA, membershipId: membership.id, permissionId: permission.id, effect: "GRANT" } });
    const hidden = await mediaApp.inject({ url, headers: { cookie: denied.cookie, origin } }); assert.equal(hidden.statusCode, 404); assert.equal(downloads, 3);
    await db.membershipPermissionOverride.deleteMany({ where: { membershipId: membership.id } });
    await db.conversation.update({ where: { organizationId_id: { organizationId: orgA, id: thread.id } }, data: { assignedUserId: owner.userId, visibility: "FULL", visibleFromMessage: 0n } });
  } finally { await mediaApp.close(); await db.providerConnection.update({ where: { organizationId_channelId: { organizationId: orgA, channelId } }, data: { mediaEnabled: false, outboundEnabled: false } }); }
});

test("P1 received media preserves HTTP errors, ranges, cookie CORS, RBAC and revalidation", async () => {
  const payload = Buffer.from("synthetic received bytes"), hash = createHash("sha256").update(payload).digest("hex");
  let failure: WebProviderError | undefined, downloads = 0, mimeType = "image/png", hook: (() => Promise<void>) | undefined, destroyed = 0;
  const mediaProvider = new FakeProvider() as FakeProvider & Required<Pick<WebProviderPort, "readMedia">>;
  mediaProvider.readMedia = async (_s, _id, signal) => {
    signal?.throwIfAborted(); downloads++; if (failure) throw failure; await hook?.();
    const stream = Readable.from([payload]); stream.once("close", () => destroyed++);
    return { stream, size: payload.length, sha256: hash, mimeType };
  };
  const mediaApp = await buildApp({ ...config, PROVIDER_MEDIA_ENABLED: true }, db, redis, false, undefined, mediaProvider);
  const thread = await db.conversation.findFirstOrThrow({ where: { organizationId: orgA, channelId, providerConversationId: "5581999999999@s.whatsapp.net" } });
  await db.providerConnection.update({ where: { organizationId_channelId: { organizationId: orgA, channelId } }, data: { mediaEnabled: true } });
  try {
    for (const type of ["IMAGE", "AUDIO", "VOICE", "VIDEO"] as const) {
      mimeType = type === "IMAGE" ? "image/png" : type === "VIDEO" ? "video/mp4" : "audio/ogg";
      const message = await db.message.create({ data: { organizationId: orgA, channelId, conversationId: thread.id, type, direction: "INBOUND", mediaMetadata: { mediaId: randomUUID(), type, mimeType, fileName: "synthetic", size: payload.length, sha256: hash, state: "PENDING" } } });
      const url = `/api/v1/conversations/${thread.id}/messages/${message.id}/media`, headers = { cookie: owner.cookie, origin };
      const preflight = await mediaApp.inject({ method: "OPTIONS", url, headers: { origin, "access-control-request-method": "GET", "access-control-request-headers": "range" } }); assert.equal(preflight.statusCode,204); assert.match(String(preflight.headers["access-control-allow-headers"]), /range/i); assert.equal(preflight.headers["access-control-allow-credentials"],"true");
      const unauthenticated = await mediaApp.inject({ url, headers: { origin } }); assert.equal(unauthenticated.statusCode,401);
      const oldDownloads = downloads;
      assert.equal((await mediaApp.inject({ url, headers: { cookie: denied.cookie, origin } })).statusCode,403); assert.equal(downloads,oldDownloads);
      assert.equal((await mediaApp.inject({ url, headers: { cookie: other.cookie, origin } })).statusCode,403); assert.equal(downloads,oldDownloads);
      const response = await mediaApp.inject({ url, headers }); assert.equal(response.statusCode,200,response.body); assert.deepEqual(response.rawPayload,payload); assert.equal(response.headers["access-control-allow-origin"],origin); assert.match(String(response.headers["access-control-expose-headers"]), /content-range/i);
      for (const [range, expected] of [["bytes=0-0",payload.subarray(0,1)],["bytes=4-",payload.subarray(4)],["bytes=-3",payload.subarray(-3)],["bytes=0-999",payload]] as const) {
        const partial = await mediaApp.inject({ url, headers: { ...headers, range } }); assert.equal(partial.statusCode,206); assert.deepEqual(partial.rawPayload,expected);
      }
      for (const range of ["bytes=-0","bytes=999-","bytes=5-1","bytes=0-1,3-4","bytes=9007199254740993-","invalid"]) {
        const result = await mediaApp.inject({ url, headers: { ...headers, range } }); assert.equal(result.statusCode,416); assert.equal(result.headers["content-range"],`bytes */${payload.length}`);
      }
      for (const [code,status] of [["MEDIA_UNAVAILABLE",404],["MEDIA_EXPIRED",410],["MEDIA_INTEGRITY_FAILED",409],["MEDIA_TYPE_MISMATCH",415],["MEDIA_UNAVAILABLE",503],["SESSION_NOT_FOUND",404]] as const) {
        failure = new WebProviderError(code,status); const result = await mediaApp.inject({ url, headers }); assert.equal(result.statusCode,code === "SESSION_NOT_FOUND" ? 503 : status); assert.equal(result.json().error.code,code === "SESSION_NOT_FOUND" ? "MEDIA_UNAVAILABLE" : code);
      }
      failure = undefined;
      const beforeDestroyed = destroyed;
      hook = async () => { await db.conversation.update({ where: { organizationId_id: { organizationId: orgA, id: thread.id } }, data: { assignedUserId: denied.userId } }); };
      // Owner has supervise and still sees the conversation; membership revocation must block after fetch.
      const membership = await db.membership.findFirstOrThrow({ where: { organizationId: orgA, userId: owner.userId } });
      hook = async () => { await db.membership.update({ where: { id: membership.id }, data: { status: "SUSPENDED" } }); };
      try { assert.equal((await mediaApp.inject({ url, headers })).statusCode,403); }
      finally { await db.membership.update({ where: { id: membership.id }, data: { status: "ACTIVE" } }); hook = undefined; }
      await new Promise(resolve => setImmediate(resolve)); assert.ok(destroyed > beforeDestroyed);
      const session = await db.session.findUniqueOrThrow({ where: { id: owner.sessionId } }); await db.session.update({ where: { id: owner.sessionId }, data: { expiresAt: new Date(0) } });
      try { assert.equal((await mediaApp.inject({ url, headers })).statusCode,401); }
      finally { await db.session.update({ where: { id: owner.sessionId }, data: { expiresAt: session.expiresAt } }); }
    }
  } finally { await mediaApp.close(); await db.providerConnection.update({ where: { organizationId_channelId: { organizationId: orgA, channelId } }, data: { mediaEnabled: false } }); }
});

test("P1 browser disconnection cancels Core demand fetch before headers are available", async () => {
  const mediaProvider = new FakeProvider() as FakeProvider & Required<Pick<WebProviderPort, "readMedia">>;
  let started!: () => void, cancelled!: () => void; const downloading=new Promise<void>(resolve=>{started=resolve;}), cancellation=new Promise<void>(resolve=>{cancelled=resolve;});
  mediaProvider.readMedia=async(_s,_id,signal)=>new Promise((_resolve,reject)=>{assert.ok(signal);started();signal.addEventListener("abort",()=>{cancelled();reject(new WebProviderError("MEDIA_UNAVAILABLE"));},{once:true});});
  const mediaApp=await buildApp({...config,PROVIDER_MEDIA_ENABLED:true},db,redis,false,undefined,mediaProvider);
  const thread=await db.conversation.findFirstOrThrow({where:{organizationId:orgA,channelId,providerConversationId:"5581999999999@s.whatsapp.net"}});
  const message=await db.message.create({data:{organizationId:orgA,channelId,conversationId:thread.id,type:"IMAGE",direction:"INBOUND",mediaMetadata:{mediaId:randomUUID(),type:"IMAGE",mimeType:"image/png",fileName:"synthetic",size:1,sha256:"a".repeat(64),state:"PENDING"}}});
  await db.providerConnection.update({where:{organizationId_channelId:{organizationId:orgA,channelId}},data:{mediaEnabled:true}});
  try {
    await mediaApp.listen({host:"127.0.0.1",port:0});const abort=new AbortController(), request=fetch(`${mediaApp.listeningOrigin}/api/v1/conversations/${thread.id}/messages/${message.id}/media`,{headers:{cookie:owner.cookie,origin},signal:abort.signal});const rejected=assert.rejects(request);
    await downloading;abort.abort();await rejected;await cancellation;
  } finally {await mediaApp.close();await db.providerConnection.update({where:{organizationId_channelId:{organizationId:orgA,channelId}},data:{mediaEnabled:false}});}
});

test("B4 delivered bootstrap uses scoped correlation without spending or replacing an ON_DEMAND grant", async () => {
  const before = await db.providerConnection.findUniqueOrThrow({ where: { organizationId_channelId: { organizationId: orgA, channelId } } });
  const granted = before.historyOperation, calls = provider.calls.length;
  const batch = syncBatch([{ kind: "conversation", identity: { externalId: "b4-bootstrap-metadata@lid", name: "Synthetic metadata only" }, metadata: { archived: true } }]);
  batch.correlationId = bootstrapCorrelationId(scope());
  await leased(token => ingestion.apply(scope(), batch, token));
  const after = await db.providerConnection.findUniqueOrThrow({ where: { organizationId_channelId: { organizationId: orgA, channelId } } });
  assert.deepEqual(after.historyOperation, granted); assert.equal(provider.calls.length, calls);
  const thread = await db.conversation.findFirstOrThrow({ where: { organizationId: orgA, channelId, providerConversationId: "b4-bootstrap-metadata@lid" } });
  assert.equal(thread.status, "OPEN"); assert.equal(await db.message.count({ where: { conversationId: thread.id } }), 0);
});

test("disabled on-demand history still ingests scoped bootstrap and live messages through Worker", async () => {
 const disabledChat = new Chat(db, loadConfig({ ...process.env, NODE_ENV: "test", PROVIDER_HISTORY_EXECUTION_ENABLED: "false" }), async () => {}, new DemoProvider(), new MessageIngestionService());
 const disabledIngestion = new WebIngestion(disabledChat), disabledWorker = new WebProviderWorker(db, disabledChat, provider);
 const before = await db.providerConnection.findUniqueOrThrow({ where: { organizationId_channelId: { organizationId: orgA, channelId } } });
 const bootstrap = syncBatch([syncMessage("recovery-bootstrap@lid", "recovery-bootstrap")]);
 bootstrap.correlationId = bootstrapCorrelationId(scope());
 const live = syncBatch([syncMessage("recovery-live@lid", "recovery-live")], false);
 provider.events = [live, bootstrap].map(event => ({ event, leaseId: randomUUID(), attempt: 1 }));
 await disabledWorker.runConnection(scope());
 assert.ok(provider.acked.includes(live.eventId)); assert.ok(provider.acked.includes(bootstrap.eventId));
 assert.ok(!provider.nacked.includes(live.eventId)); assert.ok(!provider.nacked.includes(bootstrap.eventId));
 assert.equal(await db.message.count({ where: { organizationId: orgA, channelId, providerMessageId: "recovery-bootstrap", historical: true } }), 1);
 assert.equal(await db.message.count({ where: { organizationId: orgA, channelId, providerMessageId: "recovery-live", historical: false } }), 1);
 const after = await db.providerConnection.findUniqueOrThrow({ where: { organizationId_channelId: { organizationId: orgA, channelId } } });
 assert.deepEqual(after.historyOperation, before.historyOperation);
 await leased(async token => {
  assert.equal(await disabledIngestion.apply(scope(), bootstrap, token), false);
  await assert.rejects(disabledIngestion.apply(scope(), { ...bootstrap, correlationId: randomUUID() }, token), /HISTORY_EXECUTION_DISABLED/);
  await assert.rejects(disabledIngestion.apply(scope(), { ...bootstrap, correlationId: bootstrapCorrelationId({ organizationId: orgB, connectionId: channelId }) }, token), /HISTORY_EXECUTION_DISABLED/);
  await assert.rejects(disabledIngestion.apply({ organizationId: orgB, connectionId: channelId }, bootstrap, token), /PROVIDER_EVENT_SCOPE_MISMATCH/);
  await assert.rejects(disabledIngestion.apply(scope(), bootstrap, randomUUID()), /STALE_PROVIDER_LEASE/);
 });
 assert.equal(await db.message.count({ where: { organizationId: orgA, channelId, providerMessageId: "recovery-bootstrap" } }), 1);
});

test("B5 lifecycle HTTP/outbox/Worker/HMAC authorizes one recovery, fences stops and reports unconfirmed unlink", async () => {
 const directory = await mkdtemp(join(tmpdir(), "b5-lifecycle-")), vaultKey = randomBytes(32), vault = new Vault(join(directory, "sessions"), vaultKey); await vault.initialize();
 const journal = new EventJournal(vault), key = randomBytes(32), auth = new InternalAuth(key, join(directory, "nonces")); await auth.initialize();
 const creds = JSON.stringify({ me: { id: "synthetic@lid" }, signedIdentityKey: { private: "synthetic", public: "synthetic" }, noiseKey: { private: "synthetic", public: "synthetic" } });
 await vault.update(scope(), r => { r.auth = creds; r.state = "FAILED"; r.errorCode = "RECONNECT_LIMIT"; r.attempts = 5; r.desired = true; });
 let starts = 0; const callbacks: TransportCallbacks[] = [], timers: { run: () => void; delay: number; canceled: boolean }[] = [];
 const sessions = new Sessions(vault, journal, async (_scope, cb) => { starts++; callbacks.push(cb); assert.ok(vault.get(scope())?.recovery?.state === "RUNNING" || vault.get(scope())?.pairingAuthorization); return { close() {}, logout: async () => "CONFIRMED" }; }, true, (run, delay) => { const t = { run, delay, canceled: false }; timers.push(t); return () => { t.canceled = true; }; }, Date.now, undefined, { enabled: false, historyEnabled: false, linkedRecoveryOnly: true });
 const source = createHttp(sessions, journal, auth), url = await source.listen({ host: "127.0.0.1", port: 0 }), client = new WebProviderClient(url, key), api = await buildApp(config, db, redis, false, undefined, client), activeWorker = new WebProviderWorker(db, chat, client);
 const original = await db.providerConnection.findUniqueOrThrow({ where: { organizationId_channelId: { organizationId: orgA, channelId } } }), originalChannel = await db.channel.findUniqueOrThrow({ where: { organizationId_id: { organizationId: orgA, id: channelId } } }), ids: string[] = [];
 const read = async () => (await api.inject({ method: "GET", url: `/api/v1${route}`, headers: { origin, cookie: owner.cookie } })).json().connection;
 const submit = async (action: "recover" | "disconnect" | "logout" | "prepare_link" | "connect", values = {}, a = owner, status = 200) => { const commandId = randomUUID(); ids.push(commandId); const response = await api.inject({ method: "POST", url: `/api/v1${route}/${channelId}/commands`, headers: { origin, cookie: a.cookie, "x-csrf-token": a.csrf }, payload: { action, commandId, expectedVersion: (await read()).version, ...values } }); assert.equal(response.statusCode, status, response.body); return commandId; };
 try {
  await db.providerConnection.update({ where: { organizationId_channelId: { organizationId: orgA, channelId } }, data: { providerRevision: 0, state: "FAILED", errorCode: "RECONNECT_LIMIT", providerSync: Prisma.DbNull } });
  await activeWorker.runConnection(scope()); assert.equal(starts, 0); assert.equal((await read()).lifecycle.recoveryEligible, true);
  await submit("recover", {}, owner, 400); await submit("recover", { confirmed: true }, denied, 403); await submit("recover", { confirmed: true }, other, 404);
  const noCsrf = await api.inject({ method: "POST", url: `/api/v1${route}/${channelId}/commands`, headers: { origin, cookie: owner.cookie }, payload: { action: "recover", confirmed: true, commandId: randomUUID(), expectedVersion: (await read()).version } }); assert.equal(noCsrf.statusCode, 403);
  const badOrigin = await api.inject({ method: "POST", url: `/api/v1${route}/${channelId}/commands`, headers: { origin: "https://untrusted.invalid", cookie: owner.cookie, "x-csrf-token": owner.csrf }, payload: { action: "recover", confirmed: true, commandId: randomUUID(), expectedVersion: (await read()).version } }); assert.equal(badOrigin.statusCode, 403);
  const id = await submit("recover", { confirmed: true }); await activeWorker.runConnection(scope()); assert.equal(starts, 1); assert.equal((await read()).lifecycle.recovery.state, "RUNNING");
  await api.inject({ method: "POST", url: `/api/v1${route}/${channelId}/commands`, headers: { origin, cookie: owner.cookie, "x-csrf-token": owner.csrf }, payload: { action: "recover", confirmed: true, commandId: id, expectedVersion: 1 } }); await activeWorker.runConnection(scope()); assert.equal(starts, 1);
  callbacks[0]!.connection({ state: "close", code: 503 }); await sessions.settle(scope()); await activeWorker.runConnection(scope()); assert.equal((await read()).lifecycle.recovery.state, "FAILED");
  const cancelled = await submit("recover", { confirmed: true }); await submit("disconnect"); await activeWorker.runConnection(scope()); assert.equal(starts, 1); assert.equal((await read()).state, "DISCONNECTED"); assert.equal((await read()).lifecycle.termination.remote, "NOT_REQUESTED"); assert.equal((await db.providerCommand.findUniqueOrThrow({ where: { id: cancelled } })).errorCode, "CONNECTION_STOP_AUTHORIZED");
  await assert.rejects(client.command(scope(), "connect", randomUUID(), 1), /STALE_CONTROL_COMMAND/); await sessions.recover(); assert.equal(starts, 1);
  await submit("recover", { confirmed: true }); await activeWorker.runConnection(scope()); assert.equal(starts, 2); callbacks[1]!.connection({ state: "open" }); await sessions.settle(scope()); await activeWorker.runConnection(scope()); assert.equal((await read()).lifecycle.recovery.state, "AUTHENTICATED");
  timers.find(t => !t.canceled && t.delay === 30000)!.run(); await sessions.settle(scope()); await activeWorker.runConnection(scope()); assert.equal((await read()).lifecycle.recovery.state, "SUCCEEDED"); assert.equal(vault.get(scope())?.attempts, 7);
  await submit("disconnect"); await activeWorker.runConnection(scope()); await submit("logout", {}, owner, 400); await submit("logout", { confirmed: true }); await activeWorker.runConnection(scope()); const stopped = await read(); assert.equal(stopped.state, "DISCONNECTED"); assert.equal(stopped.lifecycle.termination.remote, "UNCONFIRMED"); assert.equal(stopped.lifecycle.termination.errorCode, "LOGOUT_TRANSPORT_UNAVAILABLE"); assert.equal(vault.get(scope())?.auth, creds); assert.equal(stopped.sendingEnabled, false);
  assert.equal(stopped.lifecycle.preparationEligible, true); assert.equal(stopped.lifecycle.removalConfirmationRequired, true);
  await submit("prepare_link", {}, owner, 400); await submit("prepare_link", { confirmed: true }, owner, 409); await submit("prepare_link", { confirmed: true, removedOnPhone: true }, denied, 403); await submit("prepare_link", { confirmed: true, removedOnPhone: true }, other, 404);
  // Reproduce the productive saturated receipt window, without real network.
  await vault.update(scope(), r => { r.commands = Array.from({ length: 256 }, () => ({ id: randomUUID(), digest: "synthetic" })); });
  const legacyId = randomUUID(); ids.push(legacyId);
  await db.providerCommand.create({ data: { id: legacyId, organizationId: orgA, channelId, actorUserId: owner.userId, sessionId: owner.sessionId, action: "prepare_link" } });
  await activeWorker.runConnection(scope());
  const rejected = await db.providerCommand.findUniqueOrThrow({ where: { id: legacyId } }); assert.equal(rejected.status, "FAILED"); assert.equal(rejected.attempts, 1); assert.equal(rejected.errorCode, "SESSION_COMMAND_LIMIT"); assert.equal(vault.get(scope())?.auth, creds); assert.equal(starts, 2);
  await activeWorker.runConnection(scope()); assert.equal((await db.providerCommand.findUniqueOrThrow({ where: { id: legacyId } })).attempts, 1);
  const preparation = await submit("prepare_link", { confirmed: true, removedOnPhone: true }); await activeWorker.runConnection(scope()); assert.equal(starts, 2); assert.equal((await read()).lifecycle.pairingEligible, true); assert.equal(vault.get(scope())?.retiredSessions?.[0]?.auth, creds); assert.equal(vault.get(scope())?.auth, undefined); assert.equal(vault.get(scope())?.commands.length, 256); const metadata = (await read()).operation; assert.equal(metadata.status, "COMPLETED"); assert.equal(metadata.attempts, 1); assert.ok(Date.parse(metadata.createdAt)); assert.ok(Date.parse(metadata.updatedAt));
  const duplicate = await api.inject({ method: "POST", url: `/api/v1${route}/${channelId}/commands`, headers: { origin, cookie: owner.cookie, "x-csrf-token": owner.csrf }, payload: { action: "prepare_link", confirmed: true, removedOnPhone: true, commandId: preparation, expectedVersion: 1 } }); assert.equal(duplicate.statusCode, 200); const conflicting = await api.inject({ method: "POST", url: `/api/v1${route}/${channelId}/commands`, headers: { origin, cookie: owner.cookie, "x-csrf-token": owner.csrf }, payload: { action: "prepare_link", confirmed: true, removedOnPhone: false, commandId: preparation, expectedVersion: 1 } }); assert.equal(conflicting.statusCode, 409);
  await submit("connect"); await activeWorker.runConnection(scope()); assert.equal(starts, 3); callbacks[2]!.connection({ qr: "SYNTHETIC_NEW_LINK_QR" }); await sessions.settle(scope()); await activeWorker.runConnection(scope()); const qrResponse = await api.inject({ method: "GET", url: `/api/v1${route}/${channelId}/qr`, headers: { origin, cookie: owner.cookie } }); assert.equal(qrResponse.statusCode, 200); assert.equal(qrResponse.json().qr, "SYNTHETIC_NEW_LINK_QR");
  await vault.update(scope(), r => { r.auth = creds; }); callbacks[2]!.connection({ state: "open" }); await sessions.settle(scope()); await activeWorker.runConnection(scope()); assert.equal((await read()).transportConfirmed, true); assert.equal(vault.get(scope())?.attempts, 8);
  await submit("logout", { confirmed: true }); await activeWorker.runConnection(scope()); assert.equal((await read()).lifecycle.termination.remote, "CONFIRMED"); assert.equal((await read()).lifecycle.removalConfirmationRequired, false); assert.equal(vault.get(scope())?.auth, creds);
  await sessions.shutdown(); const restoredVault = new Vault(vault.directory, vaultKey); await restoredVault.initialize(); // no network is involved in the persisted intent check
  assert.equal(restoredVault.get(scope())?.desired, false); assert.equal(starts, 3);
 } finally {
  await api.close(); await sessions.shutdown(); await source.close(); await db.providerCommand.deleteMany({ where: { organizationId: orgA, id: { in: ids } } });
  await db.providerConnection.update({ where: { organizationId_channelId: { organizationId: orgA, channelId } }, data: { state: original.state, errorCode: original.errorCode, providerRevision: original.providerRevision, pairingPhase: original.pairingPhase, version: original.version, providerSync: original.providerSync ?? Prisma.DbNull, historyOperation: original.historyOperation ?? Prisma.DbNull, outboundEnabled: original.outboundEnabled, mediaEnabled: original.mediaEnabled } }); await db.channel.update({ where: { organizationId_id: { organizationId: orgA, id: channelId } }, data: { status: originalChannel.status } }); await rm(directory, { recursive: true, force: true });
 }
});

async function signatureHarness(t: TestContext) {
  const original = await db.providerConnection.findUniqueOrThrow({ where: { organizationId_channelId: { organizationId: orgA, channelId } } });
  const originalName = (await db.user.findUniqueOrThrow({ where: { id: owner.userId } })).name;
  const fake = new FakeProvider(), frames: { scope: ProviderScope; intent: SendIntent }[] = [];
  const client = Object.assign(fake, { send: async (scope: ProviderScope, intent: SendIntent) => { frames.push({ scope, intent }); return { outcome: "DISPATCHED" as const, providerMessageId: intent.providerMessageId }; } });
  const activeConfig = { ...config, PROVIDER_OUTBOUND_ENABLED: true, PROVIDER_MEDIA_ENABLED: true, PROVIDER_HISTORY_EXECUTION_ENABLED: false };
  const api = await buildApp(activeConfig, db, redis, false, undefined, client);
  const activeChat = new Chat(db, activeConfig, async () => undefined, new DemoProvider(), new MessageIngestionService());
  const activeWorker = new WebProviderWorker(db, activeChat, client);
  const enable = async (organizationId: string, connectionId: string) => {
    fake.views.set(connectionId, { state: "CONNECTED", revision: 1000, qrRevision: 0, attempts: 0, connectEnabled: true });
    await db.providerConnection.upsert({ where: { organizationId_channelId: { organizationId, channelId: connectionId } }, create: { organizationId, channelId: connectionId, state: "CONNECTED", providerRevision: 1000, lastCheckedAt: new Date(), outboundEnabled: true, mediaEnabled: true }, update: { state: "CONNECTED", providerRevision: 1000, errorCode: null, lastCheckedAt: new Date(), outboundEnabled: true, mediaEnabled: true, historyOperation: Prisma.DbNull } });
    await db.channel.update({ where: { id: connectionId }, data: { status: "ENABLED" } });
  };
  await enable(orgA, channelId);
  t.after(async () => {
    await api.close();
    await db.user.update({ where: { id: owner.userId }, data: { name: originalName } });
    await db.session.update({ where: { id: owner.sessionId }, data: { currentOrganizationId: orgA } });
    await db.providerConnection.update({ where: { organizationId_channelId: { organizationId: orgA, channelId } }, data: { state: original.state, providerRevision: original.providerRevision, errorCode: original.errorCode, lastCheckedAt: original.lastCheckedAt, outboundEnabled: original.outboundEnabled, mediaEnabled: original.mediaEnabled, historyOperation: original.historyOperation ?? Prisma.DbNull } });
  });
  const post = async (actor: Auth, conversationId: string, payload: { body: string; clientMessageId: string; mediaId?: string }, status = 200) => {
    const response = await api.inject({ method: "POST", url: `/api/v1/conversations/${conversationId}/messages`, payload, headers: { cookie: actor.cookie, origin, "x-csrf-token": actor.csrf } });
    assert.equal(response.statusCode, status, response.body); return response.json();
  };
  const thread = async (organizationId = orgA, connectionId = channelId) => {
    const jid = `${randomBytes(6).readUIntBE(0, 6)}@lid`;
    const person = await db.contact.create({ data: { organizationId, name: "Synthetic signature contact", primaryIdentifier: jid } });
    await db.contactIdentity.create({ data: { organizationId, channelId: connectionId, contactId: person.id, externalId: jid } });
    return db.conversation.create({ data: { organizationId, channelId: connectionId, contactId: person.id, providerConversationId: jid } });
  };
  return { api, post, thread, enable, frames, activeWorker, activeChat };
}

test("signed wire echoes reconcile live/history without changing originals or accepting genuine conflicts", async t => {
  const f = await signatureHarness(t), thread = await f.thread();
  const rawName = " \n*Ana* _Silva_\u202e ";
  await db.user.update({ where: { id: owner.userId }, data: { name: rawName } });
  const payload = { body: "  *Ana*\n\nOriginal 😀  ", clientMessageId: randomUUID() };
  const [first, duplicate] = await Promise.all([f.post(owner, thread.id, payload), f.post(owner, thread.id, payload)]);
  assert.equal(first.id, duplicate.id); assert.equal(first.body, payload.body); assert.equal(first.senderName, rawName); assert.equal(first.senderUserId, owner.userId);
  const stored = await db.message.findUniqueOrThrow({ where: { id: first.id } });
  assert.equal(stored.transmittedBody, `*Ana Silva*\n${payload.body}`);
  assert.equal(await db.providerCommand.count({ where: { organizationId: orgA, action: "send", payload: { path: "$.messageId", equals: stored.id } } }), 1);
  await f.activeWorker.runConnection(scope()); assert.equal(f.frames.length, 1); assert.equal(f.frames[0]!.intent.body, stored.transmittedBody);
  const echo = event("message.sent", stored.providerMessageId!, stored.transmittedBody!);
  assert.ok(echo.type === "message.sent"); echo.data.providerConversationId = thread.providerConversationId!; echo.data.sender.externalId = thread.providerConversationId!; delete echo.data.content.transmittedBody;
  await leased(async token => {
    assert.equal(await ingestion.apply(scope(), echo, token), true);
    assert.equal(await ingestion.apply(scope(), { ...echo, eventId: randomUUID() }, token), false);
    const item = syncMessage(thread.providerConversationId!, stored.providerMessageId!, now(), true);
    item.message.content = { type: "TEXT", originalBody: stored.transmittedBody! };
    const batch = syncBatch([item]); assert.equal(await ingestion.apply(scope(), batch, token), true);
    assert.equal(syncProgress((await db.providerConnection.findUniqueOrThrow({ where: { organizationId_channelId: { organizationId: orgA, channelId } } })).syncProgress).lastBatch?.rejectedItems, 0);
    const wrongHistory = structuredClone(item); wrongHistory.message.content = { type: "TEXT", originalBody: payload.body };
    await ingestion.apply(scope(), syncBatch([wrongHistory]), token);
    assert.equal(syncProgress((await db.providerConnection.findUniqueOrThrow({ where: { organizationId_channelId: { organizationId: orgA, channelId } } })).syncProgress).lastBatch?.rejectedItems, 1);
    for (const change of ["body", "snapshot", "direction", "conversation", "type"] as const) {
      const invalid = { ...event(change === "direction" ? "message.received" : "message.sent", stored.providerMessageId!), data: structuredClone(echo.data) } as ProviderEvent;
      assert.ok(invalid.type === "message.sent" || invalid.type === "message.received"); invalid.deduplicationId = "a".repeat(63) + String(["body", "snapshot", "direction", "conversation", "type"].indexOf(change));
      if (change === "body") invalid.data.content.originalBody = payload.body;
      if (change === "snapshot") invalid.data.content.transmittedBody = "changed snapshot";
      if (change === "direction") { invalid.data.direction = "INBOUND"; invalid.data.sender.origin = "CONTACT"; }
      if (change === "conversation") { invalid.data.providerConversationId = "123456789@lid"; invalid.data.sender.externalId = "123456789@lid"; }
      if (change === "type") { invalid.capabilities.contentTypes = ["TEXT", "IMAGE"]; invalid.data.content = { type: "IMAGE", originalBody: stored.transmittedBody!, media: { mediaId: randomUUID(), type: "IMAGE", mimeType: "image/png", fileName: "synthetic.png", size: 12, state: "PENDING" } }; }
      await assert.rejects(ingestion.apply(scope(), invalid, token), /PROVIDER_IDEMPOTENCY_CONFLICT/);
    }
  });
  const after = await db.message.findUniqueOrThrow({ where: { id: stored.id } });
  for (const key of ["body", "transmittedBody", "senderUserId", "senderContactId", "clientMessageId", "providerMessageId", "historical"] as const) assert.equal(after[key], stored[key]);
  assert.ok(after.providerOccurredAt); assert.equal(after.status, "SENT");
  assert.equal(await db.message.count({ where: { organizationId: orgA, channelId, providerMessageId: stored.providerMessageId } }), 1);
  await f.post(owner, thread.id, { ...payload, body: "altered" }, 409);
  await f.post(denied, thread.id, payload, 403);
  // New external history/received/device content is never signed or assigned to the operator.
  const history = syncMessage(thread.providerConversationId!, "signature-history"), device = syncMessage(thread.providerConversationId!, "signature-device", now(), true);
  await leased(token => ingestion.apply(scope(), syncBatch([history, device]), token));
  const originals = await db.message.findMany({ where: { channelId, providerMessageId: { in: ["signature-history", "signature-device"] } } });
  assert.equal(originals.length, 2); for (const row of originals) { assert.equal(row.body, "  *Maria:* conteúdo original\n😀  "); assert.equal(row.senderUserId, null); assert.equal(row.transmittedBody, null); assert.equal(row.historical, true); }
  const session = await db.session.findUniqueOrThrow({ where: { id: owner.sessionId } }), user = await db.user.findUniqueOrThrow({ where: { id: owner.userId } });
  assert.equal((await f.activeChat.createNote({ session, user }, thread.id, "Nota original")).body, "Nota original");
  const internal = await db.conversation.create({ data: { organizationId: orgA, contactId: thread.contactId } });
  const internalMessage = await f.post(owner, internal.id, { body: "Interna original", clientMessageId: randomUUID() });
  const internalRow = await db.message.findUniqueOrThrow({ where: { id: internalMessage.id } }); assert.equal(internalRow.direction, "INTERNAL"); assert.equal(internalRow.body, "Interna original"); assert.equal(internalRow.transmittedBody, null);
});

test("signature caption limits roll back before enqueue and media echoes keep exact text and integrity", async t => {
  const f = await signatureHarness(t), thread = await f.thread();
  await db.user.update({ where: { id: owner.userId }, data: { name: "A" } });
  const upload = (type: "IMAGE" | "VIDEO" = "IMAGE") => db.media.create({ data: { id: randomUUID(), organizationId: orgA, channelId, conversationId: thread.id, actorUserId: owner.userId, type, mimeType: type === "IMAGE" ? "image/png" : "video/mp4", fileName: "synthetic", size: 12, sha256: "b".repeat(64), expiresAt: new Date(Date.now() + 3600000) } });
  for (const media of [false, true]) {
    const record = media ? await upload() : undefined, clientMessageId = randomUUID();
    const oversized = await f.post(owner, thread.id, { body: "x".repeat(7997), clientMessageId, ...(record ? { mediaId: record.id } : {}) }, 400);
    assert.equal(oversized.error.code, "MESSAGE_PRESENTATION_TOO_LONG");
    assert.equal(await db.message.count({ where: { organizationId: orgA, conversationId: thread.id, clientMessageId } }), 0);
    assert.equal(await db.providerCommand.count({ where: { organizationId: orgA, action: "send", status: "PENDING" } }), 0);
    if (record) assert.equal((await db.media.findUniqueOrThrow({ where: { id: record.id } })).messageId, null);
    const accepted = await f.post(owner, thread.id, { body: "😀" + "x".repeat(7995), clientMessageId, ...(record ? { mediaId: record.id } : {}) });
    await f.activeWorker.runConnection(scope()); assert.equal([...f.frames.at(-1)!.intent.body].length, 8000); assert.equal(f.frames.at(-1)!.intent.messageId, accepted.id);
  }
  for (const type of ["IMAGE", "VIDEO"] as const) for (const body of ["Legenda\n😀", "", " \t "]) {
    const record = await upload(type), sent = await f.post(owner, thread.id, { body, mediaId: record.id, clientMessageId: randomUUID() });
    const stored = await db.message.findUniqueOrThrow({ where: { id: sent.id } });
    assert.equal(stored.body, body || null); assert.equal(stored.transmittedBody, body.trim() ? `*A*\n${body}` : body);
    await f.activeWorker.runConnection(scope()); const frame = f.frames.at(-1)!.intent;
    assert.equal(frame.body, stored.transmittedBody); assert.equal(frame.media!.mediaId, record.id);
    const echo = event("message.sent", stored.providerMessageId!); assert.ok(echo.type === "message.sent");
    echo.capabilities.contentTypes = ["TEXT", "IMAGE", "VIDEO"];
    echo.data.providerConversationId = thread.providerConversationId!; echo.data.sender.externalId = thread.providerConversationId!;
    echo.data.content = { type, ...(frame.body ? { originalBody: frame.body } : {}), media: { ...frame.media!, state: "PENDING" } };
    await leased(token => ingestion.apply(scope(), echo, token));
    const after = await db.message.findUniqueOrThrow({ where: { id: sent.id } }); assert.equal(after.body, stored.body); assert.equal(after.transmittedBody, stored.transmittedBody); assert.equal(after.senderUserId, owner.userId); assert.equal(after.status, "SENT");
    const invalid = structuredClone(echo); invalid.eventId = randomUUID(); invalid.deduplicationId = randomBytes(32).toString("hex");
    assert.ok(invalid.data.content.type !== "TEXT"); invalid.data.content.media.sha256 = "c".repeat(64);
    await assert.rejects(leased(token => ingestion.apply(scope(), invalid, token)), /PROVIDER_IDEMPOTENCY_CONFLICT/);
  }
  await db.user.update({ where: { id: owner.userId }, data: { name: "*_~`\u202e" } });
  const invalidName = await f.post(owner, thread.id, { body: "Oi", clientMessageId: randomUUID() }, 400); assert.equal(invalidName.error.code, "INVALID_ATTENDANT_NAME");
  const emptyMedia = await upload(); await f.post(owner, thread.id, { body: "", mediaId: emptyMedia.id, clientMessageId: randomUUID() }); await f.activeWorker.runConnection(scope()); assert.equal(f.frames.at(-1)!.intent.body, "");
});

test("signatures bind the authenticated author and tenant even with shared client IDs and organization switches", async t => {
  const f = await signatureHarness(t), threadA = await f.thread(), actorB = await auth(orgB, [...chatPermissions, "providers.manage"]);
  await db.user.update({ where: { id: owner.userId }, data: { name: "Author A" } }); await db.user.update({ where: { id: actorB.userId }, data: { name: "Author B" } });
  const channelB = await db.channel.create({ data: { organizationId: orgB, provider: "WHATSAPP_WEB", status: "ENABLED" } }); await f.enable(orgB, channelB.id); const threadB = await f.thread(orgB, channelB.id);
  const payload = { body: "Same original", clientMessageId: randomUUID() };
  await db.conversation.update({ where: { id: threadA.id }, data: { assignedUserId: denied.userId } });
  const a = await f.post(owner, threadA.id, payload), b = await f.post(actorB, threadB.id, payload); assert.notEqual(a.id, b.id);
  assert.equal(a.senderName, "Author A"); assert.equal(a.senderUserId, owner.userId); assert.equal(b.senderName, "Author B"); assert.equal(b.senderUserId, actorB.userId);
  assert.equal((await db.message.findUniqueOrThrow({ where: { id: a.id } })).transmittedBody, "*Author A*\nSame original"); assert.equal((await db.message.findUniqueOrThrow({ where: { id: b.id } })).transmittedBody, "*Author B*\nSame original");
  await f.post(actorB, threadA.id, payload, 404); await f.post(owner, threadB.id, payload, 404);
  await f.activeWorker.runConnection(scope()); await f.activeWorker.runConnection({ organizationId: orgB, connectionId: channelB.id });
  assert.deepEqual(f.frames.map(x => [x.scope.organizationId, x.intent.messageId, x.intent.body]), [[orgA, a.id, "*Author A*\nSame original"], [orgB, b.id, "*Author B*\nSame original"]]);
  const membership = await db.membership.findFirstOrThrow({ where: { userId: owner.userId, organizationId: orgA } });
  await db.membership.create({ data: { organizationId: orgB, userId: owner.userId, roleId: membership.roleId } });
  await db.session.update({ where: { id: owner.sessionId }, data: { currentOrganizationId: orgB } });
  await f.post(owner, threadB.id, payload, 409); // same tenant/client ID belongs to another author
  const switched = await f.post(owner, threadB.id, { ...payload, clientMessageId: randomUUID() }); assert.equal(switched.senderUserId, owner.userId);
  await f.activeWorker.runConnection({ organizationId: orgB, connectionId: channelB.id }); assert.equal(f.frames.at(-1)!.intent.body, "*Author A*\nSame original"); assert.equal(f.frames.at(-1)!.scope.organizationId, orgB);
  await db.membership.update({ where: { id: membership.id }, data: { status: "SUSPENDED" } });
  try { await db.session.update({ where: { id: owner.sessionId }, data: { currentOrganizationId: orgA } }); await f.post(owner, threadA.id, { ...payload, clientMessageId: randomUUID() }, 403); }
  finally { await db.membership.update({ where: { id: membership.id }, data: { status: "ACTIVE" } }); }
});

test("legacy queued messages retain signed/unsigned snapshots and body fallback after user renaming", async t => {
  const f = await signatureHarness(t), thread = await f.thread();
  for (const transmittedBody of [null, "Legacy original", "*Previous attendant*\n\nLegacy original"] as const) {
    const message = await db.message.create({ data: { organizationId: orgA, channelId, conversationId: thread.id, senderUserId: owner.userId, clientMessageId: randomUUID(), providerMessageId: randomUUID().replaceAll("-", "").toUpperCase(), direction: "OUTBOUND", status: "PENDING", body: "Legacy original", transmittedBody } });
    const commandId = randomUUID();
    await db.providerCommand.create({ data: { id: commandId, organizationId: orgA, channelId, actorUserId: owner.userId, sessionId: owner.sessionId, action: "send", payload: { messageId: message.id, expiresAt: new Date(Date.now() + 3600000).toISOString() } } });
    await db.user.update({ where: { id: owner.userId }, data: { name: "Changed after legacy enqueue" } });
    const repeated = await f.post(owner, thread.id, { body: message.body!, clientMessageId: message.clientMessageId! }); assert.equal(repeated.id, message.id); assert.equal(repeated.senderName, "Changed after legacy enqueue");
    await f.activeWorker.runConnection(scope()); const frame = f.frames.at(-1)!.intent;
    assert.equal(frame.body, transmittedBody ?? "Legacy original"); assert.equal(frame.messageId, message.id); assert.equal(frame.commandId, commandId); assert.equal(frame.providerMessageId, message.providerMessageId);
    const echo = event("message.sent", frame.providerMessageId, frame.body); assert.ok(echo.type === "message.sent"); echo.data.providerConversationId = thread.providerConversationId!; echo.data.sender.externalId = thread.providerConversationId!; delete echo.data.content.transmittedBody;
    await leased(token => ingestion.apply(scope(), echo, token));
    const after = await db.message.findUniqueOrThrow({ where: { id: message.id } }); assert.equal(after.body, message.body); assert.equal(after.transmittedBody, transmittedBody); assert.equal(after.senderUserId, owner.userId); assert.equal(after.status, "SENT");
  }
  assert.equal(f.frames.length, 3);
});

for (const snapshot of ["queued snapshot", "legacy body fallback", "legacy empty snapshot"] as const) test(`local media whitespace captions accept absent/preserved echoes and reject text conflicts (${snapshot})`, async t => {
  const f = await signatureHarness(t), thread = await f.thread();
  for (const type of ["IMAGE", "VIDEO"] as const) for (const body of ["   ", " \t\r\n\u00a0\u2028\u2029 "]) {
    const media = await db.media.create({ data: { id: randomUUID(), organizationId: orgA, channelId, conversationId: thread.id, actorUserId: owner.userId, type, mimeType: type === "IMAGE" ? "image/png" : "video/mp4", fileName: "synthetic", size: 12, sha256: "b".repeat(64), expiresAt: new Date(Date.now() + 3600000) } });
    const sent = await f.post(owner, thread.id, { body, mediaId: media.id, clientMessageId: randomUUID() });
    if (snapshot !== "queued snapshot") await db.message.update({ where: { id: sent.id }, data: { transmittedBody: snapshot === "legacy body fallback" ? null : "" } });
    const original = await db.message.findUniqueOrThrow({ where: { id: sent.id } });
    assert.equal(original.body, body); assert.equal(original.transmittedBody, snapshot === "queued snapshot" ? body : snapshot === "legacy body fallback" ? null : "");
    await f.activeWorker.runConnection(scope()); const frame = f.frames.at(-1)!.intent;
    assert.equal(frame.body, snapshot === "legacy empty snapshot" ? "" : body); assert.equal(frame.messageId, sent.id);
    for (const caption of [undefined, body, "", "Texto realmente divergente"]) {
      const echo = event("message.sent", frame.providerMessageId); assert.ok(echo.type === "message.sent");
      echo.deduplicationId = randomBytes(32).toString("hex"); echo.capabilities.contentTypes = ["TEXT", "IMAGE", "VIDEO"];
      echo.data.providerConversationId = thread.providerConversationId!; echo.data.sender.externalId = thread.providerConversationId!;
      echo.data.content = { type, ...(caption === undefined ? {} : { originalBody: caption }), media: { ...frame.media!, state: "PENDING" } };
      if (caption === "Texto realmente divergente") await assert.rejects(leased(token => ingestion.apply(scope(), echo, token)), /PROVIDER_IDEMPOTENCY_CONFLICT/);
      else await leased(async token => {
        assert.equal(await ingestion.apply(scope(), echo, token), true);
        assert.equal(await ingestion.apply(scope(), { ...echo, eventId: randomUUID() }, token), false);
      });
      const after = await db.message.findUniqueOrThrow({ where: { id: sent.id } });
      for (const key of ["body", "transmittedBody", "senderUserId", "senderContactId", "clientMessageId", "providerMessageId", "historical"] as const) assert.equal(after[key], original[key]);
      assert.equal(await db.message.count({ where: { organizationId: orgA, channelId, providerMessageId: original.providerMessageId } }), 1);
    }
    const after = await db.message.findUniqueOrThrow({ where: { id: sent.id } }); assert.equal(after.status, "SENT"); assert.ok(after.providerOccurredAt);
  }
});

test("whitespace echo equivalence never accepts omitted textual captions or changes external media comparison", async t => {
  const f = await signatureHarness(t), thread = await f.thread();
  for (const local of [false, true]) {
    const media = { mediaId: randomUUID(), type: "IMAGE" as const, mimeType: "image/png", fileName: "synthetic", size: 12, state: "PENDING" as const };
    const original = await db.message.create({ data: { organizationId: orgA, channelId, conversationId: thread.id, direction: "OUTBOUND", type: "IMAGE", senderUserId: local ? owner.userId : null, providerMessageId: randomUUID().replaceAll("-", "").toUpperCase(), body: local ? "Legenda original" : "   ", transmittedBody: local ? "*Ana*\n\nLegenda original" : null, mediaMetadata: media } });
    for (const caption of [undefined, "", " \t ", "Legenda realmente divergente"]) {
      const echo = event("message.sent", original.providerMessageId!); assert.ok(echo.type === "message.sent");
      echo.deduplicationId = randomBytes(32).toString("hex"); echo.capabilities.contentTypes = ["TEXT", "IMAGE"];
      echo.data.providerConversationId = thread.providerConversationId!; echo.data.sender.externalId = thread.providerConversationId!;
      echo.data.content = { type: "IMAGE", ...(caption === undefined ? {} : { originalBody: caption }), media };
      await assert.rejects(leased(token => ingestion.apply(scope(), echo, token)), /PROVIDER_IDEMPOTENCY_CONFLICT/);
    }
    assert.deepEqual(await db.message.findUniqueOrThrow({ where: { id: original.id } }), original);
  }
});

test('P1.2 provider receipts commit SQL + realtime, replay ordered checkpoints and REST confirms delivery', async () => {
  const old = await db.providerConnection.findUniqueOrThrow({ where: { organizationId_channelId: { organizationId: orgA, channelId } } });
  const token = randomUUID(), providerId = 'p12-' + randomUUID();
  const person = await db.contact.create({ data: { organizationId: orgA, name: 'Synthetic P12', primaryIdentifier: randomUUID() } });
  const thread = await db.conversation.create({ data: { organizationId: orgA, channelId, contactId: person.id, assignedUserId: owner.userId, providerConversationId: 'p12@s.whatsapp.net' } });
  const pending = await chat.integrationMutation(orgA, async tx => {
    const message = await tx.message.create({ data: { organizationId: orgA, channelId, conversationId: thread.id, senderUserId: owner.userId, direction: 'OUTBOUND', body: 'Synthetic P12', providerMessageId: providerId, clientMessageId: randomUUID(), status: 'PENDING' } });
    await chat.resourceEvent(tx, orgA, 'message.created', message.id, thread.id, message.sequence); return message;
  });
  const cursor = String((await db.realtimeEvent.findFirst({ where: { organizationId: orgA }, orderBy: { id: 'desc' } }))!.id);
  const frames: { type: string; eventId?: string; lastEventId?: string; entityId?: string }[] = [];
  const socket = new WebSocket(baseUrl.replace('http', 'ws') + '/api/v1/realtime?lastEventId=' + cursor, { headers: { origin, cookie: owner.cookie } });
  socket.on('message', data => frames.push(JSON.parse(String(data))));
  async function waitFor(predicate: () => boolean) { const until = Date.now() + 5000; while (!predicate() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(predicate()); }
  try {
    await waitFor(() => frames.some(frame => frame.type === 'sync.checkpoint'));
    await db.providerConnection.update({ where: { organizationId_channelId: { organizationId: orgA, channelId } }, data: { leaseToken: token, leaseUntil: new Date(Date.now() + 60000) } });
    for (const status of ['SENT', 'DELIVERED', 'READ'] as const) {
      const receipt = event('message.updated', providerId, status);
      await ingestion.apply(scope(), receipt, token); await ingestion.apply(scope(), receipt, token);
      const row = await db.message.findUniqueOrThrow({ where: { id: pending.id } }); assert.equal(row.status, status);
      const rest = (await request(owner, 'GET', `/conversations/${thread.id}/messages`)).json().items;
      assert.equal(rest.find((item: { id: string }) => item.id === pending.id).status, status);
      const targeted = (await request(owner, 'GET', `/conversations/${thread.id}/messages/${pending.id}`)).json(); assert.equal(targeted.status, status); assert.equal(targeted.clientMessageId, pending.clientMessageId);
      assert.equal(rest.find((item: { id: string }) => item.id === pending.id).clientMessageId, pending.clientMessageId);
    }
    await ingestion.apply(scope(), event('message.updated', providerId, 'SENT'), token);
    assert.equal((await db.message.findUniqueOrThrow({ where: { id: pending.id } })).status, 'READ');
    await waitFor(() => frames.filter(frame => frame.type === 'message.updated' && frame.entityId === pending.id).length === 3);
    const updates = frames.filter(frame => frame.type === 'message.updated' && frame.entityId === pending.id);
    assert.deepEqual(updates.map(frame => frame.eventId), [...updates.map(frame => frame.eventId!)].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1));
    const replay = (await request(owner, 'GET', `/realtime/events?lastEventId=${cursor}`)).json();
    assert.deepEqual(replay.events.filter((frame: { entityId: string }) => frame.entityId === pending.id).map((frame: { eventId: string }) => frame.eventId), updates.map(frame => frame.eventId));
    await request(await auth(orgB, chatPermissions), 'GET', `/conversations/${thread.id}/messages`, undefined, 404);
    await request(denied, 'GET', `/conversations/${thread.id}/messages`, undefined, 403);
    await request(denied, 'GET', `/conversations/${thread.id}/messages/${pending.id}`, undefined, 403);
    await request(await auth(orgB, chatPermissions), 'GET', `/conversations/${thread.id}/messages/${pending.id}`, undefined, 404);
  } finally {
    socket.close(); await db.providerConnection.update({ where: { organizationId_channelId: { organizationId: orgA, channelId } }, data: { leaseToken: old.leaseToken, leaseUntil: old.leaseUntil } });
  }
});
