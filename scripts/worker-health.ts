import { loadConfig } from "../src/infrastructure/config.js";
import { connections } from "../src/infrastructure/connections.js";
import { readFile } from "node:fs/promises";
const resources = connections(loadConfig());
try {
  await Promise.all([resources.db.$queryRaw`SELECT 1`, resources.redis.ping()]);
  const heartbeat = Number(await readFile("/tmp/wapphub-worker-heartbeat", "utf8"));
  if (!Number.isFinite(heartbeat) || Date.now() - heartbeat > 180000) throw new Error("STALE_WORKER");
  await resources.close();
} catch {
  await resources.close();
  process.exit(1);
}
