import { ProviderMedia } from "../src/media.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { readFile, readdir, writeFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { proto, makeEventBuffer } from "baileys";
import pino from "pino";
import { fixture } from "./helpers.js";
import { Sessions } from "../src/sessions.js";
import { Vault } from "../src/vault.js";
import { EventJournal } from "../src/events.js";
import { baileysFactory } from "../src/baileys.js";
import { createHttp } from "../src/http.js";
import { signedHeaders } from "../../../contracts/provider-internal.js";
import { boundHistoryPage, selectHistory, type HistoryPage } from "../src/history-selection.js";
import { normalizeSyncMessage } from "../src/sync-normalization.js";
import { PrivateFiles } from "../src/private-files.js";
import { inspectMedia } from "../src/media.js";
const intent = () => ({ commandId: randomUUID(), messageId: randomUUID(), providerMessageId: randomUUID().replaceAll("-", "").toUpperCase(), destination: "5581999999999@s.whatsapp.net", body: "Synthetic only", expiresAt: new Date(Date.now() + 3600000).toISOString() });
test("B2 signed HTTP -> Sessions -> SDK send preserves ID; Vault restart never retransmits", async t => {
  const f = await fixture(t), ev = makeEventBuffer(pino({ level: "silent" })); let calls = 0, resolutions = 0;
  const options = { enabled: true, historyEnabled: false, outboundEnabled: true };
  const sessions = new Sessions(f.vault, f.journal, baileysFactory(f.vault, () => ({ ev, end: async () => undefined, logout: async () => undefined, onWhatsApp: async phone => { resolutions++; assert.equal(phone, "+5581999999999"); return [{ jid: "5581999999999@s.whatsapp.net", exists: true }]; }, sendMessage: async (jid, content, options) => { calls++; assert.equal(jid, "5581999999999@s.whatsapp.net"); assert.equal("text" in content && content.text, "*Ana*\n\nSynthetic only"); assert.equal(options?.messageId?.length, 32); return undefined; } }), options), true, () => () => undefined, Date.now, () => undefined, options);
  const app = createHttp(sessions, f.journal, f.auth); t.after(async () => { await sessions.shutdown(); await app.close(); });
  await sessions.create(f.scope); await sessions.command(f.scope, "connect", randomUUID()); ev.emit("connection.update", { connection: "open" }); await sessions.settle(f.scope);
  assert.equal(calls, 0); assert.equal(resolutions, 0);
  const resolve = { phone: "+5581999999999" }, resolvePath = f.path + "/recipients/resolve";
  assert.equal((await app.inject({ method: "POST", url: resolvePath, payload: resolve, headers: signedHeaders(f.internalKey, "POST", resolvePath, resolve) })).json().state, "VALID");
  const request = { ...intent(), body: "*Ana*\n\nSynthetic only" }, path = f.path + "/messages";
  const send = (body = request) => app.inject({ method: "POST", url: path, payload: body, headers: signedHeaders(f.internalKey, "POST", path, body) });
  assert.equal((await app.inject({ method: "POST", url: path, payload: request })).statusCode, 401);
  assert.equal((await send()).json().outcome, "DISPATCHED"); assert.equal((await send()).json().outcome, "DISPATCHED"); assert.equal(calls, 1);
  assert.equal((await send({ ...request, body: "changed" })).statusCode, 409); assert.equal(calls, 1);
  const restored = new Vault(f.vault.directory, f.key); await restored.initialize();
  const after = new Sessions(restored, new EventJournal(restored), f.factory, false); t.after(() => after.shutdown());
  assert.equal((await after.send(f.scope, request)).outcome, "DISPATCHED"); assert.equal(calls, 1);
  const otherPath = `/internal/v1/organizations/${f.other.organizationId}/connections/${f.other.connectionId}/messages`;
  assert.equal((await app.inject({ method: "POST", url: otherPath, payload: request, headers: signedHeaders(f.internalKey, "POST", otherPath, request) })).statusCode, 404); assert.equal(calls, 1);
});
test("B2 durable UNKNOWN survives restart; closed flags and invalid destinations block", async t => {
  const f = await fixture(t); let calls = 0;
  const sessions = new Sessions(f.vault, f.journal, async (_scope, cb) => { f.callbacks.push(cb); return { close() {}, logout: async () => undefined, send: async () => { calls++; throw new Error("private SDK error"); } }; }, true, () => () => undefined, Date.now, () => undefined, { enabled: false, historyEnabled: false, outboundEnabled: true }); t.after(() => sessions.shutdown());
  await sessions.create(f.scope); await sessions.command(f.scope, "connect", randomUUID()); f.callbacks[0]!.connection({ state: "open" }); await sessions.settle(f.scope);
  const request = intent(); assert.equal((await sessions.send(f.scope, request)).outcome, "UNKNOWN"); assert.equal((await sessions.send(f.scope, request)).outcome, "UNKNOWN"); assert.equal(calls, 1);
  const restored = new Vault(f.vault.directory, f.key); await restored.initialize(); const after = new Sessions(restored, new EventJournal(restored), f.factory, false); t.after(() => after.shutdown());
  assert.equal((await after.send(f.scope, request)).outcome, "UNKNOWN"); await assert.rejects(after.send(f.scope, intent()), /OUTBOUND_DISABLED/);
  await assert.rejects(sessions.send(f.scope, { ...intent(), destination: "group@g.us" })); assert.equal(calls, 1);
});

test("signed image/video captions and empty captions pass unchanged through the installed SDK adapter", async t => {
  const f = await fixture(t), ev = makeEventBuffer(pino({ level: "silent" }));
  const frames: { caption: string | undefined; id: string | undefined; bytes: Buffer }[] = [];
  const factory = baileysFactory(f.vault, () => ({ ev, end: async () => undefined, logout: async () => undefined, sendMessage: async (_jid, content, options) => {
    assert.ok("image" in content || "video" in content);
    const media = "image" in content ? content.image : content.video;
    assert.ok(typeof media === "object" && "stream" in media);
    const chunks: Buffer[] = []; for await (const chunk of media.stream) chunks.push(Buffer.from(chunk));
    frames.push({ caption: content.caption, id: options?.messageId, bytes: Buffer.concat(chunks) }); return undefined;
  } }), { enabled: false, historyEnabled: false, mediaEnabled: true });
  await f.sessions.create(f.scope);
  const transport = await factory(f.scope, { connection() {}, text() {}, receipt() {}, failure() {} }); t.after(() => transport.close());
  for (const type of ["IMAGE", "VIDEO"] as const) for (const body of ["*Ana*\n\nLegenda original\n😀", ""]) {
    const mediaId = randomUUID(), bytes = Buffer.from(`synthetic ${type}`), sha256 = createHash("sha256").update(bytes).digest("hex");
    const meta = { id: mediaId, type, mimeType: type === "IMAGE" ? "image/png" : "video/mp4", fileName: "synthetic", size: bytes.length, sha256, expiresAt: Date.now() + 3600000 };
    await f.vault.privateFiles().put(f.scope, mediaId, Readable.from([bytes]), meta);
    await f.vault.update(f.scope, record => { record.media ??= []; record.media.push(meta); });
    const request = { ...intent(), body, media: { mediaId, type, mimeType: meta.mimeType, fileName: meta.fileName, size: meta.size, sha256, state: "READY" as const } };
    await transport.send!(request); assert.equal(frames.at(-1)!.caption, body); assert.equal(frames.at(-1)!.id, request.providerMessageId); assert.deepEqual(frames.at(-1)!.bytes, bytes);
  }
  assert.equal(frames.length, 4);
});
test("B2 history above 500 conversations/1000 messages advances durable pages across restart without remote requests", async t => {
  const f = await fixture(t); await f.sessions.create(f.scope); const now = Date.now(), window = { from: new Date(now - 30 * 86400000).toISOString(), to: new Date(now).toISOString() }, digest = "a".repeat(64);
  const bytes = proto.HistorySync.encode({ syncType: proto.HistorySync.HistorySyncType.RECENT, conversations: Array.from({ length: 620 }, (_, i) => ({ id: `558100000${i}@s.whatsapp.net`, name: "Synthetic", messages: Array.from({ length: 2 }, (_, j) => ({ message: { key: { remoteJid: `558100000${i}@s.whatsapp.net`, id: `m-${i}-${j}`, fromMe: j === 1 }, messageTimestamp: Math.floor(now / 1000) - 3600, message: { conversation: "Synthetic" } } })) })) }).finish();
  await f.vault.update(f.scope, r => { r.historyImports = { downloads: 1, decodedBytes: bytes.length, seen: [], initialPending: true, pending: [{ digest, reference: "synthetic retained reference", cursor: 0 }] }; });
  let vault = f.vault, journal = f.journal, pages = 0; const messages = new Set<string>(), conversations = new Set<string>();
  for (;;) {
    const page: HistoryPage = { cursor: vault.get(f.scope)!.historyImports!.pending![0]!.cursor! };
    const decoded = proto.HistorySync.decode(boundHistoryPage(bytes, window, page));
    const items = selectHistory(f.scope, decoded, { id: randomUUID(), ...window, limits: { contacts: 500, conversations: 500, messages: 1000 }, anchors: [] });
    assert.ok(items.length <= 300); assert.ok(page.next! > page.cursor);
    await journal.stage(f.scope, items, true, true, false, 0, false, undefined, undefined, undefined, { digest, next: page.next! }); pages++;
    if (pages === 2) { vault = new Vault(f.vault.directory, f.key); await vault.initialize(); journal = new EventJournal(vault); }
    for (;;) { const deliveries = await journal.pull(f.scope, 20); if (!deliveries.length) break; for (const d of deliveries) { if (d.event.type === "sync.batch") for (const item of d.event.data.items) { if (item.kind === "message") messages.add(item.message.providerMessageId); if (item.kind === "conversation") conversations.add(item.identity.externalId); } await journal.ack(f.scope, d.event.eventId, d.leaseId); } }
    if (page.done) break;
  }
  assert.equal(messages.size, 1240); assert.equal(conversations.size, 620); assert.equal(vault.get(f.scope)?.historyOperation, undefined); assert.equal(f.stats().starts, 0); assert.equal(vault.get(f.scope)?.sync?.failures, 0);
});
test("B2 bootstrap backpressure rolls back page/checkpoint and preserves live reservation", async t => {
  const f = await fixture(t); await f.sessions.create(f.scope); const digest = "b".repeat(64);
  await f.vault.update(f.scope, r => { r.historyImports = { downloads: 1, decodedBytes: 0, seen: [], pending: [{ digest, reference: "synthetic", cursor: 0 }] }; });
  const item = normalizeSyncMessage(f.scope, { key: { id: "synthetic", remoteJid: "558100000000@s.whatsapp.net" }, messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: "x".repeat(8000) } })!;
  for (let i = 0; i < 3; i++) { try { await f.journal.stage(f.scope, Array.from({ length: 100 }, () => item), true, true, false, 0, false, undefined, undefined, undefined, { digest, next: i + 1 }); } catch { break; } }
  const previous = f.vault.get(f.scope)!;
  await assert.rejects(f.journal.stage(f.scope, Array.from({ length: 100 }, () => item), true, true, false, 0, false, undefined, undefined, undefined, { digest, next: 99 }), /SYNC_BACKPRESSURE/);
  assert.equal(f.vault.get(f.scope)!.historyImports!.pending![0]!.cursor, previous.historyImports!.pending![0]!.cursor); assert.equal(f.vault.get(f.scope)!.sync!.pending.length, previous.sync!.pending.length);
  await f.journal.stage(f.scope, [item], false, false); assert.equal(f.vault.get(f.scope)!.sync!.pending.length, previous.sync!.pending.length + 1);
});
test("B3 private encrypted cache validates scope/hash/bytes/MIME/tamper/TTL", async t => {
  const f = await fixture(t), directory = join(f.directory, "private-files"), files = new PrivateFiles(directory, f.key), id = randomUUID();
  const bytes = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("synthetic-test-only")]), meta = { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  await files.put(f.scope, id, Readable.from([bytes.subarray(0, 7), bytes.subarray(7)]), meta, prefix => inspectMedia(prefix, "image/png"));
  const chunks: Buffer[] = []; for await (const chunk of await files.stream(f.scope, id, meta)) chunks.push(chunk); assert.deepEqual(Buffer.concat(chunks), bytes);
  const path = join(directory, (await readdir(directory))[0]!); const encrypted = await readFile(path); assert.equal(encrypted.includes(Buffer.from("synthetic-test-only")), false);
  await assert.rejects(files.stream(f.other, id, meta));
  await assert.rejects(files.put(f.scope, randomUUID(), Readable.from([bytes]), { ...meta, sha256: "0".repeat(64) }), /INTEGRITY/);
  await assert.rejects(files.put(f.scope, randomUUID(), Readable.from([bytes]), { ...meta, size: 1 }), /SIZE/);
  await assert.rejects(files.put(f.scope, randomUUID(), Readable.from([bytes]), meta, prefix => inspectMedia(prefix, "video/mp4")), /TYPE/);
  encrypted[encrypted.length - 1] = encrypted[encrypted.length - 1]! ^ 1; await writeFile(path, encrypted); await assert.rejects(files.stream(f.scope, id, meta), /INTEGRITY/);
  await utimes(path, new Date(0), new Date(0)); assert.equal(await files.has(f.scope, id), false);
});

test("B4 an in-flight external send leaves live journal processing available and duplicate intent uncertain", async t => {
  const f = await fixture(t); let release!: () => void, calls = 0;
  const sessions = new Sessions(f.vault, f.journal, async (_scope, callbacks) => { f.callbacks.push(callbacks); return { close() {}, logout: async () => undefined, send: async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); } }; }, true, () => () => undefined, Date.now, () => undefined, { enabled: false, historyEnabled: false, outboundEnabled: true }); t.after(() => sessions.shutdown());
  await sessions.create(f.scope); await sessions.command(f.scope, "connect", randomUUID()); f.callbacks[0]!.connection({ state: "open" }); await sessions.settle(f.scope);
  const request = intent(), inflight = sessions.send(f.scope, request);
  for (let i = 0; i < 100 && !release; i++) await new Promise(resolve => setTimeout(resolve, 5)); assert.ok(release);
  f.callbacks[0]!.text({ id: "synthetic-live-during-send", chatId: "5581999999999@s.whatsapp.net", body: "synthetic", fromMe: false, timestamp: Date.now() }); await sessions.settle(f.scope);
  const events = await f.journal.pull(f.scope, 20); assert.ok(events.some(x => x.event.type === "message.received")); assert.equal(calls, 1);
  assert.equal((await sessions.send(f.scope, request)).outcome, "UNKNOWN"); release(); assert.equal((await inflight).outcome, "DISPATCHED"); assert.equal(calls, 1);
});

test("B3 voice MIME parameters are normalized without exposing download keys", async t => {
  const f = await fixture(t);
  const item = normalizeSyncMessage(f.scope, { key: { id: "synthetic-voice", remoteJid: "5581999999999@s.whatsapp.net" }, messageTimestamp: Math.floor(Date.now() / 1000), message: { audioMessage: { ptt: true, mimetype: "audio/ogg; codecs=opus", fileLength: 12, mediaKey: Buffer.alloc(32, 1), directPath: "/synthetic-private" } } });
  assert.ok(item?.kind === "message" && item.message.content.type === "VOICE");
  assert.equal(item.message.content.media.mimeType, "audio/ogg"); assert.doesNotMatch(JSON.stringify(item), /mediaKey|directPath|synthetic-private/);
});

test("B3 an authenticated media echo binds its private reference to the original upload handle", async t => {
  const f = await fixture(t); const id = randomUUID(), providerMessageId = "A".repeat(32), sha256 = "b".repeat(64);
  await f.vault.update(f.scope, record => { record.media = [{ id, type: "IMAGE", mimeType: "image/png", fileName: "synthetic.png", size: 12, sha256, expiresAt: Date.now() + 3600000 }]; record.sends = [{ id: randomUUID(), digest: "c".repeat(64), providerMessageId, mediaId: id, outcome: "DISPATCHED", expiresAt: new Date(Date.now() + 3600000).toISOString() }]; });
  const media = new ProviderMedia(f.vault, false);
  await media.retain(f.scope, { key: { id: providerMessageId, remoteJid: "5581999999999@s.whatsapp.net", fromMe: true }, messageTimestamp: Math.floor(Date.now() / 1000), message: { imageMessage: { mimetype: "image/png", fileLength: 12, fileSha256: Buffer.from(sha256, "hex"), mediaKey: Buffer.alloc(32, 1), directPath: "/synthetic-private-reference" } } });
  const retained = f.vault.get(f.scope)!.media!.find(x => x.id === id)!; assert.ok(retained.reference); assert.ok(retained.expiresAt > Date.now() + 24 * 3600000); assert.equal(f.stats().starts, 0);
});

for (const mode of ["ACK", "NO_ACK", "FAIL"] as const) test(`P0 Baileys unlink ${mode} reports only a correlated response as remote confirmation`, async t => {
 const f = await fixture(t), ev = makeEventBuffer(pino({ level: "silent" })); let queries = 0, sdkLogout = 0;
 await f.vault.update(f.scope, r => { r.auth = JSON.stringify({ me: { id: "synthetic@lid" } }); });
 const factory = baileysFactory(f.vault, () => ({ ev, end: async () => undefined, logout: async () => { sdkLogout++; }, ...(mode === "NO_ACK" ? {} : { query: async node => { queries++; assert.equal(node.attrs.xmlns, "md"); assert.ok(Array.isArray(node.content) && node.content[0]?.tag === "remove-companion-device"); if (mode === "FAIL") throw new Error("synthetic remote failure"); return { tag: "iq", attrs: { type: "result" } }; } }) }));
 const transport = await factory(f.scope, { connection() {}, text() {}, receipt() {}, failure() {} }); t.after(() => transport.close());
 if (mode === "FAIL") await assert.rejects(transport.logout()); else assert.equal(await transport.logout(), mode === "ACK" ? "CONFIRMED" : "UNCONFIRMED");
 assert.equal(queries, mode === "NO_ACK" ? 0 : 1); assert.equal(sdkLogout, mode === "NO_ACK" ? 1 : 0); assert.ok(f.vault.get(f.scope)?.auth);
});

test("media global transfer guard serializes instances and releases after a failed stream", async t => {
 const f = await fixture(t); await f.sessions.create(f.scope); const first = new ProviderMedia(f.vault, true), second = new ProviderMedia(f.vault, true), bytes = Buffer.from("89504e470d0a1a0a", "hex");
 const meta = () => ({ mediaId: randomUUID(), type: "IMAGE" as const, mimeType: "image/png" as const, fileName: "synthetic.png", size: bytes.length, sha256: "0".repeat(64) });
 let release!: () => void, entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }), proceed = new Promise<void>(resolve => { release = resolve; });
 const streaming = first.upload(f.scope, meta(), (async function* () { entered(); await proceed; yield bytes; })()); await started;
 await assert.rejects(second.upload(f.scope, meta(), Readable.from([bytes])), /MEDIA_BUSY/); release(); await assert.rejects(streaming, /MEDIA_INTEGRITY_FAILED/);
 await assert.rejects(second.upload(f.scope, meta(), Readable.from([bytes])), /MEDIA_INTEGRITY_FAILED/); assert.ok(!(await readdir(join(f.vault.directory, "files"))).some(x => x.endsWith(".part")));
});

test("media memory backpressure remains enforced with a distinct diagnostic", async t => {
 const f = await fixture(t), files = f.vault.privateFiles(), meta = { size: 1, sha256: createHash("sha256").update("x").digest("hex") };
 const original = process.memoryUsage(); t.mock.method(process, "memoryUsage", () => ({ ...original, rss: 384 * 1024 * 1024 }));
 await assert.rejects(files.put(f.scope, randomUUID(), Readable.from([Buffer.from("x")]), meta), /MEDIA_MEMORY_PRESSURE/);
 t.mock.restoreAll(); const id = randomUUID(); await files.put(f.scope, id, Readable.from([Buffer.from("x")]), meta); assert.equal(await files.has(f.scope, id), true);
});
