import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { makeEventBuffer, proto } from "baileys";
import pino from "pino";
import { baileysFactory } from "../src/baileys.js";
import { fixture } from "./helpers.js";

test("exact RC14 is locked and the actual SDK adapter suppresses raw logging and automatic history", async (t) => {
  const f = await fixture(t);
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  assert.equal(manifest.dependencies.baileys, "7.0.0-rc14"); assert.equal(lock.packages["node_modules/baileys"].version, "7.0.0-rc14");
  assert.match(lock.packages["node_modules/baileys"].resolved, /^https:\/\/registry.npmjs.org\//);
  const ev = makeEventBuffer(pino({ level: "silent" }));
  const text: unknown[] = [], receipts: unknown[] = [], connection: unknown[] = [];
  const diagnostics: string[] = [];
  const factory = baileysFactory(f.vault, (options) => {
    assert.equal(options.logger?.level, "info"); assert.equal(options.syncFullHistory, false); assert.equal(options.markOnlineOnConnect, false);
    const privateObject = { get secret() { return assert.fail("raw SDK fields must never be inspected or serialized"); } };
    options.logger!.info(privateObject, "not logged in, attempting registration...");
    options.logger!.child({ privateBinding: "must never reach log sink" }).error(privateObject, "unexpected private error");
    assert.equal(options.shouldSyncHistoryMessage?.({}), false); assert.equal(options.shouldIgnoreJid?.("status@broadcast"), true);
    assert.equal(options.shouldIgnoreJid?.("test@g.us"), true); assert.equal(options.shouldIgnoreJid?.("test@s.whatsapp.net"), false);
    return { ev, end: async () => undefined, logout: async () => undefined };
  });
  const transport = await factory(f.scope, { diagnostic: code => diagnostics.push(code), connection: (value) => connection.push(value), text: (value) => text.push(value), receipt: (id, status) => receipts.push({ id, status }), failure: () => assert.fail("unexpected persistence failure") });
  assert.deepEqual(diagnostics, ["AUTH_READY", "REGISTRATION_READY", "SOCKET_CREATED"]);
  const message = { key: { id: "synthetic", remoteJid: "test@s.whatsapp.net", fromMe: false }, messageTimestamp: 1_700_000_000, message: { conversation: "  teste\n😀  " } };
  ev.emit("messages.upsert", { type: "notify", messages: [message] });
  ev.emit("messages.upsert", { type: "append", messages: [message] });
  ev.emit("messages.upsert", { type: "notify", requestId: "spoof", messages: [message] });
  ev.emit("messages.upsert", { type: "notify", messages: [{ ...message, key: { ...message.key, remoteJid: "test@g.us" } }, { ...message, message: { conversation: "x".repeat(8001) } }, { ...message, messageTimestamp: 1e50 }, { ...message, message: { imageMessage: {} } }] });
  assert.equal(text.length, 1); assert.deepEqual(text[0], { id: "synthetic", chatId: "test@s.whatsapp.net", fromMe: false, body: message.message.conversation, timestamp: 1_700_000_000_000 });
  ev.emit("messages.update", [{ key: { id: "sent", fromMe: true }, update: { status: proto.WebMessageInfo.Status.READ } }]);
  assert.deepEqual(receipts, [{ id: "sent", status: "READ" }]);
  ev.emit("connection.update", { qr: "TEST_QR" }); assert.equal(connection.length, 1);
  transport.close();
});
test("linked-only SDK factory never initializes new credentials without an authenticated identity", async (t) => {
 const f = await fixture(t); let starts = 0;
 const factory = baileysFactory(f.vault, () => { starts++; throw new Error("must not start"); }, { enabled: false, historyEnabled: false, linkedRecoveryOnly: true });
 await assert.rejects(factory(f.scope, { connection: () => undefined, text: () => undefined, receipt: () => undefined, failure: () => undefined }), /EXISTING_AUTH_REQUIRED/);
 assert.equal(starts, 0); assert.equal(f.vault.get(f.scope)?.auth, undefined);
});
test("linked-only SDK refuses credential revocation updates without overwriting persisted auth", async (t) => {
 const f = await fixture(t); const { encryptedAuth } = await import("../src/baileys.js");
 const initial = await encryptedAuth(f.vault, f.scope); initial.state.creds.me = { id: "synthetic@lid" }; await initial.saveCreds(); initial.disable();
 const before = f.vault.get(f.scope)!.auth; const ev = makeEventBuffer(pino({ level: "silent" })); const updates: unknown[] = [];
 const factory = baileysFactory(f.vault, () => ({ ev, end: async () => undefined, logout: async () => assert.fail("no logout") }), { enabled: false, historyEnabled: false, linkedRecoveryOnly: true });
 const transport = await factory(f.scope, { connection: (x) => updates.push(x), text: () => undefined, receipt: () => undefined, failure: () => assert.fail("unexpected failure") });
 ev.emit("creds.update", { me: undefined }); await f.vault.flush();
 assert.deepEqual(updates, [{ state: "close", code: 401 }]); assert.equal(f.vault.get(f.scope)?.auth, before); transport.close();
});

test("QR-linked SDK recovery accepts registered false and preserves the authenticated identity", async (t) => {
 const f = await fixture(t); const { encryptedAuth } = await import("../src/baileys.js");
 const initial = await encryptedAuth(f.vault, f.scope); assert.equal(initial.state.creds.registered, false);
 initial.state.creds.me = { id: "synthetic@lid" }; await initial.saveCreds(); initial.disable();
 const ev = makeEventBuffer(pino({ level: "silent" }));
 const factory = baileysFactory(f.vault, (options) => {
   assert.equal(options.auth?.creds.me?.id, "synthetic@lid"); assert.equal(options.auth?.creds.registered, false);
   return { ev, end: async () => undefined, logout: async () => assert.fail("no logout") };
 }, { enabled: false, historyEnabled: false, linkedRecoveryOnly: true });
 const transport = await factory(f.scope, { connection: () => assert.fail("no identity rejection"), text: () => undefined, receipt: () => undefined, failure: () => assert.fail("unexpected failure") });
 ev.emit("creds.update", { registered: false }); await new Promise((resolve) => setImmediate(resolve)); await f.vault.flush();
 assert.equal(JSON.parse(f.vault.get(f.scope)!.auth!).me.id, "synthetic@lid"); assert.equal(JSON.parse(f.vault.get(f.scope)!.auth!).registered, false); transport.close();
});

test("scoped initial pairing under linked-only guard accepts new identity without enabling pairing for other sessions", async t => {
 const f = await fixture(t); await f.sessions.create(f.scope); const ev = makeEventBuffer(pino({ level: 'silent' })), updates: unknown[] = []; let starts = 0;
 const factory = baileysFactory(f.vault, () => { starts++; return { ev, end: async () => undefined, logout: async () => assert.fail('no remote logout') }; }, { enabled: false, historyEnabled: false, linkedRecoveryOnly: true });
 await f.vault.update(f.scope, r => { r.pairingAuthorization = { commandId: "synthetic", expiresAt: Date.now() + 120000 }; });
 const transport = await factory(f.scope, { connection: value => updates.push(value), text: () => undefined, receipt: () => undefined, failure: () => assert.fail('persistence failure') }, { allowPairing: true });
 ev.emit('creds.update', { me: { id: 'synthetic-new@lid' } }); await new Promise(resolve => setImmediate(resolve)); await f.vault.flush(); assert.equal(JSON.parse(f.vault.get(f.scope)!.auth!).me.id, 'synthetic-new@lid'); assert.equal(updates.length, 0); assert.equal(starts, 1); const linked = f.vault.get(f.scope)!.auth; await f.vault.update(f.scope, r => { delete r.pairingAuthorization; }); ev.emit('creds.update', { me: undefined }); await new Promise(resolve => setImmediate(resolve)); await f.vault.flush(); assert.deepEqual(updates, [{ state: 'close', code: 401 }]); assert.equal(f.vault.get(f.scope)!.auth, linked); transport.close();
});
