import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { makeEventBuffer, proto } from "baileys";
import pino from "pino";
import { fixture } from "./helpers.js";
import { Sessions } from "../src/sessions.js";
import { baileysFactory } from "../src/baileys.js";
import { Vault } from "../src/vault.js";
import { historySpecSchema } from "../../../contracts/history.js";

test("B1 RECENT100 ends bootstrap without losing recent append through Sessions and durable journal", async (t) => {
  const f = await fixture(t), ev = makeEventBuffer(pino({ level: "silent" }));
  const options = { enabled: true, historyEnabled: false, initialHistoryEnabled: true };
  const sessions = new Sessions(f.vault, f.journal, baileysFactory(f.vault, () => ({ ev, end: async () => undefined, logout: async () => undefined }), options), true, () => () => undefined, Date.now, () => undefined, options);
  t.after(() => sessions.shutdown());
  await sessions.create(f.scope); await sessions.command(f.scope, "connect", randomUUID());
  const history = deflateSync(proto.HistorySync.encode({ syncType: proto.HistorySync.HistorySyncType.RECENT, progress: 100, conversations: [] }).finish());
  ev.emit("messages.upsert", { type: "notify", messages: [{ key: { id: "bootstrap", remoteJid: "self@s.whatsapp.net", fromMe: true }, message: { protocolMessage: { historySyncNotification: { syncType: proto.HistorySync.HistorySyncType.RECENT, progress: 100, initialHistBootstrapInlinePayload: history } } } }] });
  for (let i = 0; i < 300 && !f.vault.get(f.scope)?.historyImports?.seen.length; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(f.vault.get(f.scope)?.historyImports?.initialPending, false);
  const sample = (id: string, age = 0) => ({ key: { id, remoteJid: "synthetic@lid", fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000) - age, message: { conversation: "synthetic" } });
  ev.emit("messages.upsert", { type: "append", messages: [sample("append"), sample("old", 3600)] });
  ev.emit("messages.upsert", { type: "notify", messages: [sample("notify")] });
  await sessions.settle(f.scope);
  const deliveries = await f.journal.pull(f.scope, 20);
  const messages = deliveries.flatMap((d) => d.event.type === "sync.batch" ? d.event.data.items.filter((x) => x.kind === "message") : []);
  assert.deepEqual(messages.map((m) => m.message.providerMessageId).sort(), ["append", "notify"]);
  assert.ok(deliveries.filter((d) => d.event.type === "sync.batch").every((d) => d.event.type === "sync.batch" && !d.event.data.historical));
});

test("B1 legacy authenticated Vault attempts5 recovers, preserves Signal/auth and resets only failure episode after stable open", async (t) => {
  const f = await fixture(t), auth = JSON.stringify({ registered: false, me: { id: "linked@lid" } });
  await f.vault.update(f.scope, (r) => { r.auth = auth; r.keys = { synthetic: "unchanged" }; r.desired = true; r.state = "CONNECTED"; r.attempts = 5; r.qrRevision = 3; });
  const restored = new Vault(f.vault.directory, f.key); await restored.initialize();
  const timers: { run: () => void; delay: number; cancelled: boolean }[] = [];
  const sessions = new Sessions(restored, f.journal, f.factory, true, (run, delay) => { const timer = { run, delay, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; }, f.now, () => undefined, { enabled: false, historyEnabled: false, linkedRecoveryOnly: true });
  t.after(() => sessions.shutdown());
  await sessions.recover(); assert.equal(f.stats().starts, 1);
  assert.equal(restored.get(f.scope)?.attempts, 6); assert.equal(restored.get(f.scope)?.recoveryFailures, 1);
  await f.callbacks[0]!.connection({ state: "open" }); await sessions.settle(f.scope);
  assert.equal(sessions.view(f.scope).state, "CONNECTED");
  assert.equal(restored.get(f.scope)?.recoveryFailures, 1);
  f.advance(30000); timers.find((x) => x.delay === 30000 && !x.cancelled)!.run(); await sessions.settle(f.scope);
  assert.equal(restored.get(f.scope)?.recoveryFailures, 0);
  assert.equal(restored.get(f.scope)?.auth, auth); assert.deepEqual(restored.get(f.scope)?.keys, { synthetic: "unchanged" });
  assert.equal(restored.get(f.scope)?.qrRevision, 3); assert.equal(f.stats().logouts, 0);
});

test("B1 legacy exhausted failure budget and terminal revocation never regain retries on restart", async (t) => {
  const f = await fixture(t); const auth = JSON.stringify({ me: { id: "linked@lid" } });
  await f.vault.update(f.scope, (r) => { r.auth = auth; r.desired = true; r.state = "FAILED"; r.attempts = 5; r.errorCode = "RECONNECT_LIMIT"; });
  const sessions = new Sessions(f.vault, f.journal, f.factory, true, () => () => undefined, f.now, () => undefined, { enabled: false, historyEnabled: false, linkedRecoveryOnly: true });
  t.after(() => sessions.shutdown());
  await sessions.recover(); assert.equal(f.stats().starts, 0); assert.equal(sessions.view(f.scope).errorCode, "RECONNECT_LIMIT");
  await f.vault.update(f.scope, (r) => { r.errorCode = "SESSION_REVOKED"; r.recoveryFailures = 0; });
  await sessions.recover(); assert.equal(f.stats().starts, 0); assert.equal(sessions.view(f.scope).errorCode, "SESSION_REVOKED");
  assert.equal(f.vault.get(f.scope)?.auth, auth);
});

test("B1 history window validation remains strict at the thirty-day boundary", () => {
  const now = Date.now(), spec = { id: randomUUID(), from: new Date(now - 30 * 86400000).toISOString(), to: new Date(now).toISOString(), limits: { contacts: 500, conversations: 500, messages: 20 }, anchors: [] };
  assert.equal(historySpecSchema.safeParse(spec).success, true);
  assert.equal(historySpecSchema.safeParse({ ...spec, to: new Date(now + 1).toISOString() }).success, false);
});
