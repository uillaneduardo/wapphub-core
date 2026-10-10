import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { envelope, EventJournal } from "../src/events.js";
import { Vault } from "../src/vault.js";
import { fixture } from "./helpers.js";

test("journal validates normalized scope and deduplicates even after ack and restart", async (t) => {
  const f = await fixture(t);
  const event = { ...envelope(f.scope, "connection.updated", "test", "1"), data: { state: "DISCONNECTED", retryable: false } };
  assert.equal(await f.journal.append(f.scope, event), true); assert.equal(await f.journal.append(f.scope, event), false);
  await assert.rejects(f.journal.append(f.other, event), /EVENT_SCOPE_MISMATCH/);
  const [item] = await f.journal.pull(f.scope, 1); await f.journal.ack(f.scope, item!.event.eventId, item!.leaseId);
  await f.journal.ack(f.scope, item!.event.eventId, item!.leaseId);
  const vault = new Vault(f.vault.directory, f.key); await vault.initialize();
  assert.equal(await new EventJournal(vault).append(f.scope, event), false);
});
test("leases isolate competing consumers and stale acknowledgments cannot lose events", async (t) => {
  const f = await fixture(t);
  await f.journal.append(f.scope, { ...envelope(f.scope, "connection.updated", "test"), data: { state: "DISCONNECTED", retryable: false } });
  const results = await Promise.all([f.journal.pull(f.scope, 1), f.journal.pull(f.scope, 1)]);
  assert.equal(results.flat().length, 1); const old = results.flat()[0]!;
  f.advance(30_001); const [next] = await f.journal.pull(f.scope, 1);
  assert.equal(next!.event.eventId, old.event.eventId); assert.notEqual(next!.leaseId, old.leaseId);
  await assert.rejects(f.journal.ack(f.scope, old.event.eventId, old.leaseId), /STALE_EVENT_LEASE/);
  await f.journal.ack(f.scope, next!.event.eventId, next!.leaseId); assert.equal(f.journal.metrics().pending, 0);
});
test("negative acknowledgments back off into dead letter and allow explicit recovery", async (t) => {
  const f = await fixture(t);
  await f.journal.append(f.scope, { ...envelope(f.scope, "connection.updated", "test"), data: { state: "DISCONNECTED", retryable: false } });
  let eventId = "";
  for (let attempt = 1; attempt <= 5; attempt++) {
    const [item] = await f.journal.pull(f.scope, 1); assert.equal(item!.attempt, attempt); eventId = item!.event.eventId;
    await f.journal.nack(f.scope, eventId, item!.leaseId); assert.deepEqual(await f.journal.pull(f.scope, 1), []); f.advance(60_001);
  }
  assert.equal(f.journal.metrics().dead, 1); assert.equal(f.sessions.ready(), false);
  await f.journal.retryDead(f.scope, eventId); assert.equal(f.journal.metrics().dead, 0);
  assert.equal((await f.journal.pull(f.scope, 1))[0]!.attempt, 1);
});
test("expired deliveries recover from persisted leases after a process restart", async (t) => {
  const f = await fixture(t);
  await f.journal.append(f.scope, { ...envelope(f.scope, "connection.updated", "test"), data: { state: "DISCONNECTED", retryable: false } });
  const [old] = await f.journal.pull(f.scope, 1);
  const vault = new Vault(f.vault.directory, f.key); await vault.initialize(); const journal = new EventJournal(vault, f.now);
  assert.deepEqual(await journal.pull(f.scope, 1), []); f.advance(30_001);
  const [next] = await journal.pull(f.scope, 1); assert.equal(next!.attempt, 2); assert.equal(next!.event.eventId, old!.event.eventId);
});
test("raw payloads, media and secrets cannot enter the text-only service journal", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.journal.append(f.scope, { ...envelope(f.scope, "connection.updated", "test"), raw: "TEST_SECRET", data: { state: "DISCONNECTED", retryable: false } }), /INVALID_PROVIDER_EVENT/);
  await assert.rejects(f.journal.append(f.scope, { ...envelope(f.scope, "media.updated", "media"), data: { messageId: randomUUID(), media: { mediaId: randomUUID(), type: "IMAGE", mimeType: "image/png", fileName: "a.png", size: 1, state: "READY" } } }), /UNSUPPORTED_PROVIDER_CONTENT/);
});
