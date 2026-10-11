import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { deflateSync } from "node:zlib";
import { Readable } from "node:stream";
import { makeEventBuffer, proto } from "baileys";
import pino from "pino";
import { fixture } from "./helpers.js";
import { HistoryImporter } from "../src/history-operation.js";
import { Vault } from "../src/vault.js";
import { EventJournal } from "../src/events.js";
import { normalizeContact, normalizeConversation, normalizeSyncMessage } from "../src/sync-normalization.js";
import { baileysFactory } from "../src/baileys.js";
import { decodeBoundedHistory } from "../src/history.js";
import { selectHistory } from "../src/history-selection.js";
import type { HistorySpec } from "../../../contracts/history.js";
import type { SyncItem } from "../../../contracts/provider.js";
const spec = (messages = 1000): HistorySpec => { const now = Date.now(); return ({ id: randomUUID(), from: new Date(now - 30 * 86400000).toISOString(), to: new Date(now).toISOString(), limits: { contacts: 500, conversations: 500, messages }, anchors: [{ chatId: "anchor@lid", messageId: "known", fromMe: false, timestamp: now }] }); };
async function until(check: () => boolean) { for (let i = 0; i < 400; i++) { if (check()) return; await delay(10); } assert.fail("bounded synthetic wait expired"); }
test("CP4.6 disabled execution prepares idempotently without history requests or auth mutations", async (t) => {
 const f = await fixture(t); await f.sessions.create(f.scope); await f.vault.update(f.scope, (r) => { r.auth = "synthetic-preserved-auth"; r.keys = { preserved: "opaque" }; });
 let requests = 0; const importer = new HistoryImporter(f.vault, f.scope, async () => { requests++; return "request"; }, async () => [], false);
 const s = spec(), c = { commandId: s.id, operationId: s.id, action: "prepare" as const, spec: s };
 await importer.command(c); await importer.command(c);
 await assert.rejects(importer.command({ ...c, spec: { ...s, limits: { ...s.limits, messages: 20 } } }), /IDEMPOTENCY_CONFLICT/);
 await assert.rejects(importer.command({ commandId: randomUUID(), operationId: s.id, action: "start" }), /HISTORY_EXECUTION_DISABLED/);
 assert.equal(requests, 0); assert.equal(f.vault.get(f.scope)?.auth, "synthetic-preserved-auth"); assert.equal(f.vault.get(f.scope)?.keys.preserved, "opaque");
 await assert.rejects(importer.command({ commandId: randomUUID(), operationId: randomUUID(), action: "cancel" }), /HISTORY_OPERATION_MISMATCH/);
 importer.close();
});
test("CP4.6 bounded producer waits for staging, prioritizes live, restores cursor and does not request after restart", async (t) => {
 const f = await fixture(t); await f.sessions.create(f.scope); let requests = 0; const cpu = process.cpuUsage(), started = performance.now(); let peakRss = process.memoryUsage().rss;
 const s = spec(), importer = new HistoryImporter(f.vault, f.scope, async () => { requests++; return "request"; }, async () => [], true);
 t.after(() => importer.close());
 await importer.command({ commandId: s.id, operationId: s.id, action: "prepare", spec: s });
 await importer.command({ commandId: randomUUID(), operationId: s.id, action: "start" }); await until(() => requests === 1);
 const items: SyncItem[] = [];
 for (let i = 0; i < 500; i++) items.push(normalizeContact({ id: `history${i}@lid`, name: "Synthetic" })!);
 for (let i = 0; i < 500; i++) items.push(normalizeConversation({ id: `history${i}@lid`, conversationTimestamp: Math.floor(Date.now() / 1000) - 3600 })!);
 for (let i = 0; i < 1000; i++) items.push(normalizeSyncMessage(f.scope, { key: { id: `message${i}`, remoteJid: `history${i % 500}@lid`, fromMe: i % 2 === 0 }, messageTimestamp: Math.floor(Date.now() / 1000) - 3600, message: { conversation: "*Maria:* synthetic" } })!);
 await importer.receive(items); await until(() => importer.current?.state === "BACKPRESSURE");
 assert.equal(importer.current?.cursor, 1500);
 const live = normalizeSyncMessage(f.scope, { key: { id: "live", remoteJid: "history0@lid" }, messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: "synthetic live" } })!;
 const liveStarted = performance.now(); await f.journal.stage(f.scope, [live], false, false);
 const first = await f.journal.pull(f.scope, 1); assert.equal(first[0]?.event.type, "sync.batch"); assert.equal(first[0]?.event.type === "sync.batch" && first[0].event.data.historical, false);
 await f.journal.ack(f.scope, first[0]!.event.eventId, first[0]!.leaseId); const liveLatencyMs = Math.round(performance.now() - liveStarted);
 await importer.command({ commandId: randomUUID(), operationId: s.id, action: "pause" }); importer.close();
 const restored = new Vault(f.vault.directory, f.key); await restored.initialize();
 const recovered = new HistoryImporter(restored, f.scope, async () => { requests++; return "unexpected"; }, async () => [], true); t.after(() => recovered.close());
 await recovered.recover(); assert.equal(recovered.current?.state, "PAUSED"); assert.equal(requests, 1);
 await recovered.command({ commandId: randomUUID(), operationId: s.id, action: "resume" });
 const journal = new EventJournal(restored); let messages = 0, contacts = 0, conversations = 0;
 for (let i = 0; i < 300; i++) {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  for (const delivery of await journal.pull(f.scope, 20)) {
   if (delivery.event.type === "sync.batch") { assert.equal(delivery.event.correlationId, s.id); for (const item of delivery.event.data.items) { if (item.kind === "message") messages++; else if (item.kind === "contact") contacts++; else conversations++; } }
   await journal.ack(f.scope, delivery.event.eventId, delivery.leaseId);
  }
  if (String(recovered.current?.state) === "COMPLETED" && !restored.metrics().syncQueued && !restored.metrics().pending) break;
  await delay(10);
 }
 assert.equal(messages, 1000); assert.equal(contacts, 500); assert.equal(conversations, 500); assert.equal(requests, 1);
 assert.equal(recovered.current?.failures, 0); assert.equal(recovered.current?.cursor, 0); const usage = process.cpuUsage(cpu); console.log(JSON.stringify({ metric: "cp46.producer.synthetic", contacts, conversations, messages, restored: true, requests, durationMs: Math.round(performance.now() - started), cpuMs: (usage.user + usage.system) / 1000, peakRssBytes: peakRss, liveLatencyMs, isolated: true }));
});
test("CP4.6 duplicate admission keeps budgets, enforces frozen window and preserves queued work on cancel", async (t) => {
 const f = await fixture(t); await f.sessions.create(f.scope); const s = spec(1);
 const importer = new HistoryImporter(f.vault, f.scope, async () => "request", async () => [], true); t.after(() => importer.close());
 await importer.command({ commandId: s.id, operationId: s.id, action: "prepare", spec: s });
 await f.vault.update(f.scope, (r) => { r.historyOperation!.state = "RUNNING"; });
 const item = normalizeSyncMessage(f.scope, { key: { id: "one", remoteJid: "anchor@lid", fromMe: true }, messageTimestamp: Math.floor(Date.now() / 1000) - 3600, message: { conversation: "original" } })!;
 await f.journal.stage(f.scope, [item], true, true, false, 0, false, undefined, s.id, 0);
 await f.journal.stage(f.scope, [item], true, true, false, 0, false, undefined, s.id, 1);
 const outside = { ...item, occurredAt: new Date(Date.now() - 31 * 86400000).toISOString(), message: { ...(item as Extract<SyncItem, { kind: "message" }>).message, providerMessageId: "outside" } } as SyncItem;
 await f.journal.stage(f.scope, [outside], true, true, false, 0, false, undefined, s.id, 2);
 assert.equal(importer.current?.messages, 1); assert.equal(importer.current?.duplicates, 1); assert.equal(importer.current?.limited, true);
 await importer.command({ commandId: randomUUID(), operationId: s.id, action: "cancel" }); assert.equal(f.vault.get(f.scope)?.sync?.pending.length, 1);
 assert.equal((await f.journal.pull(f.scope, 1)).length, 1);
});
test("CP4.6 uncertain dispatch is paused on restart and bounded timeout never repeats the request", async (t) => {
 const f = await fixture(t); await f.sessions.create(f.scope); let now = Date.now(), requests = 0; const s = spec();
 const importer = new HistoryImporter(f.vault, f.scope, async () => { requests++; return "request"; }, async () => [], true, () => now);
 await importer.command({ commandId: s.id, operationId: s.id, action: "prepare", spec: s }); await importer.command({ commandId: randomUUID(), operationId: s.id, action: "start" }); await until(() => requests === 1); importer.close();
 const recovered = new HistoryImporter(f.vault, f.scope, async () => { requests++; return "bad"; }, async () => [], true, () => now); t.after(() => recovered.close());
 await recovered.recover(); assert.equal(recovered.current?.errorCode, "HISTORY_RESTART_PAUSED"); now += 61000;
 await recovered.command({ commandId: randomUUID(), operationId: s.id, action: "resume" }); await until(() => recovered.current?.state === "NO_DATA"); assert.equal(requests, 1);
});
test("CP4.6 wire selection filters old data before object quotas and supports metadata-only conversations", async (t) => {
 const f = await fixture(t), s = spec();
 const message = (id: string, age: number) => ({ message: { key: { id, remoteJid: "anchor@lid", fromMe: true }, messageTimestamp: Math.floor(Date.now() / 1000) - age, message: { conversation: "*Maria:* original" } } });
 const encoded = proto.HistorySync.encode({ syncType: proto.HistorySync.HistorySyncType.ON_DEMAND, conversations: [{ id: "anchor@lid", messages: [...Array.from({ length: 1001 }, (_, i) => message(`outside${i}`, 31 * 86400)), message("inside", 3600)] }, { id: "unknown@lid", name: "Synthetic metadata only", conversationTimestamp: Math.floor(Date.now() / 1000) - 3600, messages: [] }], pushnames: Array.from({ length: 600 }, (_, i) => ({ id: `person${i}@lid`, pushname: "Synthetic" })) }).finish();
 const history = await decodeBoundedHistory(Readable.from([deflateSync(encoded)]), undefined, s);
 assert.equal(history.pushnames?.length, 500); assert.equal(history.conversations?.[0]?.messages?.length, 1);
 const selected = selectHistory(f.scope, history, s); assert.ok(selected.some((x) => x.kind === "conversation" && x.identity.externalId === "unknown@lid"));
 const inside = selected.find((x) => x.kind === "message") as Extract<SyncItem, { kind: "message" }>;
 assert.equal(inside.message.providerMessageId, "inside"); assert.equal(inside.message.sender.origin, "DEVICE"); assert.equal(inside.message.sender.userId, undefined); assert.equal(inside.message.content.originalBody, "*Maria:* original");
});
test("CP4.6 actual SDK notification dispatch uses known anchor, self-only bounded history and existing journal", async (t) => {
 const f = await fixture(t); await f.sessions.create(f.scope); const ev = makeEventBuffer(pino({ level: "silent" })), s = spec(20); let requests = 0;
 const factory = baileysFactory(f.vault, () => ({ ev, end: async () => undefined, logout: async () => undefined, fetchMessageHistory: async (count, key, timestamp) => { assert.equal(count, 20); assert.equal(key.remoteJid, "anchor@lid"); assert.equal(timestamp, s.anchors[0]!.timestamp); requests++; return "sdk-request"; } }), { enabled: true, historyEnabled: false, historyExecutionEnabled: true, approvedScope: `${f.scope.organizationId}:${f.scope.connectionId}` });
 const transport = await factory(f.scope, { connection: () => undefined, text: () => assert.fail(), receipt: () => undefined, failure: () => assert.fail(), sync: () => undefined }); t.after(() => transport.close());
 await transport.history!({ commandId: s.id, operationId: s.id, action: "prepare", spec: s }); await transport.history!({ commandId: randomUUID(), operationId: s.id, action: "start" }); await until(() => requests === 1);
 const compressed = deflateSync(proto.HistorySync.encode({ syncType: proto.HistorySync.HistorySyncType.ON_DEMAND, conversations: [{ id: "unknown@lid", name: "Only metadata", conversationTimestamp: Math.floor(Date.now() / 1000) - 3600 }] }).finish());
 const notification = { initialHistBootstrapInlinePayload: compressed, peerDataRequestSessionId: "sdk-request" };
 const packet = (fromMe: boolean) => ({ key: { id: "notification", remoteJid: "anchor@lid", fromMe }, messageTimestamp: Math.floor(Date.now() / 1000), message: { protocolMessage: { historySyncNotification: notification } } });
 ev.emit("messages.upsert", { type: "notify", messages: [packet(false)] }); await delay(20); assert.equal(f.vault.get(f.scope)?.sync?.pending.length ?? 0, 0);
 ev.emit("messages.upsert", { type: "notify", messages: [packet(true)] }); await until(() => f.vault.get(f.scope)?.historyOperation?.state === "COMPLETED");
 const deliveries = await f.journal.pull(f.scope, 20); assert.ok(deliveries.some((x) => x.event.type === "sync.batch" && x.event.data.historical && x.event.correlationId === s.id && x.event.data.items.some((i) => i.kind === "conversation")));
 assert.equal(requests, 1); assert.equal(f.vault.get(f.scope)?.historyOperation?.messages, 0);
});

test("CP4.6 auxiliary contact quotas never discard metadata-only conversations or verified PN/LID aliases", async (t) => {
 const f = await fixture(t), s = spec();
 const history = { syncType: proto.HistorySync.HistorySyncType.ON_DEMAND, phoneNumberToLidMappings: Array.from({ length: 500 }, (_, i) => ({ pnJid: `551000${i}@s.whatsapp.net`, lidJid: `quota${i}@lid` })), pushnames: Array.from({ length: 500 }, (_, i) => ({ id: `extra${i}@lid`, pushname: "Same name" })), conversations: Array.from({ length: 500 }, (_, i) => ({ id: `quota${i}@lid`, name: "Same name", conversationTimestamp: Math.floor(Date.now() / 1000) - 3600, messages: [] })) };
 const selected = selectHistory(f.scope, history, s), contacts = selected.filter((x) => x.kind === "contact"), conversations = selected.filter((x) => x.kind === "conversation");
 assert.equal(contacts.length, 500); assert.equal(conversations.length, 500); assert.equal(selected.filter((x) => x.kind === "message").length, 0);
 assert.equal(conversations[0]?.identity.externalId, "5510000@s.whatsapp.net"); assert.deepEqual(conversations[0]?.identity.aliases, ["quota0@lid"]); assert.equal(new Set(contacts.map((x) => x.identity.externalId)).size, 500);
});
