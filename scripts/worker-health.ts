import { loadConfig } from "../src/infrastructure/config.js";
import { connections } from "../src/infrastructure/connections.js";
const resources = connections(loadConfig());
try {
  await Promise.all([resources.db.$queryRaw`SELECT 1`, resources.redis.ping()]);
  await resources.close();
} catch {
  process.exit(1);
}
