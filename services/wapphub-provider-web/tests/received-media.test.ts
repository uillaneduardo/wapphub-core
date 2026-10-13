import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Readable, PassThrough } from "node:stream";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { BufferJSON, type WAMessage } from "baileys";
import { ProviderMedia } from "../src/media.js";
import { mediaPath } from "../src/media-reference.js";
import { normalizeSyncMessage } from "../src/sync-normalization.js";
import { Vault } from "../src/vault.js";
import { createHttp } from "../src/http.js";
import { signedHeaders } from "../../../contracts/provider-internal.js";
import { fixture } from "./helpers.js";

const cases = [
  { type: "IMAGE", field: "imageMessage", mime: "image/png", bytes: Buffer.from("89504e470d0a1a0a001122", "hex") },
  { type: "AUDIO", field: "audioMessage", mime: "audio/mpeg", bytes: Buffer.from("ID3synthetic") },
  { type: "VOICE", field: "audioMessage", mime: "audio/ogg", bytes: Buffer.from("OggSsynthetic") },
  { type: "VIDEO", field: "videoMessage", mime: "video/mp4", bytes: Buffer.from("00000018667479706d703432", "hex") },
] as const;
function envelope(example: typeof cases[number], reference: { directPath?: string; url?: string }): WAMessage {
  return { key: { remoteJid: "5581999999999@s.whatsapp.net", id: randomUUID(), fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000), message: { [example.field]: { ...reference, mediaKey: Buffer.alloc(32, 7), fileSha256: createHash("sha256").update(example.bytes).digest(), fileLength: example.bytes.length, mimetype: example.mime + (example.type === "VOICE" ? "; codecs=opus" : ""), ptt: example.type === "VOICE" } } };
}
function mediaId(scope: { organizationId: string; connectionId: string }, message: WAMessage) {
  const normalized = normalizeSyncMessage(scope, message); assert.ok(normalized?.kind === "message" && normalized.message.content.type !== "TEXT"); return normalized.message.content.media.mediaId;
}
test("received IMAGE/AUDIO/VOICE/VIDEO retain query and URL-only references, download on demand and survive restart", async t => {
  const f = await fixture(t); await f.sessions.create(f.scope);
  let downloads = 0; const codes: string[] = [];
  for (const example of cases) for (const reference of [{ directPath: "/v/t62/synthetic.enc?auth=SYNTHETIC_ONLY&x=%2B" }, { url: "https://mmg.whatsapp.net/v/t62/synthetic.enc?auth=SYNTHETIC_ONLY&x=%2B" }]) {
    const message = envelope(example, reference), id = mediaId(f.scope, message);
    const media = new ProviderMedia(f.vault, true, code => codes.push(code), async (ref, type, options) => {
      downloads++; assert.equal(ref.directPath, "/v/t62/synthetic.enc?auth=SYNTHETIC_ONLY&x=%2B"); assert.equal(ref.url, undefined); assert.equal(type, example.type === "VOICE" ? "audio" : example.type.toLowerCase()); assert.equal(options?.host, "mmg.whatsapp.net"); assert.equal(options?.options?.redirect, "error"); assert.ok(options?.options?.signal); return Readable.from([example.bytes]);
    });
    await media.retain(f.scope, message); await media.retain(f.scope, message); assert.equal(downloads, (cases.indexOf(example) * 2) + ("url" in reference ? 1 : 0));
    assert.equal(f.vault.get(f.scope)!.media!.filter(r => r.id === id).length, 1);
    const result = await media.read(f.scope, id); const chunks = []; for await (const chunk of result.stream) chunks.push(chunk); assert.deepEqual(Buffer.concat(chunks), example.bytes);
    const restored = new Vault(f.vault.directory, f.key); await restored.initialize();
    const cached = await new ProviderMedia(restored, true, undefined, async () => { throw Error("must use existing cache"); }).read(f.scope, id); assert.equal(cached.record.mimeType, example.mime); cached.stream.destroy();
    assert.equal(downloads, (cases.indexOf(example) * 2) + ("url" in reference ? 2 : 1));
    assert.equal(codes.at(-1), "MEDIA_REFERENCE_RETAINED");
  }
  assert.equal(downloads, 8); assert.ok(codes.every(code => /^MEDIA_[A-Z_]+$/.test(code)));
});
test("media origin rejects SSRF, redirects, credentials, controls, traversal and malformed references", () => {
  for (const ref of ["http://mmg.whatsapp.net/a", "https://mmg.whatsapp.net.evil.test/a", "https://localhost/a", "https://127.0.0.1/a", "https://169.254.169.254/a", "https://[::1]/a", "https://mmg.whatsapp.net:444/a", "https://a@mmg.whatsapp.net/a", "//evil.test/a", "/a#fragment", "/a\\b", "/a\nb", "/a?x=%0d%0a", "/a?x=%5c", "/a?x=%ZZ", "/a/../b", "/%2e%2e/b", "https://mmg.whatsapp.net/a#x", "/" + "x".repeat(2048)]) assert.equal(mediaPath(undefined, ref), undefined, ref);
  assert.equal(mediaPath("/a?auth=synthetic&k=%2B"), "/a?auth=synthetic&k=%2B");
  assert.equal(mediaPath("/a"), "/a");
});
test("rejecting references logs only reason codes and keeps media/message IDs private", async t => {
  const f = await fixture(t); await f.sessions.create(f.scope); const codes: string[] = [];
  const media = new ProviderMedia(f.vault, true, code => codes.push(code));
  const message = envelope(cases[0], { url: "http://localhost/secret?token=PRIVATE" }); await media.retain(f.scope, message);
  const badKey = envelope(cases[0], { directPath: "/synthetic" }); badKey.message!.imageMessage!.mediaKey = Buffer.alloc(31); await media.retain(f.scope, badKey);
  assert.deepEqual(codes, ["MEDIA_REFERENCE_REJECTED", "MEDIA_METADATA_REJECTED"]); assert.equal(f.vault.get(f.scope)!.media?.length ?? 0, 0);
});
test("missing, expired and foreign media remain distinct from disabled capability and remote failure", async t => {
  const f = await fixture(t); await f.sessions.create(f.scope);
  const message = envelope(cases[0], { directPath: "/synthetic?x=1" }), id = mediaId(f.scope, message);
  const media = new ProviderMedia(f.vault, true, undefined, async () => { throw Error("private download failure"); }); await media.retain(f.scope, message);
  await assert.rejects(media.read(f.scope, randomUUID()), { code: "MEDIA_UNAVAILABLE", statusCode: 404 });
  await assert.rejects(media.read(f.other, id), { code: "SESSION_NOT_FOUND", statusCode: 404 });
  await assert.rejects(new ProviderMedia(f.vault, false).read(f.scope, id), { code: "MEDIA_DISABLED", statusCode: 403 });
  await assert.rejects(media.read(f.scope, id), { code: "MEDIA_UNAVAILABLE", statusCode: 503 });
  const expired = new ProviderMedia(f.vault, true, undefined, async () => { throw Object.assign(new Error("private signed URL"), { output: { statusCode: 404 } }); });
  await assert.rejects(expired.read(f.scope, id), { code: "MEDIA_EXPIRED", statusCode: 410 });
  await f.vault.update(f.scope, r => { r.media![0]!.expiresAt = Date.now() - 1; });
  await assert.rejects(media.read(f.scope, id), { code: "MEDIA_EXPIRED", statusCode: 410 });
  // A legitimate repeat can renew an expired reference without changing ID.
  await media.retain(f.scope, message); assert.ok(f.vault.get(f.scope)!.media![0]!.expiresAt > Date.now());
});
test("download timeout is bounded and releases the transfer guard", async t => {
  const f=await fixture(t);await f.sessions.create(f.scope);const message=envelope(cases[0],{directPath:"/synthetic"}),id=mediaId(f.scope,message);
  const timeout=AbortSignal.timeout.bind(AbortSignal);t.mock.method(AbortSignal,"timeout",()=>timeout(20));
  const media=new ProviderMedia(f.vault,true,undefined,async(_r,_t,options)=>new Promise((_resolve,reject)=>{options!.options!.signal!.addEventListener("abort",()=>reject(Error("synthetic timeout")),{once:true});}));
  const alive=setTimeout(()=>undefined,1000);try{await media.retain(f.scope,message);await assert.rejects(media.read(f.scope,id),{code:"MEDIA_TRANSFER_TIMEOUT",statusCode:408});}finally{clearTimeout(alive);}
});
test("interrupted download deletes parts, frees transfer guard and preserves a valid cache", async t => {
  const f = await fixture(t); await f.sessions.create(f.scope);
  const message = envelope(cases[0], { directPath: "/synthetic?x=1" }), id = mediaId(f.scope, message), controller = new AbortController(), source = new PassThrough();
  const media = new ProviderMedia(f.vault, true, undefined, async () => source); await media.retain(f.scope, message);
  const pending = media.read(f.scope, id, controller.signal); source.write(cases[0].bytes.subarray(0, 8));
  const failure = assert.rejects(pending, { code: "MEDIA_TRANSFER_CANCELLED", statusCode: 499 });
  for (let i = 0; i < 50 && !(await readdir(join(f.vault.directory, "files")).catch(() => [] as string[])).some(f => f.endsWith(".part")); i++) await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort(); await failure; assert.ok(source.destroyed); assert.ok((await readdir(join(f.vault.directory, "files"))).every(f => !f.endsWith(".part")));
  const good = new ProviderMedia(f.vault, true, undefined, async () => Readable.from([cases[0].bytes])); const result = await good.read(f.scope, id); result.stream.destroy();
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(good.read(f.scope, id, aborted.signal));
  assert.ok(await f.vault.privateFiles().has(f.scope, id));
});
test("download validates size, SHA and MIME before caching or releasing bytes", async t => {
  const f = await fixture(t); await f.sessions.create(f.scope);
  for (const bad of [Buffer.from("bad"), Buffer.alloc(cases[0].bytes.length), Buffer.alloc(cases[0].bytes.length + 1)]) {
    const message = envelope(cases[0], { directPath: "/synthetic" }), id = mediaId(f.scope, message), media = new ProviderMedia(f.vault, true, undefined, async () => Readable.from([bad]));
    await media.retain(f.scope, message); await assert.rejects(media.read(f.scope, id), error => error instanceof Error && /MEDIA_(INTEGRITY_FAILED|SIZE_MISMATCH)/.test(error.message)); assert.equal(await f.vault.privateFiles().has(f.scope, id), false);
  }
  const message = envelope(cases[0], { directPath: "/synthetic" }); message.message!.imageMessage!.fileSha256 = createHash("sha256").update(Buffer.alloc(cases[0].bytes.length)).digest();
  const id = mediaId(f.scope, message), media = new ProviderMedia(f.vault, true, undefined, async () => Readable.from([Buffer.alloc(cases[0].bytes.length)])); await media.retain(f.scope, message); await assert.rejects(media.read(f.scope, id), { code: "MEDIA_TYPE_MISMATCH", statusCode: 415 });
});
test("legacy private reference remains valid and signed HTTP returns correct bytes and metadata", async t => {
  const f = await fixture(t); await f.sessions.create(f.scope); const bytes = cases[0].bytes, id = randomUUID(), hash = createHash("sha256").update(bytes).digest("hex");
  await f.vault.update(f.scope, r => { r.media = [{ id, type: "IMAGE", mimeType: "image/png", fileName: "legacy", size: bytes.length, sha256: hash, expiresAt: Date.now() + 3600000, reference: JSON.stringify({ directPath: "/legacy.enc", mediaKey: Buffer.alloc(32, 1) }, BufferJSON.replacer) }]; });
  const media = new ProviderMedia(f.vault, true, undefined, async () => Readable.from([bytes])), app = createHttp(f.sessions, f.journal, f.auth, undefined, media); t.after(() => app.close());
  const path = f.path + "/media/" + id, response = await app.inject({ method: "GET", url: path, headers: signedHeaders(f.internalKey, "GET", path) });
  assert.equal(response.statusCode, 200); assert.equal(response.headers["x-media-sha256"], hash); assert.deepEqual(response.rawPayload, bytes);
});
test("closing the signed HTTP request cancels Provider download and removes incomplete files", async t => {
  const f = await fixture(t); await f.sessions.create(f.scope);
  const message = envelope(cases[0], { directPath: "/synthetic?x=1" }), id = mediaId(f.scope,message), source = new PassThrough();
  let started!: () => void; const downloading = new Promise<void>(resolve => { started = resolve; });
  let signal: AbortSignal | undefined;
  const media = new ProviderMedia(f.vault,true,undefined,async (_r,_t,options) => { signal = options?.options?.signal ?? undefined; started(); return source; }); await media.retain(f.scope,message);
  const app = createHttp(f.sessions,f.journal,f.auth,undefined,media); t.after(() => app.close()); await app.listen({ host: "127.0.0.1", port: 0 });
  const path = f.path + "/media/" + id, abort = new AbortController();
  const request = fetch(app.listeningOrigin + path, { headers: signedHeaders(f.internalKey,"GET",path), signal: abort.signal }); const rejected = assert.rejects(request);
  await downloading; abort.abort(); await rejected;
  for(let i=0;i<100 && !source.destroyed;i++) await new Promise(resolve => setTimeout(resolve,5));
  assert.equal(signal?.aborted,true); assert.equal(source.destroyed,true);
  for(let i=0;i<100 && (await readdir(join(f.vault.directory,"files")).catch(() => [] as string[])).some(f=>f.endsWith(".part"));i++) await new Promise(resolve => setTimeout(resolve,5));
  assert.ok((await readdir(join(f.vault.directory,"files")).catch(() => [] as string[])).every(f=>!f.endsWith(".part")));
});
