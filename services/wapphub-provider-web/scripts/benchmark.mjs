import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { Buffer } from "node:buffer";
import { Vault } from "../dist/services/wapphub-provider-web/src/vault.js";
import { EventJournal, envelope } from "../dist/services/wapphub-provider-web/src/events.js";

const directory = await mkdtemp(join(tmpdir(), "provider-synthetic-load-"));
try {
  const vault = new Vault(directory, randomBytes(32)); await vault.initialize();
  const journal = new EventJournal(vault);
  const scopes = Array.from({ length: 10 }, () => ({ organizationId: randomUUID(), connectionId: randomUUID() }));
  const latencies = [], cpuStart = process.cpuUsage(), memoryStart = process.memoryUsage().rss, start = performance.now();
  let maxEventBytes = 0;
  for (let i = 0; i < 200; i++) {
    const scope = scopes[i % scopes.length];
    const event = { ...envelope(scope, "message.received", `synthetic-${i}`), data: {
      providerMessageId: `synthetic-${i}`, providerConversationId: "synthetic@s.whatsapp.net",
      sender: { origin: "CONTACT", externalId: "synthetic@s.whatsapp.net" }, direction: "INBOUND",
      content: { type: "TEXT", originalBody: "Synthetic test — no network or real messages" }, status: "SENT",
    } };
    maxEventBytes = Math.max(maxEventBytes, Buffer.byteLength(JSON.stringify(event)));
    const operation = performance.now(); await journal.append(scope, event); latencies.push(performance.now() - operation);
  }
  const peakQueues = journal.metrics();
  for (const scope of scopes) for (const item of await journal.pull(scope, 20)) await journal.ack(scope, item.event.eventId, item.leaseId);
  const elapsedMs = performance.now() - start, cpu = process.cpuUsage(cpuStart); latencies.sort((a, b) => a - b);
  globalThis.console.log(JSON.stringify({ scope: "encrypted durable journal on local filesystem; synthetic; no WhatsApp/API/Redis", runtime: process.version,
    events: 200, tenants: 10, maxEventBytes, elapsedMs, appendP50Ms: latencies[100], appendP95Ms: latencies[190], appendP99Ms: latencies[198],
    cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000, rssStartBytes: memoryStart, rssEndBytes: process.memoryUsage().rss,
    peakQueues, finalQueues: journal.metrics() }, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
