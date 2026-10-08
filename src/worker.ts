import { loadConfig } from "./infrastructure/config.js";
import { connections } from "./infrastructure/connections.js";
const resources = connections(loadConfig());
// M0 worker holds infrastructure connections; no jobs or domain polling yet.
Promise.all([resources.db.$queryRaw`SELECT 1`, resources.redis.ping()])
  .then(() => process.stdout.write("Foundation worker ready; no M0 jobs\n"))
  .catch(() => {
    process.stderr.write("Worker startup failed\n");
    process.exit(1);
  });
const keepAlive = setInterval(() => {}, 60000);
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    clearInterval(keepAlive);
    void resources.close().then(() => process.exit(0));
  });
