import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { WebProviderClient, publicMediaError, WebProviderError } from "../src/integrations/web-provider-client.js";
const scope = { organizationId: randomUUID(), connectionId: randomUUID() }, client = new WebProviderClient("http://synthetic.test", Buffer.alloc(32));
test("media client preserves safe errors, cancels rejected bodies and hides service authorization errors", async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  for (const [status, code, expectedStatus, expectedCode] of [[404,"MEDIA_UNAVAILABLE",404,"MEDIA_UNAVAILABLE"],[410,"MEDIA_EXPIRED",410,"MEDIA_EXPIRED"],[409,"MEDIA_INTEGRITY_FAILED",409,"MEDIA_INTEGRITY_FAILED"],[415,"MEDIA_TYPE_MISMATCH",415,"MEDIA_TYPE_MISMATCH"],[503,"MEDIA_UNAVAILABLE",503,"MEDIA_UNAVAILABLE"],[401,"PRIVATE_KEY_FAILURE",503,"MEDIA_UNAVAILABLE"],[403,"MEDIA_DISABLED",503,"MEDIA_UNAVAILABLE"],[404,"SESSION_NOT_FOUND",503,"MEDIA_UNAVAILABLE"]] as const) {
    let cancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ error: { code } }))); controller.close(); }, cancel() { cancelled = true; } }), { status });
    await assert.rejects(client.readMedia(scope, randomUUID()), { code: expectedCode, status: expectedStatus });
    // Closed bodies need no cancel callback; malformed/unconsumed cases below do.
    void cancelled;
  }
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4097)); }, cancel() { cancelled = true; } }), { status: 404 });
  await assert.rejects(client.readMedia(scope, randomUUID()), { code: "MEDIA_UNAVAILABLE", status: 503 }); assert.equal(cancelled, true);
  assert.deepEqual(publicMediaError(new WebProviderError("MEDIA_EXPIRED",403)), { code: "MEDIA_UNAVAILABLE", status: 503 });
});
test("destroy before consuming media cancels the remote body and fetch; browser abort works during a blocked read", async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  for (const consume of [false,true]) {
    let cancelled = false, signal: AbortSignal | undefined;
    const controller = new AbortController();
    globalThis.fetch = async (_url, init) => { signal = init?.signal ?? undefined; return new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); }, cancel() { cancelled = true; } }), { headers: { "content-length": "2", "content-type": "image/png", "x-media-sha256": "a".repeat(64) } }); };
    const result = await client.readMedia(scope, randomUUID(), controller.signal);
    const closed = once(result.stream, "close");
    if (consume) { result.stream.resume(); await once(result.stream,"data"); controller.abort(); } else result.stream.destroy();
    await closed; assert.equal(cancelled,true); assert.equal(signal?.aborted,true);
  }
});
test("media validates declared size/hash and rejects corrupt or incomplete bytes", async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const bytes = Buffer.from("synthetic"), hash = createHash("sha256").update(bytes).digest("hex");
  for (const [size,sha,ok] of [[bytes.length,hash,true],[bytes.length-1,hash,false],[bytes.length+1,hash,false],[bytes.length,"a".repeat(64),false]] as const) {
    globalThis.fetch = async () => new Response(bytes, { headers: { "content-length": String(size), "content-type": "image/png", "x-media-sha256": sha } });
    const result = await client.readMedia(scope, randomUUID()); const collect = async () => { const chunks = []; for await (const chunk of result.stream) chunks.push(chunk); return Buffer.concat(chunks); };
    if (ok) assert.deepEqual(await collect(),bytes); else await assert.rejects(collect(), { code: "MEDIA_INTEGRITY_FAILED", status: 409 });
  }
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-length": "999999999" } });
  await assert.rejects(client.readMedia(scope,randomUUID())); assert.equal(cancelled,true);
});
