import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Sessions } from "../src/sessions.js";
import { EventJournal } from "../src/events.js";
import { Vault } from "../src/vault.js";
import { fixture } from "./helpers.js";

test("creation is idle, scoped, and never connects accounts on startup", async (t) => {
  const f = await fixture(t, false); await f.sessions.create(f.scope); await f.sessions.recover();
  assert.equal(f.stats().starts, 0); assert.equal(f.sessions.view(f.scope).state, "DISCONNECTED");
  assert.throws(() => f.sessions.view(f.other), /SESSION_NOT_FOUND/);
  await assert.rejects(f.sessions.command(f.scope, "connect", randomUUID()), /CONNECTIONS_DISABLED/);
});
test("session diagnostics reuse one defensive snapshot of a populated vault", async t => {
 const f = await fixture(t);
 await f.vault.update(f.scope, record => {
  record.auth = JSON.stringify({ me: { id: "synthetic@lid" }, noiseKey: { private: "synthetic", public: "synthetic" }, signedIdentityKey: { private: "synthetic", public: "synthetic" } });
  record.state = "FAILED"; record.errorCode = "RECONNECT_LIMIT"; record.desired = true;
  record.keys = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [String(i), "synthetic-key-state"]));
  record.retiredSessions = [{ commandId: randomUUID(), retiredAt: new Date().toISOString(), proof: "REMOTE_CONFIRMED", auth: "SYNTHETIC_RETIRED_AUTH", keys: { archived: "synthetic-key" } }];
 });
 const get = f.vault.get.bind(f.vault), snapshot = f.vault.viewSnapshot.bind(f.vault); let reads = 0, fullReads = 0;
 f.vault.get = scope => { fullReads++; return get(scope); };
 f.vault.viewSnapshot = scope => { reads++; return snapshot(scope); };
 const view = f.sessions.view(f.scope);
 assert.equal(reads, 1);
 assert.equal(fullReads, 0);
 assert.equal(view.state, "FAILED"); assert.equal(view.sync.lifecycle.linked, true);
 assert.equal(view.sync.lifecycle.recoveryEligible, true); assert.equal(view.sync.lifecycle.pairingEligible, false);
 view.sync.lifecycle.desired = false;
 assert.equal(get(f.scope)?.desired, true);
 assert.equal(Object.keys(get(f.scope)!.keys).length, 2000);
 assert.equal(get(f.scope)?.retiredSessions?.[0]?.auth, "SYNTHETIC_RETIRED_AUTH");
 assert.deepEqual(snapshot(f.scope)?.keys, {});
 assert.equal(snapshot(f.scope)?.retiredSessions?.[0]?.auth, undefined);
 assert.throws(() => f.sessions.view(f.other), /SESSION_NOT_FOUND/);
});
test("concurrent connects and repeated command IDs start a single socket", async (t) => {
  const f = await fixture(t); await f.sessions.create(f.scope); const id = randomUUID();
  await Promise.all(Array.from({ length: 10 }, () => f.sessions.command(f.scope, "connect", id)));
  assert.equal(f.stats().starts, 1);
  await assert.rejects(f.sessions.command(f.scope, "logout", id), /IDEMPOTENCY_CONFLICT/);
});
test("QR rotates, expires, stays outside events/logs, and clears on open", async (t) => {
  const f = await fixture(t); await f.sessions.create(f.scope); await f.sessions.command(f.scope, "connect", randomUUID());
  f.callbacks[0]!.connection({ qr: "SENSITIVE_QR_ONE" }); await f.sessions.settle(f.scope);
  assert.equal(f.sessions.qr(f.scope).revision, 1); assert.equal(f.sessions.view(f.scope).state, "QR_REQUIRED");
  assert.equal(JSON.stringify(f.vault.get(f.scope)?.events).includes("SENSITIVE_QR_ONE"), false);
  assert.equal(f.logs.includes("SENSITIVE_QR_ONE"), false);
  f.advance(20_001); assert.throws(() => f.sessions.qr(f.scope), /QR_NOT_AVAILABLE/);
  f.callbacks[0]!.connection({ qr: "SENSITIVE_QR_TWO" }); await f.sessions.settle(f.scope);
  assert.equal(f.sessions.qr(f.scope).revision, 2);
  f.callbacks[0]!.connection({ state: "open" }); await f.sessions.settle(f.scope);
  assert.equal(f.sessions.view(f.scope).state, "CONNECTED"); assert.throws(() => f.sessions.qr(f.scope));
});
test("late updates from an old socket cannot replace the current session", async (t) => {
  const f = await fixture(t); await f.sessions.create(f.scope); await f.sessions.command(f.scope, "connect", randomUUID());
  await f.sessions.command(f.scope, "disconnect", randomUUID()); await f.sessions.command(f.scope, "connect", randomUUID());
  f.callbacks[0]!.connection({ qr: "STALE_QR" }); f.callbacks[0]!.connection({ state: "open" });
  await f.sessions.settle(f.scope); assert.equal(f.sessions.view(f.scope).state, "CONNECTING");
  f.callbacks[1]!.connection({ state: "open" }); await f.sessions.settle(f.scope); assert.equal(f.sessions.view(f.scope).state, "CONNECTED");
});
for (const code of [401, 403, 411, 440, 500]) test(`disconnect ${code} stops reconnection`, async (t) => {
  const f = await fixture(t); await f.vault.update(f.scope, r => { r.auth = JSON.stringify({me:{id:"synthetic@lid"},noiseKey:{private:"synthetic",public:"synthetic"},signedIdentityKey:{private:"synthetic",public:"synthetic"}}); }); await f.sessions.create(f.scope); await f.sessions.command(f.scope, "connect", randomUUID());
  f.callbacks[0]!.connection({ state: "close", code }); await f.sessions.settle(f.scope);
  assert.equal(f.vault.get(f.scope)?.desired, false); assert.equal(f.stats().starts, 1);
  assert.equal(f.timers.filter((timer) => !timer.canceled).length, 0);
  assert.equal(f.sessions.view(f.scope).state, code === 401 ? "LOGGED_OUT" : "FAILED");
});
test("transient failures reconnect with exponential backoff and stop after five attempts", async (t) => {
  const f = await fixture(t); await f.vault.update(f.scope, r => { r.auth = JSON.stringify({me:{id:"synthetic@lid"},noiseKey:{private:"synthetic",public:"synthetic"},signedIdentityKey:{private:"synthetic",public:"synthetic"}}); }); await f.sessions.create(f.scope); await f.sessions.command(f.scope, "connect", randomUUID());
  for (let attempt = 1; attempt <= 5; attempt++) {
    f.callbacks[attempt - 1]!.connection({ state: "close", code: 503 }); await f.sessions.settle(f.scope);
    const timer = f.timers.find((item) => !item.canceled);
    if (attempt < 5) {
      assert.ok(timer); assert.ok(timer.delay >= 1000 * 2 ** (attempt - 1)); assert.ok(timer.delay < 1000 * 2 ** (attempt - 1) + 250);
      timer.canceled = true; timer.run(); await f.sessions.settle(f.scope);
    } else assert.equal(timer, undefined);
  }
  assert.equal(f.stats().starts, 5); assert.equal(f.sessions.view(f.scope).errorCode, "RECONNECT_LIMIT");
});
test("pairing deadline terminates an abandoned QR session", async (t) => {
  const f = await fixture(t); await f.sessions.create(f.scope); await f.sessions.command(f.scope, "connect", randomUUID());
  f.callbacks[0]!.connection({qr:"SYNTHETIC_ABANDONED_QR"}); await f.sessions.settle(f.scope);
  f.timers.find(timer => !timer.canceled)!.run(); await f.sessions.settle(f.scope);
  assert.equal(f.sessions.view(f.scope).errorCode, "PAIRING_TIMEOUT"); assert.equal(f.vault.get(f.scope)?.desired, false);
});
test("logout without a remote acknowledgement preserves credentials and is idempotent", async (t) => {
  const f = await fixture(t); await f.sessions.create(f.scope); await f.vault.update(f.scope, (record) => { record.auth = "TEST_AUTH"; });
  await f.sessions.command(f.scope, "connect", randomUUID()); const id = randomUUID();
  await f.sessions.command(f.scope, "logout", id); await f.sessions.command(f.scope, "logout", id);
  assert.equal(f.stats().logouts, 1); assert.equal(f.vault.get(f.scope)?.auth, "TEST_AUTH"); assert.equal(f.sessions.view(f.scope).state, "DISCONNECTED"); assert.equal(f.vault.get(f.scope)?.termination?.remote, "UNCONFIRMED");
});
test("restart restores desired sessions and retains retry budget", async (t) => {
  const f = await fixture(t); await f.vault.update(f.scope, r => { r.auth = JSON.stringify({me:{id:"synthetic@lid"},noiseKey:{private:"synthetic",public:"synthetic"},signedIdentityKey:{private:"synthetic",public:"synthetic"}}); }); await f.sessions.create(f.scope); await f.sessions.command(f.scope, "connect", randomUUID());
  await f.sessions.shutdown(); const restored = new Vault(f.vault.directory, f.key); await restored.initialize();
  const journal = new EventJournal(restored), sessions = new Sessions(restored, journal, f.factory, true);
  t.after(() => sessions.shutdown()); await sessions.recover();
  assert.equal(f.stats().starts, 2); assert.equal(sessions.view(f.scope).attempts, 2);
  const disabled = new Sessions(restored, journal, f.factory, false); t.after(() => disabled.shutdown());
  await disabled.recover(); assert.equal(f.stats().starts, 2);
});
test("text, device authorship and receipts normalize and deduplicate without domain writes", async (t) => {
  const f = await fixture(t); await f.sessions.create(f.scope); await f.sessions.command(f.scope, "connect", randomUUID());
  const incoming = { id: "synthetic-id", chatId: "synthetic@s.whatsapp.net", body: "  Olá\n😀  ", fromMe: false, timestamp: Date.now() };
  f.callbacks[0]!.text(incoming); f.callbacks[0]!.text(incoming);
  f.callbacks[0]!.text({ ...incoming, id: "device-id", fromMe: true });
  f.callbacks[0]!.receipt("device-id", "DELIVERED"); f.callbacks[0]!.receipt("device-id", "READ");
  await f.sessions.settle(f.scope); const events = f.vault.get(f.scope)!.events.map((item) => item.event);
  const received = events.filter((event) => event.type === "message.received"); assert.equal(received.length, 1);
  assert.equal(received[0]!.data.content.originalBody, incoming.body);
  const sent = events.find((event) => event.type === "message.sent"); assert.equal(sent?.data.sender.origin, "DEVICE");
  assert.equal(events.filter((event) => event.type === "message.updated").length, 2);
});
test("event queue exhaustion stops the socket while leaving durable backlog drainable", async (t) => {
  const f = await fixture(t); await f.sessions.create(f.scope); await f.sessions.command(f.scope, "connect", randomUUID());
  await f.vault.update(f.scope, (record) => { record.events = Array.from({ length: 512 }, () => structuredClone(record.events[0]!)); });
  await f.callbacks[0]!.connection({ state: "open" }); await f.sessions.settle(f.scope);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.sessions.ready(), true); assert.equal(f.sessions.metrics().active, 0);
  assert.equal(f.sessions.view(f.scope).state, "FAILED"); assert.equal(f.sessions.view(f.scope).errorCode, "EVENT_QUEUE_FULL");
  assert.equal(f.vault.get(f.scope)?.processingFailure?.code, "EVENT_QUEUE_FULL");
  assert.equal((await f.journal.pull(f.scope, 1)).length, 1);
});
test("explicit refresh rotates an expired QR without replaying old sockets or disconnecting linked sessions", async (t) => {
  const f = await fixture(t); await f.sessions.create(f.scope); await f.sessions.command(f.scope, "connect", randomUUID());
  f.callbacks[0]!.connection({ qr: "SYNTHETIC_OLD_QR" }); await f.sessions.settle(f.scope); f.advance(20_001);
  const id = randomUUID(); await f.sessions.command(f.scope, "refresh", id); await f.sessions.command(f.scope, "refresh", id);
  assert.equal(f.stats().starts, 2); assert.equal(f.sessions.view(f.scope).state, "CONNECTING");
  f.callbacks[0]!.connection({ state: "open" }); f.callbacks[1]!.connection({ qr: "SYNTHETIC_NEW_QR" }); await f.sessions.settle(f.scope);
  assert.equal(f.sessions.view(f.scope).qrRevision, 2); assert.equal(f.sessions.qr(f.scope).revision, 2);
  f.callbacks[1]!.connection({ state: "open" }); await f.sessions.settle(f.scope);
  await assert.rejects(f.sessions.command(f.scope, "refresh", randomUUID()), /INVALID_SESSION_STATE/);
  assert.equal(f.sessions.view(f.scope).state, "CONNECTED"); assert.equal(f.stats().starts, 2);
});
test("CP4 authentication clears QR and cannot be interrupted by a refresh command", async (t) => {
  const f = await fixture(t); await f.sessions.create(f.scope); await f.sessions.command(f.scope, "connect", randomUUID());
  f.callbacks[0]!.connection({ qr: "SYNTHETIC_QR" }); await f.sessions.settle(f.scope);
  f.callbacks[0]!.connection({ authenticating: true }); await f.sessions.settle(f.scope);
  assert.equal(f.sessions.view(f.scope).pairingPhase, "AUTHENTICATING"); assert.throws(() => f.sessions.qr(f.scope), /QR_NOT_AVAILABLE/);
  await assert.rejects(f.sessions.command(f.scope, "refresh", randomUUID()), /INVALID_SESSION_STATE/);
  f.callbacks[0]!.connection({ state: "open" }); await f.sessions.settle(f.scope); assert.equal(f.sessions.view(f.scope).state, "CONNECTED");
});

test("processing faults retain sanitized evidence and credentials, stale failures cannot close a replacement socket", async (t) => {
 const f = await fixture(t); await f.sessions.create(f.scope); await f.vault.update(f.scope, (r) => { r.auth = "SYNTHETIC_AUTH"; r.keys = { "synthetic": "SECRET" }; });
 await f.sessions.command(f.scope, "connect", randomUUID());
 await f.callbacks[0]!.failure(); await f.sessions.settle(f.scope);
 assert.equal(f.sessions.ready(), false); assert.equal(f.sessions.view(f.scope).state, "FAILED"); assert.equal(f.sessions.view(f.scope).errorCode, "AUTH_PERSISTENCE_FAILED");
 const record = f.vault.get(f.scope)!; assert.equal(record.auth, "SYNTHETIC_AUTH"); assert.equal(record.keys.synthetic, "SECRET"); assert.ok(record.processingFailure?.id); assert.equal(record.desired, true);
 await f.sessions.command(f.scope, "connect", randomUUID()); await f.callbacks[1]!.connection({ state: "open" });
 await f.callbacks[0]!.failure(); await f.sessions.settle(f.scope); assert.equal(f.sessions.metrics().active, 1); assert.equal(f.sessions.view(f.scope).state, "CONNECTED"); assert.ok(f.vault.get(f.scope)?.processingFailure?.recoveredAt);
 assert.equal(f.logs.includes("SYNTHETIC_AUTH"), false);
});
test("bounded actor saturation records one scoped failure, preserves auth, and ignores stale queued callbacks", async (t) => {
 const f = await fixture(t); await f.sessions.create(f.scope); await f.vault.update(f.scope, (r) => { r.auth = "SYNTHETIC_AUTH"; }); await f.sessions.command(f.scope, "connect", randomUUID());
 await Promise.all(Array.from({ length: 140 }, (_, i) => f.callbacks[0]!.text({ id: `synthetic-${i}`, chatId: "opaque@lid", body: "SYNTHETIC_PRIVATE_BODY", fromMe: false, timestamp: f.now() })));
 await f.sessions.settle(f.scope); assert.equal(f.sessions.metrics().active, 0); assert.equal(f.sessions.ready(), true); assert.equal(f.sessions.view(f.scope).errorCode, "SYNC_BACKPRESSURE"); assert.equal(f.vault.get(f.scope)?.auth, "SYNTHETIC_AUTH"); assert.equal(f.stats().starts, 1);
 assert.equal(f.logs.filter((x) => x === "SYNC_BACKPRESSURE").length, 1); assert.equal(f.logs.includes("SYNTHETIC_PRIVATE_BODY"), false);
});

test("capacity failure in one tenant cannot become a global storage failure when another session opens", async (t) => {
 const f = await fixture(t); await f.sessions.create(f.scope); await f.sessions.command(f.scope, "connect", randomUUID());
 await f.vault.update(f.scope, (r) => { r.events = Array.from({ length: 512 }, () => structuredClone(r.events[0]!)); });
 await f.callbacks[0]!.connection({ state: "open" }); assert.equal(f.sessions.view(f.scope).state, "FAILED"); assert.equal(f.sessions.ready(), true);
 await f.sessions.create(f.other); await f.sessions.command(f.other, "connect", randomUUID()); await f.callbacks[1]!.connection({ state: "open" });
 assert.equal(f.sessions.view(f.other).state, "CONNECTED"); assert.equal(f.sessions.view(f.scope).errorCode, "EVENT_QUEUE_FULL"); assert.equal(f.sessions.ready(), true); assert.equal(f.sessions.metrics().active, 1);
 assert.equal(f.vault.get(f.other)?.processingFailure, undefined); assert.equal(f.vault.get(f.scope)?.processingFailure?.code, "EVENT_QUEUE_FULL");
});

for (const code of [401, 500, 440]) test(`linked recovery rejects ${code} without erasing credentials or requesting pairing`, async (t) => {
 const f = await fixture(t); const auth = JSON.stringify({ registered: true, me: { id: "synthetic@lid" } });
 await f.vault.update(f.scope, (r) => { r.auth = auth; r.keys = { synthetic: "KEY" }; r.desired = true; });
 const sessions = new Sessions(f.vault, f.journal, f.factory, true, undefined, undefined, undefined, { enabled: false, historyEnabled: false, linkedRecoveryOnly: true }); t.after(() => sessions.shutdown());
 await sessions.recover(); await f.callbacks[0]!.connection({ state: "close", code }); await sessions.settle(f.scope);
 assert.equal(sessions.view(f.scope).state, "FAILED"); assert.equal(f.vault.get(f.scope)?.auth, auth); assert.deepEqual(f.vault.get(f.scope)?.keys, { synthetic: "KEY" }); assert.equal(f.vault.get(f.scope)?.desired, false); assert.equal(f.stats().logouts, 0); assert.equal(f.stats().starts, 1);
 await sessions.command(f.scope, "logout", randomUUID()); assert.equal(f.vault.get(f.scope)?.termination?.remote, "UNCONFIRMED"); assert.equal(f.vault.get(f.scope)?.auth, auth);
});
test("linked recovery refuses missing auth and suppresses QR without rotating persisted identity", async (t) => {
 const f = await fixture(t); await f.vault.update(f.scope, (r) => { r.desired = true; });
 const sessions = new Sessions(f.vault, f.journal, f.factory, true, undefined, undefined, undefined, { enabled: false, historyEnabled: false, linkedRecoveryOnly: true }); t.after(() => sessions.shutdown());
 await sessions.recover(); assert.equal(f.stats().starts, 0); assert.equal(f.vault.get(f.scope)?.auth, undefined); assert.equal(sessions.view(f.scope).errorCode, "EXISTING_AUTH_REQUIRED");
 const auth = JSON.stringify({ registered: true, me: { id: "synthetic@lid" } }); await f.vault.update(f.scope, (r) => { r.auth = auth; });
 await sessions.command(f.scope, "connect", randomUUID()); await f.callbacks[0]!.connection({ qr: "DO_NOT_STORE_OR_EXPOSE" }); await sessions.settle(f.scope);
 assert.equal(sessions.view(f.scope).state, "FAILED"); assert.equal(sessions.view(f.scope).qrRevision, 0); assert.throws(() => sessions.qr(f.scope), /QR_NOT_AVAILABLE/); assert.equal(f.vault.get(f.scope)?.auth, auth); assert.ok(!JSON.stringify(f.vault.get(f.scope)).includes("DO_NOT_STORE_OR_EXPOSE"));
});
test("linked recovery allows at most three transport attempts per process and preserves desired auth", async (t) => {
 const f = await fixture(t); const auth = JSON.stringify({ registered: true, me: { id: "synthetic@lid" } });
 await f.vault.update(f.scope, (r) => { r.auth = auth; r.desired = true; });
 const timers: (() => void)[] = []; const sessions = new Sessions(f.vault, f.journal, f.factory, true, (cb, delay) => { if (delay <= 30_250) timers.push(cb); return () => undefined; }, undefined, undefined, { enabled: false, historyEnabled: false, linkedRecoveryOnly: true }); t.after(() => sessions.shutdown());
 await sessions.recover();
 for (let i = 0; i < 3; i++) { await f.callbacks[i]!.connection({ state: "close", code: 503 }); if (i < 2) { timers.shift()!(); await sessions.settle(f.scope); } }
 assert.equal(f.stats().starts, 3); assert.equal(sessions.view(f.scope).errorCode, "RECONNECT_LIMIT"); assert.equal(timers.length, 0); assert.equal(f.vault.get(f.scope)?.auth, auth); assert.equal(f.vault.get(f.scope)?.desired, true);
});

test("linked session recovery uses the persisted QR identity despite registered false", async (t) => {
 const f = await fixture(t); const auth = JSON.stringify({ registered: false, me: { id: "synthetic@lid" } });
 await f.vault.update(f.scope, (r) => { r.auth = auth; r.desired = true; });
 const sessions = new Sessions(f.vault, f.journal, f.factory, true, undefined, undefined, undefined, { enabled: false, historyEnabled: false, linkedRecoveryOnly: true }); t.after(() => sessions.shutdown());
 await sessions.recover(); assert.equal(f.stats().starts, 1); await f.callbacks[0]!.connection({ state: "open" }); await sessions.settle(f.scope);
 assert.equal(sessions.view(f.scope).state, "CONNECTED"); assert.equal(sessions.view(f.scope).qrRevision, 0); assert.equal(f.vault.get(f.scope)?.auth, auth); assert.equal(f.stats().logouts, 0);
});
