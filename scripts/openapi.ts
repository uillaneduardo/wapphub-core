import { writeFile } from "node:fs/promises";
import { loadConfig } from "../src/infrastructure/config.js";
import { connections } from "../src/infrastructure/connections.js";
import { buildApp } from "../src/http/app.js";
// The committed public contract describes production cookies in every environment.
const config = loadConfig({ ...process.env, NODE_ENV: "production" });
const resources = connections(config);
const app = await buildApp(config, resources.db, resources.redis, false);
await app.ready();
await writeFile(
  "docs/openapi.json",
  JSON.stringify(app.swagger(), null, 2) + "\n",
);
await app.close();
await resources.close();
