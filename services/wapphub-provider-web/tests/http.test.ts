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

test("P0 full receipt window permits only fenced lifecycle commands and rejects evicted replay", async t => {
 const f = await fixture(t); await f.sessions.create(f.scope);
 const first = randomUUID();
 await f.vault.update(f.scope, r => { r.controlVersion = 10; r.commands = Array.from({length:256}, (_,i) => ({id:i===0?first:randomUUID(), digest:'synthetic'})); r.auth=JSON.stringify({me:{id:'synthetic@lid'}}); r.keys={'synthetic':'protected'}; r.attempts=5; r.desired=false; r.state='DISCONNECTED'; r.termination={commandId:randomUUID(),action:'logout',remote:'UNCONFIRMED',requestedAt:new Date(f.now()).toISOString()}; });
 const call = (body: object) => f.app.inject({method:'POST',url:`${f.path}/commands`,payload:body,headers:signedHeaders(f.internalKey,'POST',`${f.path}/commands`,body,f.now())});
 const original=f.vault.get(f.scope)!.auth;
 const legacy=await call({action:'prepare_link',commandId:randomUUID(),removedOnPhone:true}); assert.equal(legacy.statusCode,429); assert.equal(legacy.json().error.code,'SESSION_COMMAND_LIMIT');
 const denied=await call({action:'prepare_link',commandId:randomUUID(),controlVersion:11,removedOnPhone:false}); assert.equal(denied.statusCode,409); assert.equal(f.vault.get(f.scope)?.auth,original);
 const id=randomUUID(),body={action:'prepare_link',commandId:id,controlVersion:11,removedOnPhone:true};
 assert.equal((await call(body)).statusCode,200); assert.equal(f.vault.get(f.scope)?.commands.length,256); assert.equal(f.vault.get(f.scope)?.retiredSessions?.length,1); assert.equal(f.vault.get(f.scope)?.retiredSessions?.[0]?.auth,original); assert.equal(f.stats().starts,0);
 assert.equal((await call(body)).statusCode,200); assert.equal(f.vault.get(f.scope)?.retiredSessions?.length,1);
 const stale=await call({action:'connect',commandId:first,controlVersion:10}); assert.equal(stale.statusCode,409); assert.equal(stale.json().error.code,'STALE_CONTROL_COMMAND'); assert.equal(f.stats().starts,0);
 const connect=await call({action:'connect',commandId:randomUUID(),controlVersion:12}); assert.equal(connect.statusCode,200); assert.equal(f.vault.get(f.scope)?.commands.length,256); assert.equal(f.stats().starts,1);
 f.callbacks[0]!.connection({qr:'SYNTHETIC_QR'}); await f.sessions.settle(f.scope); assert.equal(f.sessions.qr(f.scope).qr,'SYNTHETIC_QR');
});
