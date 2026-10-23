import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { buildApp } from "../src/http/app.js";
import { loadConfig } from "../src/infrastructure/config.js";
import { digest, newToken, hashPassword } from "../src/infrastructure/crypto.js";
import { chatPermissions } from "../src/domain/chat.js";
import { Sessions } from "../services/wapphub-provider-web/src/sessions.js";
import { createHttp } from "../services/wapphub-provider-web/src/http.js";
import { InternalAuth } from "../services/wapphub-provider-web/src/auth.js";
import { WebProviderClient } from "../src/integrations/web-provider-client.js";
import type { TransportCallbacks } from "../services/wapphub-provider-web/src/transport.js";
import { Vault } from "../services/wapphub-provider-web/src/vault.js";
import { ProviderMedia } from "../services/wapphub-provider-web/src/media.js";
import { EventJournal } from "../services/wapphub-provider-web/src/events.js";
if (process.env.NODE_ENV !== "test" || !new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")) throw new Error("Upload tests require isolated test infrastructure");
const config = loadConfig({ ...process.env, NODE_ENV: "test", WEB_ORIGINS: "https://web-client.example.test", PROVIDER_WEB_ENABLED: "true" });
const db = new PrismaClient(), redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1 }); redis.on("error", () => {});
const origin = config.origins[0]!;
type Auth = { userId: string; sessionId: string; cookie: string; csrf: string };
let orgA: string, orgB: string, owner: Auth, other: Auth, denied: Auth, channelId: string;
const users: string[] = [], roles: string[] = [];
async function auth(organizationId: string, codes: readonly string[]): Promise<Auth> {
  const role = await db.role.create({ data: { code: `web-${randomUUID()}` } }); roles.push(role.id);
  for (const code of codes) { const permission = await db.permission.upsert({ where: { code }, create: { code }, update: {} }); await db.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } }); }
  const user = await db.user.create({ data: { name: "Synthetic web test", email: `${randomUUID()}@example.test`, passwordHash: await hashPassword(newToken()) } }); users.push(user.id);
  await db.membership.create({ data: { userId: user.id, organizationId, roleId: role.id } });
  const token = newToken(), csrf = newToken(); const session = await db.session.create({ data: { userId: user.id, tokenHash: digest(token), csrfHash: digest(csrf), currentOrganizationId: organizationId, expiresAt: new Date(Date.now() + 3600000) } });
  return { userId: user.id, sessionId: session.id, cookie: `wapphub_session=${token}`, csrf };
}
const scope = () => ({ organizationId: orgA, connectionId: channelId });
before(async () => {
 orgA = (await db.organization.create({ data: { name: `Upload A ${randomUUID()}` } })).id;
 orgB = (await db.organization.create({ data: { name: `Upload B ${randomUUID()}` } })).id;
 owner = await auth(orgA, [...chatPermissions, "providers.manage"]); other = await auth(orgB, chatPermissions); denied = await auth(orgA, ["conversations.read"]);
 channelId = (await db.channel.create({ data: { organizationId: orgA, provider: "WHATSAPP_WEB", status: "ENABLED" } })).id;
 await db.providerConnection.create({ data: { organizationId: orgA, channelId, state: "CONNECTED", lastCheckedAt: new Date(), outboundEnabled: true, mediaEnabled: true } });
 const contact = await db.contact.create({ data: { organizationId: orgA, name: "Synthetic upload", primaryIdentifier: `upload-${randomUUID()}` } });
 await db.conversation.create({ data: { organizationId: orgA, channelId, contactId: contact.id, assignedUserId: owner.userId } });
});
after(async () => {
 const where = { organizationId: { in: [orgA, orgB] } };
 await db.media.deleteMany({ where }); await db.realtimeEvent.deleteMany({ where }); await db.auditEvent.deleteMany({ where });
 await db.conversation.deleteMany({ where }); await db.providerConnection.deleteMany({ where }); await db.channel.deleteMany({ where }); await db.contact.deleteMany({ where });
 await db.session.deleteMany({ where: { userId: { in: users } } }); await db.membership.deleteMany({ where: { userId: { in: users } } }); await db.securityEvent.deleteMany({ where: { userId: { in: users } } }); await db.user.deleteMany({ where: { id: { in: users } } });
 await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } }); await db.rolePermission.deleteMany({ where: { roleId: { in: roles } } }); await db.role.deleteMany({ where: { id: { in: roles } } }); await db.$disconnect(); await redis.quit();
});

test("B5 HTTP binary upload streams through Core and signed Provider without blocking live journal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wapphub-b5-media-")), key = randomBytes(32), vault = new Vault(join(directory, "sessions"), key); await vault.initialize();
  const journal = new EventJournal(vault), internalKey = randomBytes(32), auth = new InternalAuth(internalKey, join(directory, "nonces")); await auth.initialize(); await mkdir(join(vault.directory, "files"), { recursive: true, mode: 0o700 });
  const providerCodes: string[] = []; let callbacks!: TransportCallbacks; const scopeValue = scope();
  const sessions = new Sessions(vault, journal, async (_scope, cb) => { callbacks = cb; return { close() {}, logout: async () => undefined }; }, true, () => () => undefined, Date.now, () => undefined, { enabled: false, historyEnabled: false, outboundEnabled: true });
  let providerStarted = () => {}, providerFinished = () => {};
  class ObservedMedia extends ProviderMedia {
    override async upload(...args: Parameters<ProviderMedia["upload"]>) {
      const [scope, input, source] = args, notify = providerStarted, finish = providerFinished;
      const observed = (async function* () { for await (const chunk of source) { notify(); yield chunk; } })();
      try { return await super.upload(scope, input, observed); } finally { finish(); }
    }
  }
  const source = createHttp(sessions, journal, auth, code => providerCodes.push(code), new ObservedMedia(vault, true)), sourceUrl = await source.listen({ host: "127.0.0.1", port: 0 }), client = new WebProviderClient(sourceUrl, internalKey);
  const activeConfig = { ...config, PROVIDER_OUTBOUND_ENABLED: true, PROVIDER_MEDIA_ENABLED: true }, mediaApp = await buildApp(activeConfig, db, redis, false, undefined, client);
  const thread = await db.conversation.findFirstOrThrow({ where: { organizationId: orgA, channelId, status: "OPEN" } });
  const original = await db.providerConnection.findUniqueOrThrow({ where: { organizationId_channelId: { organizationId: orgA, channelId } } });
  const originalThread = { assignedUserId: thread.assignedUserId, visibility: thread.visibility, visibleFromMessage: thread.visibleFromMessage, status: thread.status };
  const mediaIds: string[] = [];
  const imageBytes = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("synthetic-image")]), imageHash = createHash("sha256").update(imageBytes).digest("hex");
  const makeMeta = (overrides: Partial<{ mediaId: string; type: string; mimeType: string; fileName: string; size: number; sha256: string }> = {}) => ({ mediaId: randomUUID(), type: "IMAGE", mimeType: "image/png", fileName: "synthetic.png", size: imageBytes.length, sha256: imageHash, ...overrides });
  const uploadPath = (meta: ReturnType<typeof makeMeta>) => `/conversations/${thread.id}/media?${new URLSearchParams({ mediaId: meta.mediaId, type: meta.type, mimeType: meta.mimeType, fileName: meta.fileName, size: String(meta.size), sha256: meta.sha256 })}`;
  const upload = (a: Auth, meta: ReturnType<typeof makeMeta>, payload: Readable | Buffer = imageBytes, headers: Record<string, string> = {}) => mediaApp.inject({ method: "POST", url: "/api/v1" + uploadPath(meta), payload, headers: { "content-type": "application/octet-stream", origin, cookie: a.cookie, "x-csrf-token": a.csrf, ...headers } });
  const probeDir = join(directory, "probe-bin"), oldPath = process.env.PATH!; await mkdir(probeDir, { mode: 0o700 }); process.env.PATH = `${probeDir}:${oldPath}`;
  const probe = join(probeDir, "ffprobe"); await writeFile(probe, "#!/bin/sh\ncat >/dev/null\nprintf '%s' '{\"streams\":[{\"codec_type\":\"video\",\"codec_name\":\"png\"}],\"format\":{\"duration\":\"0\"}}'\n", { mode: 0o700 }); await chmod(probe, 0o700);
  try {
    await sessions.create(scopeValue); await sessions.command(scopeValue, "connect", randomUUID()); callbacks.connection({ state: "open" }); await sessions.settle(scopeValue);
    await db.providerConnection.update({ where: { organizationId_channelId: { organizationId: orgA, channelId } }, data: { state: "CONNECTED", errorCode: null, lastCheckedAt: new Date(), outboundEnabled: true, mediaEnabled: true } });
    await db.conversation.update({ where: { organizationId_id: { organizationId: orgA, id: thread.id } }, data: { assignedUserId: owner.userId, visibility: "FULL", visibleFromMessage: 0n, status: "OPEN" } });
    assert.equal((await mediaApp.inject({ method: "POST", url: "/api/v1" + uploadPath(makeMeta()), payload: imageBytes, headers: { origin, "content-type": "application/octet-stream" } })).statusCode, 401);
    assert.equal((await upload(owner, makeMeta(), imageBytes, { "x-csrf-token": "" })).statusCode, 403);
    assert.equal((await mediaApp.inject({ method: "POST", url: "/api/v1" + uploadPath(makeMeta()), payload: imageBytes, headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf, origin: "https://untrusted.invalid", "content-type": "application/octet-stream" } })).statusCode, 403);
    assert.equal((await upload(denied, makeMeta())).statusCode, 403);
    assert.ok((await upload(other, makeMeta())).statusCode >= 400);
    assert.ok((await mediaApp.inject({ method: "POST", url: "/api/v1" + uploadPath(makeMeta()), payload: imageBytes, headers: { origin, cookie: owner.cookie, "x-csrf-token": owner.csrf, "content-type": "application/json" } })).statusCode >= 400);
    const oversizedPayload = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(8 * 1024 * 1024 + 1 - 8)]), oversizedHash = createHash("sha256").update(oversizedPayload).digest("hex");
    assert.equal((await upload(owner, makeMeta({ size: oversizedPayload.length, sha256: oversizedHash }), oversizedPayload)).statusCode, 415);
    assert.ok((await upload(owner, makeMeta({ sha256: "0".repeat(64) }))).statusCode >= 400);
    assert.ok((await upload(owner, makeMeta({ mimeType: "image/jpeg", fileName: "synthetic.jpg" }))).statusCode >= 400);
    assert.ok(!(await readdir(join(vault.directory, "files"))).some(name => name.endsWith(".part")));

    let continueUpload!: () => void, uploadStarted!: () => void; const started = new Promise<void>(resolve => { uploadStarted = resolve; }), releaseUpload = new Promise<void>(resolve => { continueUpload = resolve; });
    const validMeta = makeMeta(), slowStream = Readable.from((async function* () { yield imageBytes.subarray(0, 12); uploadStarted(); await releaseUpload; yield imageBytes.subarray(12); })());
    const pendingUpload = upload(owner, validMeta, slowStream); await started;
    callbacks.text({ id: "b5-live-during-upload", chatId: "5581999999999@s.whatsapp.net", body: "Synthetic live during upload", fromMe: false, timestamp: Date.now() }); await sessions.settle(scopeValue);
    assert.ok((await journal.pull(scopeValue, 20)).some(item => item.event.type === "message.received")); continueUpload();
    const accepted = await pendingUpload; assert.equal(accepted.statusCode, 200, `${accepted.body}; provider=${providerCodes.join(",")}`); mediaIds.push(validMeta.mediaId);
    // G.2: a PDF is authorized, streamed, hashed and persisted in the same tenant.
    const pdfBytes = Buffer.from("%PDF-1.7\\n1 0 obj <<>> endobj\\n%%EOF", "utf8");
    const pdfMeta = makeMeta({ type: "DOCUMENT", mimeType: "application/pdf", fileName: "documento.pdf", size: pdfBytes.length, sha256: createHash("sha256").update(pdfBytes).digest("hex") });
    const pdfAccepted = await upload(owner, pdfMeta, pdfBytes);
    assert.equal(pdfAccepted.statusCode, 200, pdfAccepted.body);
    mediaIds.push(pdfMeta.mediaId);
    assert.equal((await db.media.findFirst({ where: { organizationId: orgA, id: pdfMeta.mediaId } }))?.type, "DOCUMENT");
    // The signed Provider also serves the same encrypted document bytes.
    const storedPdf = await client.readMedia(scopeValue, pdfMeta.mediaId);
    const pdfChunks: Buffer[] = [];
    for await (const chunk of storedPdf.stream) pdfChunks.push(Buffer.from(chunk));
    assert.equal(Buffer.concat(pdfChunks).equals(pdfBytes), true);
    assert.equal((await upload(denied, makeMeta({ type: "DOCUMENT", mimeType: "application/pdf", fileName: "privado.pdf", size: pdfBytes.length, sha256: pdfMeta.sha256 }), pdfBytes)).statusCode, 403);
    const fakePdf = Buffer.from("MZ is not PDF");
    const fakeMeta = makeMeta({ type: "DOCUMENT", mimeType: "application/pdf", fileName: "fraude.pdf", size: fakePdf.length, sha256: createHash("sha256").update(fakePdf).digest("hex") });
    assert.equal((await upload(owner, fakeMeta, fakePdf)).statusCode, 415);
    // G.2 follow-up: streaming text documents require valid UTF-8 and cannot hide binary bytes.
    const textBytes = Buffer.from("conteudo valido", "utf8");
    const textMeta = makeMeta({ type: "DOCUMENT", mimeType: "text/plain", fileName: "anotacoes.txt", size: textBytes.length, sha256: createHash("sha256").update(textBytes).digest("hex") });
    const textResponse = await upload(owner, textMeta, textBytes);
    assert.equal(textResponse.statusCode, 200, textResponse.body);
    mediaIds.push(textMeta.mediaId);
    const binaryBytes = Buffer.from([0, 1, 2, 3, 255]);
    const binaryMeta = makeMeta({ type: "DOCUMENT", mimeType: "text/plain", fileName: "falso.txt", size: binaryBytes.length, sha256: createHash("sha256").update(binaryBytes).digest("hex") });
    assert.equal((await upload(owner, binaryMeta, binaryBytes)).statusCode, 415);
    const cached = await readdir(join(vault.directory, "files")), cache = cached.find(name => name.endsWith(".cache")); assert.ok(cache); assert.ok((await stat(join(vault.directory, "files", cache))).mode % 0o1000 === 0o600); assert.ok(!cached.some(name => name.endsWith(".part")));

    const interruptedMeta = makeMeta();
    const reached = new Promise<void>(resolve => { providerStarted = resolve; }), completed = new Promise<void>(resolve => { providerFinished = resolve; });
    const interrupted = Readable.from((async function* () { yield imageBytes.subarray(0, 12); await reached; throw new Error("synthetic client interruption"); })());
    try { await upload(owner, interruptedMeta, interrupted); } catch { /* synthetic client abort */ }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([completed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Provider did not release aborted upload within its connection timeout")), 15000); })]); } finally { clearTimeout(timer); }
    assert.ok(!(await readdir(join(vault.directory, "files"))).some(name => name.endsWith(".part")));
    const afterFailure = makeMeta(); assert.equal((await upload(owner, afterFailure)).statusCode, 200); mediaIds.push(afterFailure.mediaId);
  } finally {
    process.env.PATH = oldPath; await mediaApp.close(); await sessions.shutdown(); await source.close();
    if (mediaIds.length) await db.media.deleteMany({ where: { organizationId: orgA, id: { in: mediaIds } } });
    await db.conversation.update({ where: { organizationId_id: { organizationId: orgA, id: thread.id } }, data: originalThread });
    await db.providerConnection.update({ where: { organizationId_channelId: { organizationId: orgA, channelId } }, data: { outboundEnabled: original.outboundEnabled, mediaEnabled: original.mediaEnabled, state: original.state, errorCode: original.errorCode, lastCheckedAt: original.lastCheckedAt } });
    await rm(directory, { recursive: true, force: true });
  }
});
