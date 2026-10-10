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
  const f = await fixture(t); await f.sessions.create(f.scope); await f.sessions.command(f.scope, "connect", randomUUID());
  f.callbacks[0]!.connection({ state: "close", code }); await f.sessions.settle(f.scope);
  assert.equal(f.vault.get(f.scope)?.desired, false); assert.equal(f.stats().starts, 1);
  assert.equal(f.timers.filter((timer) => !timer.canceled).length, 0);
  assert.equal(f.sessions.view(f.scope).state, code === 401 ? "LOGGED_OUT" : "FAILED");
});
test("transient failures reconnect with exponential backoff and stop after five attempts", async (t) => {
  const f = await fixture(t); await f.sessions.create(f.scope); await f.sessions.command(f.scope, "connect", randomUUID());
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
  f.timers[0]!.run(); await f.sessions.settle(f.scope);
  assert.equal(f.sessions.view(f.scope).errorCode, "PAIRING_TIMEOUT"); assert.equal(f.vault.get(f.scope)?.desired, false);
});
test("logout revokes local credentials and is idempotent", async (t) => {
  const f = await fixture(t); await f.sessions.create(f.scope); await f.vault.update(f.scope, (record) => { record.auth = "TEST_AUTH"; });
  await f.sessions.command(f.scope, "connect", randomUUID()); const id = randomUUID();
  await f.sessions.command(f.scope, "logout", id); await f.sessions.command(f.scope, "logout", id);
  assert.equal(f.stats().logouts, 1); assert.equal(f.vault.get(f.scope)?.auth, undefined); assert.equal(f.sessions.view(f.scope).state, "LOGGED_OUT");
});
test("restart restores desired sessions and retains retry budget", async (t) => {
  const f = await fixture(t); await f.sessions.create(f.scope); await f.sessions.command(f.scope, "connect", randomUUID());
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
test("event queue exhaustion fails closed and readiness becomes unavailable", async (t) => {
  const f = await fixture(t); await f.sessions.create(f.scope); await f.sessions.command(f.scope, "connect", randomUUID());
  await f.vault.update(f.scope, (record) => { record.events = Array.from({ length: 512 }, () => structuredClone(record.events[0]!)); });
  f.callbacks[0]!.connection({ state: "open" }); await f.sessions.settle(f.scope);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.sessions.ready(), false); assert.equal(f.sessions.metrics().active, 0);
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
