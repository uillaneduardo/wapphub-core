import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Sessions } from "../src/sessions.js";
import { Vault } from "../src/vault.js";
import { EventJournal } from "../src/events.js";
import { fixture } from "./helpers.js";
const linkedAuth = JSON.stringify({ me: { id: "synthetic@lid" }, signedIdentityKey: { public: "synthetic", private: "synthetic" }, noiseKey: { public: "synthetic", private: "synthetic" } });
async function failed(f: Awaited<ReturnType<typeof fixture>>, errorCode = "RECONNECT_LIMIT") { await f.vault.update(f.scope, r => { r.state = "FAILED"; r.errorCode = errorCode; r.attempts = 5; r.auth = linkedAuth; r.keys = { synthetic: JSON.stringify("synthetic") }; r.desired = true; }); }
for (const error of ["SESSION_REVOKED", "SESSION_REPLACED", "BAD_SESSION", "STORAGE_FULL", "AUTH_PERSISTENCE_FAILED"]) test(`explicit recovery denies unsafe ${error}`, async t => {
 const f = await fixture(t); await failed(f, error); await assert.rejects(f.sessions.command(f.scope, "recover", randomUUID()), /RECOVERY_NOT_ELIGIBLE/); assert.equal(f.stats().starts, 0); assert.equal(f.vault.get(f.scope)?.attempts, 5);
});
for (const state of ["CONNECTED", "LOGGED_OUT", "CONNECTING"] as const) test(`explicit recovery denies state ${state}`, async t => {
 const f = await fixture(t); await failed(f); await f.vault.update(f.scope, r => { r.state = state; }); await assert.rejects(f.sessions.command(f.scope, "recover", randomUUID()), /RECOVERY_NOT_ELIGIBLE/); assert.equal(f.stats().starts, 0);
});
test("explicit recovery requires existing structural credentials and does not pair", async t => {
 const f = await fixture(t); await failed(f); await f.vault.update(f.scope, r => { delete r.auth; }); await assert.rejects(f.sessions.command(f.scope, "recover", randomUUID()), /RECOVERY_NOT_ELIGIBLE/); assert.equal(f.stats().starts, 0);
});
test("FAILED legacy attempts=5 gets exactly one durable attempt per authorization, no transient retry or reset", async t => {
 const f = await fixture(t); await failed(f); await f.sessions.recover(); assert.equal(f.stats().starts, 0); const id = randomUUID();
 await f.sessions.command(f.scope, "recover", id); await f.sessions.command(f.scope, "recover", id); assert.equal(f.stats().starts, 1); assert.equal(f.vault.get(f.scope)?.attempts, 6); assert.equal(f.vault.get(f.scope)?.recovery?.state, "RUNNING"); assert.equal(f.vault.get(f.scope)?.desired, false);
 f.callbacks[0]!.connection({ state: "close", code: 503 }); await f.sessions.settle(f.scope); assert.equal(f.vault.get(f.scope)?.lastDisconnect?.code, 503); assert.equal(f.vault.get(f.scope)?.recovery?.state, "FAILED"); assert.equal(f.sessions.view(f.scope).errorCode, "CONNECTION_LOST");
 await f.sessions.recover(); await f.sessions.command(f.scope, "recover", id); assert.equal(f.stats().starts, 1); assert.equal(f.vault.get(f.scope)?.auth, linkedAuth); assert.equal(f.timers.filter(x => !x.canceled).length, 0);
 const next = randomUUID(); await f.sessions.command(f.scope, "recover", next); assert.equal(f.stats().starts, 2); assert.equal(f.vault.get(f.scope)?.attempts, 7);
});
test("controlled recovery becomes successful only after authenticated open and thirty seconds stability", async t => {
 const f = await fixture(t); await failed(f); await f.sessions.command(f.scope, "recover", randomUUID());
 f.callbacks[0]!.connection({ state: "open" }); await f.sessions.settle(f.scope); assert.equal(f.vault.get(f.scope)?.recovery?.state, "AUTHENTICATED"); assert.equal(f.vault.get(f.scope)?.desired, false);
 const stable = f.timers.find(x => !x.canceled && x.delay === 30000)!; assert.ok(stable); f.advance(30000); stable.run(); await f.sessions.settle(f.scope); assert.equal(f.vault.get(f.scope)?.recovery?.state, "SUCCEEDED"); assert.equal(f.vault.get(f.scope)?.desired, true); assert.equal(f.vault.get(f.scope)?.attempts, 6);
});
test("controlled recovery timeout and QR fallback preserve keys and stop all retries", async t => {
 const f = await fixture(t); await failed(f); await f.sessions.command(f.scope, "recover", randomUUID()); const deadline = f.timers.find(x => !x.canceled && x.delay === 120000)!; deadline.run(); await f.sessions.settle(f.scope); assert.equal(f.sessions.view(f.scope).errorCode, "RECOVERY_TIMEOUT"); assert.equal(f.vault.get(f.scope)?.recovery?.state, "FAILED");
 await f.sessions.command(f.scope, "recover", randomUUID()); f.callbacks[1]!.connection({ qr: "NEVER_EXPOSE" }); await f.sessions.settle(f.scope); assert.equal(f.sessions.view(f.scope).errorCode, "EXISTING_AUTH_REQUIRED"); assert.throws(() => f.sessions.qr(f.scope)); assert.equal(f.vault.get(f.scope)?.auth, linkedAuth); assert.ok(!JSON.stringify(f.vault.get(f.scope)).includes("NEVER_EXPOSE"));
});
test("restart during recovery records interrupted result without another network attempt", async t => {
 const f = await fixture(t); await failed(f); const id = randomUUID(); await f.sessions.command(f.scope, "recover", id); await f.sessions.shutdown(); const vault = new Vault(f.vault.directory, f.key); await vault.initialize(); const restored = new Sessions(vault, new EventJournal(vault), f.factory, true); t.after(() => restored.shutdown()); await restored.recover();
 assert.equal(f.stats().starts, 1); assert.equal(vault.get(f.scope)?.recovery?.state, "INTERRUPTED"); assert.equal(vault.get(f.scope)?.desired, false); await restored.command(f.scope, "recover", id); assert.equal(f.stats().starts, 1);
});
test("linkedRecoveryOnly allows reversible stop and unconfirmed logout with no socket", async t => {
 const f = await fixture(t); await failed(f); const sessions = new Sessions(f.vault, f.journal, f.factory, true, undefined, undefined, undefined, { enabled: false, historyEnabled: false, linkedRecoveryOnly: true }); t.after(() => sessions.shutdown()); const keys = f.vault.get(f.scope)?.keys;
 const id = randomUUID(); await sessions.command(f.scope, "disconnect", id, 2); await sessions.command(f.scope, "disconnect", id, 2); assert.equal(f.vault.get(f.scope)?.desired, false); assert.equal(sessions.view(f.scope).state, "DISCONNECTED"); assert.deepEqual(f.vault.get(f.scope)?.keys, keys); assert.equal(f.vault.get(f.scope)?.auth, linkedAuth);
 await assert.rejects(sessions.command(f.scope, "connect", randomUUID(), 1), /STALE_CONTROL_COMMAND/); await sessions.recover(); assert.equal(f.stats().starts, 0);
 await sessions.command(f.scope, "logout", randomUUID(), 3); assert.equal(f.vault.get(f.scope)?.termination?.remote, "UNCONFIRMED"); assert.equal(f.vault.get(f.scope)?.termination?.errorCode, "LOGOUT_TRANSPORT_UNAVAILABLE"); assert.equal(f.vault.get(f.scope)?.auth, linkedAuth); await assert.rejects(sessions.command(f.scope, "recover", randomUUID(), 4), /RECOVERY_NOT_ELIGIBLE/);
});
for (const result of ["CONFIRMED", "UNCONFIRMED", "ERROR"] as const) test(`logout ${result} fences callbacks, records remote outcome and retains credentials`, async t => {
 const f = await fixture(t); await failed(f); let logouts = 0; const sessions = new Sessions(f.vault, f.journal, async (_s, cb) => { f.callbacks.push(cb); return { close() {}, logout: async () => { logouts++; assert.equal(f.vault.get(f.scope)?.termination?.remote, "PENDING"); assert.equal(f.vault.get(f.scope)?.auth, linkedAuth); if (result === "ERROR") throw new Error("private error"); return result; } }; }, true); t.after(() => sessions.shutdown());
 await sessions.command(f.scope, "recover", randomUUID(), 1); f.callbacks[0]!.connection({ state: "open" }); await sessions.settle(f.scope); const id = randomUUID(); await sessions.command(f.scope, "logout", id, 2); await sessions.command(f.scope, "logout", id, 2); f.callbacks[0]!.connection({ state: "open" }); await sessions.settle(f.scope);
 assert.equal(logouts, 1); assert.equal(f.vault.get(f.scope)?.termination?.remote, result === "CONFIRMED" ? "CONFIRMED" : "UNCONFIRMED"); assert.equal(sessions.view(f.scope).state, result === "CONFIRMED" ? "LOGGED_OUT" : "DISCONNECTED"); assert.equal(f.vault.get(f.scope)?.desired, false); assert.equal(f.vault.get(f.scope)?.auth, linkedAuth);
});
test("local stop cancels a scheduled reconnect even when a stale timer fires", async t => {
 const f = await fixture(t); await f.vault.update(f.scope, r => { r.auth = JSON.stringify({me:{id:"synthetic@lid"},noiseKey:{private:"synthetic",public:"synthetic"},signedIdentityKey:{private:"synthetic",public:"synthetic"}}); }); await f.sessions.create(f.scope); await f.sessions.command(f.scope, "connect", randomUUID(), 1); f.callbacks[0]!.connection({ state: "close", code: 503 }); await f.sessions.settle(f.scope); const timer = f.timers.find(x => !x.canceled)!;
 await f.sessions.command(f.scope, "disconnect", randomUUID(), 2); timer.run(); await f.sessions.settle(f.scope); assert.equal(f.stats().starts, 1); assert.equal(f.sessions.view(f.scope).state, "DISCONNECTED");
});
test("restart during uncertain logout does not retry remote revocation or reconnect", async t => {
 const f = await fixture(t); await failed(f); await f.vault.update(f.scope, r => { r.desired = false; r.termination = { commandId: randomUUID(), action: "logout", remote: "PENDING", requestedAt: new Date().toISOString() }; }); await f.sessions.recover(); assert.equal(f.stats().starts, 0); assert.equal(f.vault.get(f.scope)?.termination?.remote, "UNCONFIRMED"); assert.equal(f.vault.get(f.scope)?.auth, linkedAuth);
});

test("logout timeout is unconfirmed and leaves no recovery loop or credential deletion", async t => {
 const f = await fixture(t); await failed(f); const sessions = new Sessions(f.vault, f.journal, async (_s, cb) => { f.callbacks.push(cb); return { close() {}, logout: () => new Promise(() => {}) }; }, true); t.after(() => sessions.shutdown());
 await sessions.command(f.scope, "recover", randomUUID()); f.callbacks[0]!.connection({ state: "open" }); await sessions.settle(f.scope); await sessions.command(f.scope, "logout", randomUUID());
 assert.equal(f.vault.get(f.scope)?.termination?.remote, "UNCONFIRMED"); assert.equal(f.vault.get(f.scope)?.auth, linkedAuth); assert.equal(f.vault.get(f.scope)?.desired, false); await sessions.command(f.scope, "disconnect", randomUUID()); await assert.rejects(sessions.command(f.scope, "recover", randomUUID()), /RECOVERY_NOT_ELIGIBLE/);
});

test("transport construction timeout records the attempt, closes a late transport and never replays", async t => {
 const f = await fixture(t); await failed(f); let release!: () => void, closed = 0, started = 0;
 const timers: { run: () => void; canceled: boolean }[] = [];
 const sessions = new Sessions(f.vault, f.journal, async () => { started++; return new Promise(resolve => { release = () => resolve({ close() { closed++; }, logout: async () => undefined }); }); }, true, run => { const timer = { run, canceled: false }; timers.push(timer); return () => { timer.canceled = true; }; }); t.after(() => sessions.shutdown());
 const id = randomUUID(), attempt = sessions.command(f.scope, "recover", id);
 while (!started) await new Promise(resolve => setImmediate(resolve)); assert.equal(f.vault.get(f.scope)?.recovery?.state, "RUNNING"); timers.find(timer => !timer.canceled)!.run(); await attempt;
 assert.equal(f.sessions.metrics().active, 0); assert.equal(sessions.view(f.scope).errorCode, "RECOVERY_TIMEOUT"); assert.equal(f.vault.get(f.scope)?.desired, false); release(); await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, 1);
 await sessions.command(f.scope, "recover", id); await sessions.recover(); assert.equal(started, 1); assert.equal(f.vault.get(f.scope)?.attempts, 6);
});
test("known transient construction error permits only another explicitly authorized attempt", async t => {
 const f = await fixture(t); await failed(f); let starts = 0; const sessions = new Sessions(f.vault, f.journal, async () => { starts++; throw Object.assign(new Error("synthetic network failure"), { code: "EAI_AGAIN" }); }, true); t.after(() => sessions.shutdown());
 const id = randomUUID(); await sessions.command(f.scope, "recover", id); await sessions.command(f.scope, "recover", id); await sessions.recover(); assert.equal(starts, 1); assert.equal(sessions.view(f.scope).errorCode, "CONNECTION_LOST"); assert.equal(f.vault.get(f.scope)?.auth, linkedAuth); assert.equal(f.vault.get(f.scope)?.desired, false);
});

for (const proof of ["CONFIRMED", "UNCONFIRMED"] as const) test(`new link after ${proof} unlink requires proof, keeps encrypted archive and uses a fenced scoped authorization`, async t => {
 const f = await fixture(t); await failed(f); await f.vault.update(f.scope, r => { r.desired = false; r.termination = { commandId: randomUUID(), action: "logout", remote: proof, requestedAt: new Date().toISOString() }; if (proof === "CONFIRMED") r.invalidated = "SESSION_REVOKED"; });
 const sessions = new Sessions(f.vault, f.journal, f.factory, true, undefined, undefined, undefined, { enabled: false, historyEnabled: false, linkedRecoveryOnly: true }); t.after(() => sessions.shutdown());
 assert.equal(sessions.view(f.scope).sync.lifecycle.preparationEligible, true);
 await assert.rejects(sessions.command(f.scope, "connect", randomUUID(), 1), /CONTROLLED_RECOVERY_REQUIRED/);
 if (proof === "UNCONFIRMED") await assert.rejects(sessions.command(f.scope, "prepare_link", randomUUID(), 2), /LINK_PREPARATION_DENIED/);
 const id = randomUUID(); await sessions.command(f.scope, "prepare_link", id, 2, proof === "UNCONFIRMED"); await sessions.command(f.scope, "prepare_link", id, 2, proof === "UNCONFIRMED");
 const r = f.vault.get(f.scope)!; assert.equal(r.auth, undefined); assert.deepEqual(r.keys, {}); assert.equal(r.retiredSessions?.length, 1); assert.equal(r.retiredSessions?.[0]?.auth, linkedAuth); assert.equal(r.attempts, 5); assert.equal(f.stats().starts, 0);
 await assert.rejects(sessions.command(f.scope, "connect", randomUUID(), 1), /STALE_CONTROL_COMMAND/);
 await sessions.command(f.scope, "connect", randomUUID(), 3); assert.equal(f.stats().starts, 1); f.callbacks[0]!.connection({ qr: "SYNTHETIC_NEW_QR" }); await sessions.settle(f.scope); assert.equal(sessions.qr(f.scope).qr, "SYNTHETIC_NEW_QR");
 await f.vault.update(f.scope, record => { record.auth = linkedAuth; }); f.callbacks[0]!.connection({ state: "open" }); await sessions.settle(f.scope); assert.equal(sessions.view(f.scope).state, "CONNECTED"); assert.equal(f.vault.get(f.scope)?.retiredSessions?.[0]?.auth, linkedAuth); assert.equal(f.vault.get(f.scope)?.attempts, 6);
});
test("linked-only policy allows an explicitly scoped first pairing but never a QR on unauthenticated boot or exhausted linked session", async t => {
 const f = await fixture(t); await f.sessions.create(f.scope); const sessions = new Sessions(f.vault, f.journal, f.factory, true, undefined, undefined, undefined, { enabled: false, historyEnabled: false, linkedRecoveryOnly: true }); t.after(() => sessions.shutdown());
 await sessions.recover(); assert.equal(f.stats().starts, 0); await sessions.command(f.scope, "connect", randomUUID(), 1); f.callbacks[0]!.connection({ qr: "SYNTHETIC_FIRST_QR" }); await sessions.settle(f.scope); assert.equal(sessions.qr(f.scope).revision, 1);
 await sessions.command(f.scope, "refresh", randomUUID(), 2); assert.equal(f.stats().starts, 2);
 await sessions.shutdown(); const restored = new Sessions(f.vault, f.journal, f.factory, true, undefined, undefined, undefined, { enabled: false, historyEnabled: false, linkedRecoveryOnly: true }); t.after(() => restored.shutdown()); await restored.recover(); assert.equal(f.stats().starts, 2); assert.equal(f.vault.get(f.scope)?.desired, false); assert.equal(f.vault.get(f.scope)?.pairingAuthorization, undefined);
});
test("local stop and active credentials cannot be retired; quota and idempotency protect archive", async t => {
 const f = await fixture(t); await failed(f); await f.sessions.command(f.scope, "disconnect", randomUUID(), 1); await assert.rejects(f.sessions.command(f.scope, "prepare_link", randomUUID(), 2, true), /LINK_PREPARATION_DENIED/); assert.equal(f.vault.get(f.scope)?.auth, linkedAuth);
 await f.sessions.command(f.scope, "logout", randomUUID(), 2); const id = randomUUID(); await f.sessions.command(f.scope, "prepare_link", id, 3, true); await assert.rejects(f.sessions.command(f.scope, "prepare_link", id, 3, false), /IDEMPOTENCY_CONFLICT/);
 await f.vault.update(f.scope, r => { r.retiredSessions!.push(r.retiredSessions![0]!); r.auth = linkedAuth; r.termination = { commandId: randomUUID(), action: "logout", remote: "CONFIRMED", requestedAt: new Date().toISOString() }; }); await assert.rejects(f.sessions.command(f.scope, "prepare_link", randomUUID(), 4), /SESSION_ARCHIVE_LIMIT/); assert.equal(f.vault.get(f.scope)?.auth, linkedAuth);
});

for (const code of [401, 403] as const) test(`remote revocation code ${code} keeps removal evidence distinct`, async t => {
 const f = await fixture(t); await failed(f, "SESSION_REVOKED"); await f.vault.update(f.scope, r => { r.desired = false; r.invalidated = "SESSION_REVOKED"; r.lastDisconnect = { code, occurredAt: new Date().toISOString() }; });
 assert.equal(f.sessions.view(f.scope).sync.lifecycle.preparationEligible, true); assert.equal(f.sessions.view(f.scope).sync.lifecycle.removalConfirmationRequired, code !== 401); assert.equal(f.stats().starts, 0); assert.equal(f.vault.get(f.scope)?.auth, linkedAuth);
});

test("restart after pairing identity is persisted but before authenticated open does not resume QR or transport", async t => {
 const f = await fixture(t); await f.sessions.create(f.scope); await f.sessions.command(f.scope, "connect", randomUUID(), 1); await f.vault.update(f.scope, r => { r.auth = linkedAuth; }); await f.sessions.shutdown();
 const restored = new Sessions(f.vault, f.journal, f.factory, true); t.after(() => restored.shutdown()); await restored.recover(); assert.equal(f.stats().starts, 1); assert.equal(f.vault.get(f.scope)?.desired, false); assert.equal(f.vault.get(f.scope)?.pairingAuthorization, undefined); assert.equal(f.vault.get(f.scope)?.auth, linkedAuth); assert.equal(restored.view(f.scope).state, "FAILED"); assert.equal(restored.view(f.scope).errorCode,"PAIRING_INTERRUPTED");
});
