import SwaggerParser from "@apidevtools/swagger-parser";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../src/infrastructure/config.js";
import { connections } from "../src/infrastructure/connections.js";
import { buildApp } from "../src/http/app.js";
const config = loadConfig({ ...process.env, NODE_ENV: "production" });
const resources = connections(config),
  app = await buildApp(config, resources.db, resources.redis, false);
try {
  await app.ready();
  const doc = JSON.parse(await readFile("docs/openapi.json", "utf8"));
  await SwaggerParser.validate("docs/openapi.json");
  assert.deepEqual(doc, app.swagger());
  console.log(
    "Official OpenAPI validated; identical to production-mode route schemas",
  );
} finally {
  await app.close();
  await resources.close();
}
