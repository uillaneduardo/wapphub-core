import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { makeEventBuffer, proto } from "baileys";
import pino from "pino";
import { baileysFactory } from "../src/baileys.js";
import { fixture } from "./helpers.js";

test("exact RC14 is locked and the actual SDK adapter disables logging and history", async (t) => {
  const f = await fixture(t);
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  assert.equal(manifest.dependencies.baileys, "7.0.0-rc14"); assert.equal(lock.packages["node_modules/baileys"].version, "7.0.0-rc14");
  assert.match(lock.packages["node_modules/baileys"].resolved, /^https:\/\/registry.npmjs.org\//);
  const ev = makeEventBuffer(pino({ level: "silent" }));
  const text: unknown[] = [], receipts: unknown[] = [], connection: unknown[] = [];
  const factory = baileysFactory(f.vault, (options) => {
    assert.equal(options.logger?.level, "silent"); assert.equal(options.syncFullHistory, false); assert.equal(options.markOnlineOnConnect, false);
    assert.equal(options.shouldSyncHistoryMessage?.({}), false); assert.equal(options.shouldIgnoreJid?.("status@broadcast"), true);
    assert.equal(options.shouldIgnoreJid?.("test@g.us"), true); assert.equal(options.shouldIgnoreJid?.("test@s.whatsapp.net"), false);
    return { ev, end: async () => undefined, logout: async () => undefined };
  });
  const transport = await factory(f.scope, { connection: (value) => connection.push(value), text: (value) => text.push(value), receipt: (id, status) => receipts.push({ id, status }), failure: () => assert.fail("unexpected persistence failure") });
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
