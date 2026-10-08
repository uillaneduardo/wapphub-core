import { loadConfig } from "./infrastructure/config.js";
import { connections } from "./infrastructure/connections.js";
import { buildApp } from "./http/app.js";
async function main() {
  const config = loadConfig();
  const resources = connections(config);
  const app = await buildApp(config, resources.db, resources.redis);
  app.addHook("onClose", resources.close);
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => {
      void app.close();
    });
  await app.listen({ host: "0.0.0.0", port: config.PORT });
}
main().catch(() => {
  process.stderr.write("API startup failed\n");
  process.exit(1);
});
