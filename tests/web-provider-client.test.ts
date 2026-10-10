import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import Fastify from "fastify";
import { randomBytes, randomUUID, createHash, createHmac } from "node:crypto";
import { WebProviderClient, WebProviderError } from "../src/integrations/web-provider-client.js";
import { loadConfig } from "../src/infrastructure/config.js";
const view = { state: "DISCONNECTED", revision: 0, qrRevision: 0, attempts: 0, connectEnabled: false };
test("Core client authenticates scoped Fastify HTTP commands including empty PUT with CP2 wire protocol and parses real responses", async (t) => {
  const key = randomBytes(32), scope = { organizationId: randomUUID(), connectionId: randomUUID() }, paths: string[] = [];
  const app = Fastify({ logger: false });
  app.all("/*", async (request) => {
    const body = request.body ?? null; const { headers, method, url } = request; paths.push(url);
    const digest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const expected = createHmac("sha256", key).update(JSON.stringify([1, "core", method, url, headers["x-wapphub-timestamp"], headers["x-wapphub-nonce"], digest])).digest("hex");
    assert.equal(headers["x-wapphub-signature"], expected); assert.equal(headers["x-wapphub-client"], "core");
    assert.ok(url.includes(scope.organizationId) && url.includes(scope.connectionId));
    if (url.endsWith("/commands")) { assert.equal((body as { action: string }).action, "refresh"); return { ...view, state: "CONNECTING", revision: 1 }; }
    assert.equal(headers["content-type"], undefined, "Empty commands must not trigger Fastify's empty JSON body rejection");
    return view;
  });
  await app.listen({ host: "127.0.0.1", port: 0 }); t.after(() => app.close());
  const server = app.server;
  const address = server.address(); assert.ok(address && typeof address !== "string"); const client = new WebProviderClient(`http://127.0.0.1:${address.port}`, key);
  assert.equal((await client.create(scope)).state, "DISCONNECTED"); assert.equal((await client.command(scope, "refresh", randomUUID())).state, "CONNECTING"); assert.equal(paths.length, 2);
});
test("Core client rejects redirects, oversized responses and sensitive provider error details", async (t) => {
  let mode = "error", redirected = false;
  const server = createServer((_request, response) => {
    if (mode === "redirect") { response.writeHead(302, { location: "/capture" }); response.end(); }
    else if (mode === "large") response.end("x".repeat(300000));
    else { response.writeHead(503, { "content-type": "application/json" }); response.end(JSON.stringify({ error: { code: "SECRET_AUTH_DETAIL", credentials: "SENSITIVE" } })); }
    if (_request.url === "/capture") redirected = true;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string"); const client = new WebProviderClient(`http://127.0.0.1:${address.port}`, randomBytes(32)), scope = { organizationId: randomUUID(), connectionId: randomUUID() };
  for (mode of ["error", "redirect", "large"]) await assert.rejects(client.session(scope), (error: unknown) => error instanceof WebProviderError && error.code === "PROVIDER_UNAVAILABLE" && !JSON.stringify(error).includes("SENSITIVE"));
  assert.equal(redirected, false);
});
test("production provider configuration cannot redirect Core authority to a public service", () => {
  const env = { ...process.env, NODE_ENV: "production", PROVIDER_WEB_ENABLED: "true", WEB_ORIGINS: "https://web-client.example.test" };
  for (const url of ["https://provider-web:3000", "http://attacker.example", "http://provider-web:3000/internal", "http://user:password@provider-web:3000", "http://provider-web:3000?target=external"]) assert.throws(() => loadConfig({ ...env, PROVIDER_WEB_URL: url }));
  assert.equal(loadConfig({ ...env, PROVIDER_WEB_URL: "http://provider-web:3000" }).PROVIDER_WEB_ENABLED, true);
});
