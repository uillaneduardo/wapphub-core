import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { Readable } from "node:stream";
import { makeEventBuffer, proto } from "baileys";
import pino from "pino";
import { fixture } from "./helpers.js";
import { Vault } from "../src/vault.js";
import { EventJournal, envelope } from "../src/events.js";
import { baileysFactory } from "../src/baileys.js";
import { decodeBoundedHistory, HISTORY_DECODED_BYTES } from "../src/history.js";
import { normalizeContact, normalizeSyncMessage, directIdentity } from "../src/sync-normalization.js";
import { parseProviderEvent, type SyncItem } from "../../../contracts/provider.js";
import { Serial } from "../src/serial.js";

const sample = (id: string, fromMe = false) => ({ key: { id, remoteJid: "opaque@lid", remoteJidAlt: "551234@s.whatsapp.net", fromMe }, messageTimestamp: Math.floor(Date.now() / 1000), pushName: "Contato externo", message: { conversation: " *Maria:* texto\n😀 " } });
test("CP4 real SDK event map normalizes initial history, contacts/chats and live/device messages", async (t) => {
  const f = await fixture(t), ev = makeEventBuffer(pino({ level: "silent" }));
  const batches: { items: SyncItem[]; historical: boolean; complete?: boolean }[] = [];
  const factory = baileysFactory(f.vault, (options) => { assert.equal(options.shouldSyncHistoryMessage?.({}), false); assert.equal(options.syncFullHistory, false); return { ev, end: async () => undefined, logout: async () => undefined }; }, { enabled: true, historyEnabled: true, approvedScope: `${f.scope.organizationId}:${f.scope.connectionId}` });
  const transport = await factory(f.scope, { connection: () => undefined, text: () => assert.fail("classic text callback must not duplicate batches"), receipt: () => undefined, failure: () => assert.fail(), sync: (items, historical, complete) => { batches.push({ items, historical, complete }); } });
  ev.emit("messaging-history.set", { contacts: [{ id: "opaque@lid", phoneNumber: "551234@s.whatsapp.net", name: "Nome" }], chats: [{ id: "opaque@lid", conversationTimestamp: Math.floor(Date.now() / 1000) }], messages: [sample("history", true)], progress: 100 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  ev.emit("contacts.update", [{ id: "opaque@lid", notify: "Novo nome" }]);
  ev.emit("chats.update", [{ id: "opaque@lid", unreadCount: 2 }]);
  ev.emit("messages.upsert", { type: "notify", messages: [sample("live")] });
  ev.emit("messages.upsert", { type: "notify", requestId: "spoof", messages: [sample("forged")] });
  assert.ok(batches.some((batch) => batch.historical && batch.complete));
  const items = batches.flatMap((batch) => batch.items);
  const own = items.find((item) => item.kind === "message" && item.message.providerMessageId === "history") as Extract<SyncItem, { kind: "message" }>;
  assert.equal(own.message.sender.origin, "DEVICE"); assert.equal(own.identity.name, undefined); assert.equal(own.message.content.originalBody, " *Maria:* texto\n😀 ");
  assert.equal(own.identity.externalId, "551234@s.whatsapp.net"); assert.deepEqual(own.identity.aliases, ["opaque@lid"]);
  assert.ok(items.some((item) => item.kind === "message" && item.message.providerMessageId === "live"));
  assert.ok(!items.some((item) => item.kind === "message" && item.message.providerMessageId === "forged"));
  transport.close(); const before = batches.length; ev.emit("contacts.upsert", [{ id: "late@lid" }]); assert.equal(batches.length, before);
});
test("CP4 history defaults off and another scope cannot inherit import authorization; recent offline append remains continuous", async (t) => {
  const f = await fixture(t), ev = makeEventBuffer(pino({ level: "silent" })), batches: { items: SyncItem[]; historical: boolean }[] = [];
  const factory = baileysFactory(f.vault, () => ({ ev, end: async () => undefined, logout: async () => undefined }), { enabled: true, historyEnabled: true, approvedScope: `${f.other.organizationId}:${f.other.connectionId}` });
  const transport = await factory(f.scope, { connection: () => undefined, text: () => undefined, receipt: () => undefined, failure: () => assert.fail(), sync: (items, historical) => { batches.push({ items, historical }); } });
  ev.emit("messaging-history.set", { contacts: [], chats: [], messages: [sample("denied-history")] });
  ev.emit("messages.upsert", { type: "append", messages: [sample("recent-offline"), { ...sample("old-offline"), messageTimestamp: 1700000000 }] });
  assert.ok(!batches.some((batch) => batch.historical));
  assert.deepEqual(batches.flatMap((batch) => batch.items).filter((item) => item.kind === "message").map((item) => item.message.providerMessageId), ["recent-offline"]);
  transport.close();
});
test("CP4 opaque LIDs never become phone numbers; wrappers and media normalize without raw fields or binaries", async (t) => {
  const f = await fixture(t);
  assert.equal(normalizeContact({ id: "opaque@lid", name: "Maria" })?.identity.externalId, "opaque@lid");
  assert.equal(directIdentity("551234:7@s.whatsapp.net"), "551234@s.whatsapp.net"); assert.equal(directIdentity("status@broadcast"), undefined);
  const item = normalizeSyncMessage(f.scope, { ...sample("media"), message: { imageMessage: { caption: "  *Legenda*  ", mimetype: "image/jpeg", fileLength: 1234, directPath: "/sensitive-not-persisted", mediaKey: Buffer.alloc(32), jpegThumbnail: Buffer.alloc(1024) } } });
  assert.ok(item?.kind === "message" && item.message.content.type === "IMAGE"); assert.equal(item.message.content.originalBody, "  *Legenda*  ");
  const encoded = JSON.stringify(item); assert.ok(!encoded.includes("directPath") && !encoded.includes("mediaKey") && !encoded.includes("jpegThumbnail"));
  assert.equal(normalizeSyncMessage(f.scope, { ...sample("oversized"), message: { documentMessage: { fileLength: 26 * 1024 * 1024 } } }), undefined);
});
test("CP4 bounded history decode accepts actual protobuf and rejects a decompression bomb", async () => {
  const raw = proto.HistorySync.encode({ syncType: proto.HistorySync.HistorySyncType.RECENT, conversations: [{ id: "opaque@lid" }], progress: 100 }).finish();
  const history = await decodeBoundedHistory(Readable.from([deflateSync(raw)])); assert.equal(history.conversations[0]?.id, "opaque@lid");
  await assert.rejects(decodeBoundedHistory(Readable.from([deflateSync(Buffer.alloc(HISTORY_DECODED_BYTES + 1))])), /HISTORY_BYTE_LIMIT/);
});
test("CP4 durable staging restores progress after restart, batches work and prioritizes live traffic", async (t) => {
  const f = await fixture(t); await f.sessions.create(f.scope);
  const items = Array.from({ length: 60 }, (_, index) => normalizeSyncMessage(f.scope, sample("history-" + index))!);
  await f.journal.stage(f.scope, items, true, true, true);
  const restored = new Vault(f.vault.directory, f.key); await restored.initialize(); const journal = new EventJournal(restored, f.now);
  assert.equal(restored.get(f.scope)?.sync?.pending.length, 60);
  const live = { ...envelope(f.scope, "message.received", "priority"), data: { providerMessageId: "priority", providerConversationId: "opaque@lid", sender: { origin: "CONTACT", externalId: "opaque@lid" }, direction: "INBOUND", content: { type: "TEXT", originalBody: "new priority" }, status: "SENT" } };
  await journal.append(f.scope, live);
  const deliveries = await journal.pull(f.scope, 3); assert.equal(deliveries[0]?.event.type, "message.received");
  assert.equal(deliveries[1]?.event.type, "sync.batch"); assert.ok(deliveries.every((delivery) => delivery.event.type !== "sync.batch" || delivery.event.data.items.length <= 20));
  for (const delivery of deliveries) await journal.ack(f.scope, delivery.event.eventId, delivery.leaseId);
  assert.equal(restored.get(f.scope)?.sync?.pending.length, 20);
});
test("CP4 cumulative admission, bytes, retention and envelope limits report partial work without closing live transport", async (t) => {
  const f = await fixture(t); await f.sessions.create(f.scope);
  const large = normalizeSyncMessage(f.scope, { ...sample("large"), message: { conversation: "x".repeat(8000) } })!;
  for (let batch = 0; batch < 6; batch++) await f.journal.stage(f.scope, Array.from({ length: 50 }, () => large), true, true);
  assert.ok(f.vault.get(f.scope)?.sync?.limited); assert.ok(f.vault.get(f.scope)!.sync!.pending.length < 300);
  assert.equal(f.sessions.metrics().active, 0); assert.equal(f.sessions.ready(), true);
  const old = normalizeSyncMessage(f.scope, { ...sample("old"), messageTimestamp: 1700000000 })!;
  const before = f.vault.get(f.scope)!.sync!.pending.length; await f.journal.stage(f.scope, [old], true, true); assert.equal(f.vault.get(f.scope)!.sync!.pending.length, before);
  assert.throws(() => parseProviderEvent({ ...envelope(f.scope, "sync.batch", "too-many"), data: { historical: true, items: Array.from({ length: 21 }, () => large) } }), /INVALID_PROVIDER_EVENT/);
});
test("CP4 dead historical batches remain recoverable without disabling new message intake", async (t) => {
  const f = await fixture(t); await f.sessions.create(f.scope);
  await f.journal.stage(f.scope, [normalizeSyncMessage(f.scope, sample("failed-history"))!], true, true);
  for (let attempt = 0; attempt < 5; attempt++) {
    const [delivery] = await f.journal.pull(f.scope, 1); assert.ok(delivery);
    await f.journal.nack(f.scope, delivery.event.eventId, delivery.leaseId); f.advance(60001);
  }
  assert.equal(f.journal.metrics().syncDead, 1); assert.equal(f.sessions.ready(), true);
  await f.journal.stage(f.scope, [normalizeSyncMessage(f.scope, sample("live-after-failure"))!], false, false);
  const [live] = await f.journal.pull(f.scope, 1); assert.ok(live?.event.type === "sync.batch" && !live.event.data.historical);
});
test("CP4 historical message identities are bounded and live admission has reserved capacity", async (t) => {
  const f = await fixture(t); await f.sessions.create(f.scope);
  for (let offset = 0; offset < 600; offset += 50) {
    const items = Array.from({ length: 50 }, (_, index) => normalizeSyncMessage(f.scope, { ...sample(`identity-${offset + index}`), key: { id: `identity-${offset + index}`, remoteJid: `identity-${offset + index}@lid`, fromMe: false } })!);
    await f.journal.stage(f.scope, items, true, true);
  }
  assert.equal(f.vault.get(f.scope)?.sync?.historyIdentities?.length, 500);
  assert.equal(f.vault.get(f.scope)?.sync?.pending.length, 500);
  await f.journal.stage(f.scope, [normalizeSyncMessage(f.scope, sample("reserved-live"))!], false, false);
  assert.equal(f.vault.get(f.scope)?.sync?.pending.length, 501);
});
test("CP4 in-memory serial admission is bounded and recovers after draining", async () => {
  const serial = new Serial(); let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const accepted = Array.from({ length: 128 }, () => serial.run(() => gate));
  await assert.rejects(serial.run(async () => undefined), /SYNC_BACKPRESSURE/);
  release(); await Promise.all(accepted); await serial.run(async () => undefined);
});
test("CP4 bounded inline protocol history checkpoints only after durable staging and deduplicates downloads", async (t) => {
  const f = await fixture(t), ev = makeEventBuffer(pino({ level: "silent" }));
  let persisted = 0, release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const transport = await baileysFactory(f.vault, () => ({ ev, end: async () => undefined, logout: async () => undefined }), { enabled: true, historyEnabled: true, approvedScope: `${f.scope.organizationId}:${f.scope.connectionId}` })(f.scope, { connection: () => undefined, text: () => undefined, receipt: () => undefined, failure: () => assert.fail(), sync: async (items) => { if (items.length) { await gate; persisted += items.length; } } });
  const raw = proto.HistorySync.encode({ syncType: proto.HistorySync.HistorySyncType.RECENT, progress: 100, conversations: [{ id: "opaque@lid", messages: [{ message: sample("inline-history") }] }] }).finish();
  const notification = { key: { id: "protocol-history", remoteJid: "self@s.whatsapp.net", fromMe: true }, message: { protocolMessage: { historySyncNotification: { initialHistBootstrapInlinePayload: deflateSync(raw) } } } };
  ev.emit("messages.upsert", { type: "notify", messages: [{ ...notification, key: { ...notification.key, fromMe: false } }] });
  await new Promise((resolve) => setTimeout(resolve, 10)); assert.equal(f.vault.get(f.scope)?.historyImports, undefined);
  ev.emit("messages.upsert", { type: "notify", messages: [notification] });
  await new Promise((resolve) => setTimeout(resolve, 30)); assert.equal(f.vault.get(f.scope)?.historyImports?.seen.length, 0);
  release();
  const deadline = Date.now() + 3000; while (!f.vault.get(f.scope)?.historyImports?.seen.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(persisted >= 3); assert.equal(f.vault.get(f.scope)?.historyImports?.seen.length, 1);
  ev.emit("messages.upsert", { type: "notify", messages: [notification] });
  await new Promise((resolve) => setTimeout(resolve, 30)); assert.equal(f.vault.get(f.scope)?.historyImports?.downloads, 1);
  transport.close();
});
