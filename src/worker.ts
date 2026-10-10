import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "./infrastructure/config.js";
import { connections } from "./infrastructure/connections.js";
import { configuredWebProvider } from "./integrations/web-provider-client.js";
import { DemoProvider } from "./integrations/demo-provider.js";
import { MessageIngestionService } from "./application/message-ingestion.js";
import { Chat } from "./application/chat.js";
import { WebProviderWorker } from "./application/web-provider-worker.js";
const config = loadConfig(), resources = connections(config);
let stopping = false;
const abort = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { stopping = true; abort.abort(); });
const log = (code: string) => process.stdout.write(JSON.stringify({ code, time: new Date().toISOString() }) + "\n");
try {
  await Promise.all([resources.db.$queryRaw`SELECT 1`, resources.redis.ping()]);
  const client = await configuredWebProvider(config);
  const chat = new Chat(resources.db, config, async (org) => { await resources.redis.publish(`wapphub:realtime:${org}`, "wake"); }, new DemoProvider(), new MessageIngestionService());
  const worker = client ? new WebProviderWorker(resources.db, chat, client, log) : undefined;
  log(worker ? "PROVIDER_WORKER_READY" : "FOUNDATION_WORKER_READY");
  while (!stopping) {
    try { await worker?.tick(); } catch { log("PROVIDER_WORKER_TICK_FAILED"); }
    await writeFile("/tmp/wapphub-worker-heartbeat", String(Date.now()), { mode: 0o600 });
    await delay(worker ? 2000 : 10000, undefined, { signal: abort.signal }).catch(() => undefined);
  }
} catch { log("WORKER_STARTUP_FAILED"); process.exitCode = 1; }
finally { await resources.close(); }
