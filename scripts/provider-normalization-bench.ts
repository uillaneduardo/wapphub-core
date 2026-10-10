import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { parseProviderEvent, demoCapabilities, providerDeduplicationId } from "../contracts/provider.js";
const tenants = Array.from({ length: 20 }, () => ({ organizationId: randomUUID(), connectionId: randomUUID() }));
const wire = tenants.map((scope, i) => JSON.stringify({
  ...scope, version: 1, provider: "DEMO", type: "message.received", eventId: randomUUID(), correlationId: randomUUID(), occurredAt: new Date().toISOString(),
  deduplicationId: providerDeduplicationId({ ...scope, provider: "DEMO", type: "message.received", externalId: `synthetic-${i}` }), capabilities: demoCapabilities,
  data: { providerMessageId: `synthetic-${i}`, providerConversationId: `synthetic-conversation-${i}`, sender: { origin: "CONTACT", externalId: `synthetic-contact-${i}` }, direction: "INBOUND", content: { type: "TEXT", originalBody: "Synthetic text " + "x".repeat(512) }, status: "SENT" },
}));
for (let i = 0; i < 200; i++) parseProviderEvent(wire[i % wire.length]);
const before = process.memoryUsage(), cpuStart = process.cpuUsage(), started = performance.now(), durations: number[] = [];
for (let i = 0; i < 3000; i++) {
  const at = performance.now(); parseProviderEvent(wire[i % wire.length]); durations.push(performance.now() - at);
}
const elapsedMs = performance.now() - started, cpu = process.cpuUsage(cpuStart), after = process.memoryUsage();
durations.sort((a, b) => a - b);
const percentile = (p: number) => durations[Math.min(durations.length - 1, Math.ceil(durations.length * p) - 1)];
console.log(JSON.stringify({
  scope: "In-process normalized event JSON parse/validation only; no network, queue, media or WhatsApp account", syntheticEvents: durations.length, syntheticTenants: tenants.length,
  maxEventBytes: Math.max(...wire.map((body) => Buffer.byteLength(body))), elapsedMs,
  latencyMs: { p50: percentile(.5), p95: percentile(.95), p99: percentile(.99) }, eventsPerSecond: durations.length / (elapsedMs / 1000),
  cpuMs: { user: cpu.user / 1000, system: cpu.system / 1000 }, memoryBytes: { rssBefore: before.rss, rssAfter: after.rss, heapBefore: before.heapUsed, heapAfter: after.heapUsed },
  queueMeasurements: null, notes: "Microbenchmark, not end-to-end performance, external provider latency, agent capacity or SLA. No outbound traffic.",
}, null, 2));
