import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes, randomUUID, createHash, createHmac } from "node:crypto";
import { WebProviderClient, WebProviderError } from "../src/integrations/web-provider-client.js";
import { loadConfig } from "../src/infrastructure/config.js";
const view = { state: "DISCONNECTED", revision: 0, qrRevision: 0, attempts: 0, connectEnabled: false };
test("Core client authenticates scoped HTTP commands with CP2 wire protocol and parses real responses", async (t) => {
  const key = randomBytes(32), scope = { organizationId: randomUUID(), connectionId: randomUUID() }, paths: string[] = [];
  const server = createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : null; const { headers, method, url } = request; paths.push(url!);
    const digest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const expected = createHmac("sha256", key).update(JSON.stringify([1, "core", method, url, headers["x-wapphub-timestamp"], headers["x-wapphub-nonce"], digest])).digest("hex");
    assert.equal(headers["x-wapphub-signature"], expected); assert.equal(headers["x-wapphub-client"], "core");
    assert.ok(url!.includes(scope.organizationId) && url!.includes(scope.connectionId)); response.setHeader("content-type", "application/json");
    if (url!.endsWith("/commands")) { assert.equal(body.action, "refresh"); response.end(JSON.stringify({ ...view, state: "CONNECTING", revision: 1 })); }
    else response.end(JSON.stringify(view));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
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
