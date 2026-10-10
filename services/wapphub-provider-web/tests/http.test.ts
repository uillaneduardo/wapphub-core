import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { InternalAuth, signedHeaders } from "../src/auth.js";
import { fixture } from "./helpers.js";

test("health reveals no tenant state; all internal operations require authentication", async (t) => {
  const f = await fixture(t, false);
  assert.deepEqual((await f.app.inject({ url: "/health/live" })).json(), { status: "ok" });
  assert.equal((await f.app.inject({ url: "/health/ready" })).statusCode, 200);
  assert.equal((await f.app.inject({ method: "PUT", url: f.path })).statusCode, 401);
  assert.equal((await f.app.inject({ url: "/internal/v1/metrics" })).statusCode, 401);
  assert.equal(f.vault.all().length, 0);
});
test("HMAC binds method, path, body and timestamp; wrong keys and replay are rejected", async (t) => {
  const f = await fixture(t); const headers = signedHeaders(f.internalKey, "PUT", f.path, undefined, f.now());
  assert.equal((await f.app.inject({ method: "PUT", url: f.path, headers })).statusCode, 200);
  assert.equal((await f.app.inject({ method: "PUT", url: f.path, headers })).statusCode, 401);
  assert.equal((await f.app.inject({ method: "GET", url: f.path, headers })).statusCode, 401);
  assert.equal((await f.app.inject({ method: "PUT", url: f.path, headers: signedHeaders(randomBytes(32), "PUT", f.path) })).statusCode, 401);
  const body = { action: "connect", commandId: randomUUID() }, commandPath = `${f.path}/commands`;
  assert.equal((await f.app.inject({ method: "POST", url: commandPath, payload: { ...body, action: "logout" }, headers: signedHeaders(f.internalKey, "POST", commandPath, body) })).statusCode, 401);
  assert.equal((await f.app.inject({ method: "GET", url: f.path, headers: signedHeaders(f.internalKey, "GET", f.path, undefined, f.now() - 30_001) })).statusCode, 401);
});
test("nonce replay protection survives restarting the authentication component", async (t) => {
  const f = await fixture(t); const headers = signedHeaders(f.internalKey, "GET", f.path, undefined, f.now());
  await f.auth.verify("GET", f.path, undefined, headers);
  const restored = new InternalAuth(f.internalKey, `${f.directory}/nonces`, f.now); await restored.initialize();
  await assert.rejects(restored.verify("GET", f.path, undefined, headers), /REPLAY_REJECTED/);
  f.advance(30_001);
  await restored.verify("GET", f.path, undefined, signedHeaders(f.internalKey, "GET", f.path, undefined, f.now()));
});
test("internal lifecycle integration is validated, scoped, private and disabled in checkpoint 2", async (t) => {
  const f = await fixture(t, false);
  const call = (method: "PUT" | "GET" | "POST", url: string, payload?: object) => f.app.inject({ method, url, payload, headers: signedHeaders(f.internalKey, method, url, payload, f.now()) });
  assert.equal((await call("PUT", f.path)).statusCode, 200);
  const connect = await call("POST", `${f.path}/commands`, { action: "connect", commandId: randomUUID() });
  assert.equal(connect.statusCode, 403); assert.equal(connect.json().error.code, "CONNECTIONS_DISABLED");
  assert.equal((await call("POST", `${f.path}/commands`, { action: "connect", commandId: randomUUID(), organizationId: f.other.organizationId })).statusCode, 400);
  assert.equal((await call("GET", f.path.replace(f.scope.organizationId, f.other.organizationId))).statusCode, 404);
  assert.equal((await call("POST", `${f.path}/events/pull`, { limit: 21 })).statusCode, 400);
  const qr = await call("GET", `${f.path}/qr`); assert.equal(qr.statusCode, 404); assert.equal(qr.headers["cache-control"], "no-store");
  const metrics = await call("GET", "/internal/v1/metrics"); assert.equal(metrics.json().sessions, 1); assert.equal(metrics.json().active, 0);
  assert.equal(JSON.stringify(f.logs).includes(f.scope.organizationId), false);
});
test("authenticated lifecycle emits normalized events through pull/ack", async (t) => {
  const f = await fixture(t); const call = (method: "PUT" | "GET" | "POST", url: string, payload?: object) => f.app.inject({ method, url, payload, headers: signedHeaders(f.internalKey, method, url, payload) });
  await call("PUT", f.path); await call("POST", `${f.path}/commands`, { action: "connect", commandId: randomUUID() });
  const pulled = await call("POST", `${f.path}/events/pull`, { limit: 1 });
  assert.equal(pulled.statusCode, 200); const [item] = pulled.json().deliveries;
  assert.equal(item.event.type, "connection.updated"); assert.equal(item.event.organizationId, f.scope.organizationId);
  assert.equal((await call("POST", `${f.path}/events/ack`, { eventId: item.event.eventId, leaseId: item.leaseId })).statusCode, 200);
  assert.equal(f.journal.metrics().pending, 0);
});
