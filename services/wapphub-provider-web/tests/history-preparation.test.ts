import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEventBuffer } from "baileys";
import pino from "pino";
import { fixture } from "./helpers.js";
import { Vault } from "../src/vault.js";
import { EventJournal } from "../src/events.js";
import { baileysFactory } from "../src/baileys.js";
import { normalizeSyncMessage } from "../src/sync-normalization.js";
import type { SyncItem } from "../../../contracts/provider.js";

test("history preparation sustains 500 contacts, 500 conversations and 1000 messages with live priority and restart", async (t) => {
  const f = await fixture(t); await f.sessions.create(f.scope);
  const started = performance.now(), cpu = process.cpuUsage(); let peakRss = process.memoryUsage().rss, liveQueueLatencyMs = 0;
  const timestamp = Math.floor((Date.now() - 86400000) / 1000);
  const message = (id: string, index: number) => normalizeSyncMessage(f.scope, {
    key: { id, remoteJid: `synthetic-${index % 500}@lid`, fromMe: index % 2 === 0 },
    messageTimestamp: timestamp, message: { conversation: " *Maria:* conteúdo sintético preservado " },
  })!;
  const items: SyncItem[] = [
    ...Array.from({ length: 500 }, (_, i): SyncItem => ({ kind: "contact", identity: { externalId: `synthetic-${i}@lid` } })),
    ...Array.from({ length: 500 }, (_, i): SyncItem => ({ kind: "conversation", identity: { externalId: `synthetic-${i}@lid` } })),
    ...Array.from({ length: 1000 }, (_, i) => message(`synthetic-history-${i}`, i)),
  ];
  const accepted = { contact: 0, conversation: 0, message: 0 }; let batches = 0, liveMessages = 0;
  for (let offset = 0; offset < items.length; offset += 20) {
    await f.journal.stage(f.scope, items.slice(offset, offset + 20), true, true);
    if (offset === 1000) await f.journal.stage(f.scope, [message("synthetic-live-priority", 0)], false, false);
    // Restore from disk while historical work is pending, without a socket.
    const vault = offset === 1000 ? new Vault(f.vault.directory, f.key) : f.vault;
    if (vault !== f.vault) await vault.initialize();
    const journal = vault === f.vault ? f.journal : new EventJournal(vault, f.now);
    const liveStarted = performance.now();
    const deliveries = await journal.pull(f.scope, 2);
    if (offset === 1000) {
      assert.ok(deliveries[0]?.event.type === "sync.batch" && !deliveries[0].event.data.historical);
      liveQueueLatencyMs = performance.now() - liveStarted;
    }
    for (const delivery of deliveries) {
      assert.equal(delivery.event.type, "sync.batch");
      if (delivery.event.type !== "sync.batch") continue;
      assert.ok(delivery.event.data.items.length <= 20);
      assert.ok(Buffer.byteLength(JSON.stringify(delivery.event)) < 64 * 1024);
      for (const item of delivery.event.data.items) {
        if (!delivery.event.data.historical) { liveMessages++; continue; }
        accepted[item.kind]++;
        if (item.kind === "message") {
          assert.equal(item.occurredAt, new Date(timestamp * 1000).toISOString());
          assert.equal(item.message.content.originalBody, " *Maria:* conteúdo sintético preservado ");
          assert.equal(item.message.sender.userId, undefined);
          assert.ok(["DEVICE", "CONTACT"].includes(item.message.sender.origin));
        }
      }
      await journal.ack(f.scope, delivery.event.eventId, delivery.leaseId); batches++;
    }
    if (vault !== f.vault) await f.vault.initialize();
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }
  assert.deepEqual(accepted, { contact: 500, conversation: 500, message: 1000 }); assert.equal(liveMessages, 1);
  await f.journal.stage(f.scope, [items[0]!, items[500]!, items[1000]!], true, true);
  assert.equal(f.vault.get(f.scope)?.sync?.pending.length, 0);
  assert.equal(f.vault.get(f.scope)?.sync?.failures, 0);
  assert.equal(f.stats().starts, 0);
  const usage = process.cpuUsage(cpu);
  console.log(JSON.stringify({ metric: "history.preparation.provider", accepted, liveMessages, batches, durationMs: Math.round(performance.now() - started), cpuMs: (usage.user + usage.system) / 1000, peakRssBytes: peakRss, liveQueueLatencyMs: Math.round(liveQueueLatencyMs), realAccounts: 0 }));
});

test("contacts and conversations synchronize independently while historical messages remain disabled", async (t) => {
  const f = await fixture(t), ev = makeEventBuffer(pino({ level: "silent" }));
  const batches: { items: SyncItem[]; historical: boolean }[] = [];
  const transport = await baileysFactory(f.vault, () => ({ ev, end: async () => undefined, logout: async () => assert.fail("no logout") }), { enabled: true, historyEnabled: false })(f.scope, {
    connection: () => undefined, text: () => undefined, receipt: () => undefined, failure: () => assert.fail("unexpected failure"),
    sync: (items, historical) => { batches.push({ items, historical }); },
  });
  ev.emit("messaging-history.set", { contacts: [{ id: "old-only@lid" }], chats: [], messages: [] });
  ev.emit("contacts.upsert", [{ id: "independent@lid", name: "Contato sintético" }]);
  ev.emit("chats.upsert", [{ id: "independent@lid" }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(batches.flatMap((b) => b.items).map((i) => i.kind), ["contact", "conversation"]);
  assert.ok(batches.every((b) => !b.historical));
  transport.close();
});
