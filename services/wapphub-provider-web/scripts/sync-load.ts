import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { Vault } from "../src/vault.js";
import { EventJournal } from "../src/events.js";
import { normalizeSyncMessage } from "../src/sync-normalization.js";

const directory = await mkdtemp(join(tmpdir(), "wapphub-cp4-load-"));
const key = randomBytes(32), scope = { organizationId: randomUUID(), connectionId: randomUUID() };
const cpu = process.cpuUsage(), started = performance.now(); let peakRssBytes = process.memoryUsage().rss;
try {
  let vault = new Vault(directory, key); await vault.initialize();
  let journal = new EventJournal(vault);
  const message = (id: string) => normalizeSyncMessage(scope, { key: { id, remoteJid: "synthetic@lid", fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: "synthetic " + "x".repeat(512) } })!;
  for (let batch = 0; batch < 20; batch++) {
    await journal.stage(scope, Array.from({ length: 50 }, (_, index) => message(`history-${batch}-${index}`)), true, true, batch === 19);
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    if (batch === 9) { vault = new Vault(directory, key); await vault.initialize(); journal = new EventJournal(vault); }
  }
  const queuedPeak = journal.metrics().syncQueued, liveStart = performance.now();
  await journal.stage(scope, [message("live-priority")], false, false);
  let processed = 0, batches = 0, liveLatencyMs = 0, firstHistorical = false;
  while (journal.metrics().syncQueued || journal.metrics().pending) {
    for (const delivery of await journal.pull(scope, 8)) {
      if (delivery.event.type !== "sync.batch") throw new Error("unexpected synthetic event");
      if (!processed) { firstHistorical = delivery.event.data.historical; liveLatencyMs = performance.now() - liveStart; }
      if (delivery.event.data.items.length > 20) throw new Error("batch limit violated");
      processed += delivery.event.data.items.length; batches++;
      await journal.ack(scope, delivery.event.eventId, delivery.leaseId);
    }
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }
  if (processed !== 1001 || firstHistorical) throw new Error("loss or live priority regression");
  const usage = process.cpuUsage(cpu);
  console.log(JSON.stringify({ metric: "cp4.provider.synthetic", historicalMessages: 1000, liveMessages: 1, processed, batches, queuedPeak, queuedFinal: journal.metrics().syncQueued, pendingFinal: journal.metrics().pending, deadFinal: journal.metrics().dead, restartVerified: true, durationMs: Math.round(performance.now() - started), cpuMs: (usage.user + usage.system) / 1000, peakRssBytes, liveLatencyMs: Math.round(liveLatencyMs), accountTraffic: false }));
} finally { await rm(directory, { recursive: true, force: true }); }
