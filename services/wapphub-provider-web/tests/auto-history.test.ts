import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fixture } from "./helpers.js";
import { HistoryImporter } from "../src/history-operation.js";
import { Vault } from "../src/vault.js";
import { normalizeSyncMessage } from "../src/sync-normalization.js";
import type { HistorySpec } from "../../../contracts/history.js";
const spec = (messages = 20): HistorySpec => { const now = Date.now(); return ({ id: randomUUID(), from: new Date(now - 30 * 86400000).toISOString(), to: new Date(now).toISOString(), limits: { contacts: 500, conversations: 500, messages }, anchors: [{ chatId: "anchor@lid", messageId: "known", fromMe: false, timestamp: now }] }); };
async function until(check: () => boolean) { for (let i = 0; i < 400; i++) { if (check()) return; await delay(10); } assert.fail("bounded synthetic wait expired"); }

test("CP4.7 grants require exact scope, no-progress response and reconciliation preserve one bounded budget", async (t) => {
 const f = await fixture(t); await f.sessions.create(f.scope); let now = Date.now(), requests = 0;
 const s = spec(20), authorization = { ...f.scope, actorUserId: randomUUID(), authorizedAt: new Date(now).toISOString() };
 const importer = new HistoryImporter(f.vault, f.scope, async () => { requests++; return "r"; }, async () => [], true, () => now, true); t.after(async () => { await importer.close(); });
 await importer.command({ commandId: s.id, operationId: s.id, action: "prepare", spec: s });
 await assert.rejects(importer.command({ commandId: randomUUID(), operationId: s.id, action: "start" }), /HISTORY_EXECUTION_DISABLED/); assert.equal(requests, 0);
 await importer.command({ commandId: randomUUID(), operationId: s.id, action: "prepare", spec: s, authorization });
 await assert.rejects(importer.command({ commandId: randomUUID(), operationId: s.id, action: "start", authorization: { ...authorization, organizationId: randomUUID() } }), /HISTORY_SCOPE_DENIED/);
 await importer.command({ commandId: randomUUID(), operationId: s.id, action: "start", authorization }); await until(() => requests === 1);
 await importer.receive([]); await until(() => importer.current?.state === "NO_DATA");
 for (let i = 0; i < 3; i++) { now += 300000; await importer.command({ commandId: randomUUID(), operationId: s.id, action: "reconcile", spec: s, authorization }); }
 assert.equal(requests, 1); assert.equal(importer.current?.messages, 0); assert.equal(importer.current?.target, 1);
 await importer.command({ commandId: randomUUID(), operationId: s.id, action: "reconcile", spec: { ...s, anchors: [...s.anchors, { ...s.anchors[0]!, chatId: "new@lid" }] }, authorization }); await until(() => requests === 2);
 assert.equal(importer.current?.id, s.id); assert.equal(importer.current?.limits.messages, 20); await importer.close();
});
test("retained ON_DEMAND reference can be retried locally after a bounded size-limit failure, without requesting history twice", async (t) => {
 const f = await fixture(t); await f.sessions.create(f.scope);
 let now = Date.now(), requests = 0, decodes = 0;
 const s = spec(20), authorization = { ...f.scope, actorUserId: randomUUID(), authorizedAt: new Date(now).toISOString() };
 const message = normalizeSyncMessage(f.scope, { key: { id: "retained-size-fix", remoteJid: "anchor@lid", fromMe: false },
  messageTimestamp: Math.floor(now / 1000) - 3600, message: { conversation: "synthetic-history" } })!;
 const { ServiceError } = await import("../src/errors.js");
 const importer = new HistoryImporter(f.vault, f.scope, async () => { requests++; return "request-1"; },
  async () => { if (++decodes === 1) throw new ServiceError("HISTORY_BYTE_LIMIT"); return [message]; },
  true, () => now, true);
 t.after(async () => { await importer.close(); });
 await importer.command({ commandId: s.id, operationId: s.id, action: "prepare", spec: s, authorization });
 await importer.command({ commandId: randomUUID(), operationId: s.id, action: "start", authorization });
 await until(() => requests === 1);
 await importer.receive([], "encrypted-reference");
 await until(() => importer.current?.state === "PAUSED");
 assert.equal(importer.current?.errorCode, "HISTORY_BYTE_LIMIT");
 assert.equal(requests, 1);
 now += 60001;
 await importer.command({ commandId: randomUUID(), operationId: s.id, action: "reconcile", authorization });
 await until(() => importer.current?.messages === 1);
 assert.equal(decodes, 2); assert.equal(requests, 1);
});

test("CP4.7 cooldown and safe/uncertain restart use durable request checkpoints", async (t) => {
 const f = await fixture(t); await f.sessions.create(f.scope); let now = Date.now(), requests = 0;
 const s = spec(20), authorization = { ...f.scope, actorUserId: randomUUID(), authorizedAt: new Date(now).toISOString() };
 const importer = new HistoryImporter(f.vault, f.scope, async () => { requests++; return "r"; }, async () => [], true, () => now, true);
 await importer.command({ commandId: s.id, operationId: s.id, action: "prepare", spec: s, authorization }); await importer.command({ commandId: randomUUID(), operationId: s.id, action: "start", authorization }); await until(() => requests === 1);
 await importer.receive([normalizeSyncMessage(f.scope, { key: { id: "older-auto", remoteJid: "anchor@lid" }, messageTimestamp: Math.floor(now / 1000) - 3600, message: { conversation: "synthetic" } })!]);
 await until(() => importer.current?.messages === 1 && !!importer.current.nextAnchor); await delay(20); assert.equal(requests, 1); assert.ok(importer.current!.cooldowns!["anchor@lid"]! > now); await importer.close();
 const restored = new Vault(f.vault.directory, f.key); await restored.initialize();
 const recovered = new HistoryImporter(restored, f.scope, async () => { requests++; return "r2"; }, async () => [], true, () => now, true); t.after(() => recovered.close());
 await recovered.recover(); assert.equal(recovered.current?.errorCode, "HISTORY_RESTART_PAUSED");
 now += 300001; await recovered.command({ commandId: randomUUID(), operationId: s.id, action: "reconcile", authorization }); await until(() => requests === 2); await recovered.close();
 const uncertain = new HistoryImporter(restored, f.scope, async () => { requests++; return "bad"; }, async () => [], true, () => now, true); t.after(async () => { await uncertain.close(); }); await uncertain.recover(); assert.equal(uncertain.current?.errorCode, "HISTORY_RESTART_UNCERTAIN");
 await uncertain.command({ commandId: randomUUID(), operationId: s.id, action: "reconcile", authorization }); await delay(20); assert.equal(requests, 2); assert.equal(uncertain.current?.state, "PAUSED");
 await assert.rejects(uncertain.command({ commandId: randomUUID(), operationId: s.id, action: "resume", authorization }), /HISTORY_REQUEST_UNCERTAIN/); await uncertain.close();
});
test("CP4.7 live backlog pauses dispatch and disabled flags override signed authorization", async (t) => {
 const f = await fixture(t); await f.sessions.create(f.scope); const s = spec(20), authorization = { ...f.scope, actorUserId: randomUUID(), authorizedAt: new Date().toISOString() }; let requests = 0;
 const off = new HistoryImporter(f.vault, f.scope, async () => { requests++; return "bad"; }, async () => [], false, Date.now, true);
 await off.command({ commandId: s.id, operationId: s.id, action: "prepare", spec: s, authorization }); await assert.rejects(off.command({ commandId: randomUUID(), operationId: s.id, action: "start", authorization }), /HISTORY_EXECUTION_DISABLED/); off.close();
 await f.journal.stage(f.scope, Array.from({ length: 101 }, (_, i) => normalizeSyncMessage(f.scope, { key: { id: `pressure${i}`, remoteJid: "anchor@lid" }, messageTimestamp: Math.floor(Date.now()/1000), message: { conversation: "live" } })!), false, false);
 const on = new HistoryImporter(f.vault, f.scope, async () => { requests++; return "bad"; }, async () => [], true, Date.now, true); t.after(async () => { await on.close(); });
 await on.command({ commandId: randomUUID(), operationId: s.id, action: "start", authorization }); await until(() => on.current?.state === "PAUSED"); assert.equal(on.current?.errorCode, "HISTORY_LIVE_BACKLOG"); assert.equal(requests, 0); await on.close();
});

test("CP4.7 automatic authorization requires correlated RC14 self-only ON_DEMAND responses", async (t) => {
 const { makeEventBuffer, proto } = await import("baileys"), { default: pino } = await import("pino"), { deflateSync } = await import("node:zlib"), { baileysFactory } = await import("../src/baileys.js");
 const f = await fixture(t); await f.sessions.create(f.scope); const s = spec(20), authorization = { ...f.scope, actorUserId: randomUUID(), authorizedAt: new Date().toISOString() }, ev = makeEventBuffer(pino({ level: "silent" })); let requests = 0;
 const factory = baileysFactory(f.vault, () => ({ ev, end: async () => undefined, logout: async () => undefined, fetchMessageHistory: async () => { requests++; return "correlated-request"; } }), { enabled: true, historyEnabled: false, historyExecutionEnabled: true, scopedHistoryAuthorization: true });
 const transport = await factory(f.scope, { connection: () => undefined, text: () => assert.fail(), receipt: () => undefined, failure: () => assert.fail(), sync: () => undefined });
 await transport.history!({ commandId: s.id, operationId: s.id, action: "prepare", spec: s, authorization }); assert.equal(requests, 0);
 await transport.history!({ commandId: randomUUID(), operationId: s.id, action: "start", authorization }); await until(() => f.vault.get(f.scope)?.historyOperation?.requestId === "correlated-request");
 const compressed = deflateSync(proto.HistorySync.encode({ syncType: proto.HistorySync.HistorySyncType.ON_DEMAND, conversations: [{ id: "anchor@lid", messages: [{ message: { key: { id: "remote-old", remoteJid: "anchor@lid", fromMe: true }, messageTimestamp: Math.floor(Date.now()/1000) - 86400, message: { conversation: "synthetic original" } } }] }] }).finish());
 const packet = (fromMe: boolean, id?: string) => ({ key: { id: "notification", remoteJid: "anchor@lid", fromMe }, messageTimestamp: Math.floor(Date.now()/1000), message: { protocolMessage: { historySyncNotification: { initialHistBootstrapInlinePayload: compressed, ...(id ? { peerDataRequestSessionId: id } : {}) } } } });
 for (const value of [packet(false, "correlated-request"), packet(true, "foreign-id"), packet(true)]) ev.emit("messages.upsert", { type: "notify", messages: [value] });
 await delay(30); assert.equal(f.vault.get(f.scope)?.historyOperation?.messages, 0);
 ev.emit("messages.upsert", { type: "notify", messages: [packet(true, "correlated-request")] }); await until(() => f.vault.get(f.scope)?.historyOperation?.messages === 1);
 const deliveries = await f.journal.pull(f.scope, 5); assert.ok(deliveries.some((d) => d.event.type === "sync.batch" && d.event.correlationId === s.id && d.event.data.historical)); assert.equal(requests, 1);
 await transport.history!({ commandId: randomUUID(), operationId: s.id, action: "pause", authorization }); transport.close(); await delay(550);
});
