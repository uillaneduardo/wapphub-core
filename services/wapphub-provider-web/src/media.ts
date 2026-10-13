import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import type { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { BufferJSON, getAudioDuration, downloadContentFromMessage, normalizeMessageContent, type WAMessage } from "baileys";
import { mediaUploadSchema, mediaLimit, validMediaKind, type MediaUpload } from "../../../contracts/provider-media.js";
import { normalizeSyncMessage } from "./sync-normalization.js";
import { ServiceError } from "./errors.js";
import { Vault, type Scope } from "./vault.js";
import { mediaPath } from "./media-reference.js";
export function inspectMedia(prefix: Buffer, mime: string) {
  const recognized = mime === "image/jpeg" ? prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255 : mime === "image/png" ? prefix.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) : mime === "image/webp" ? prefix.toString("ascii", 0, 4) === "RIFF" && prefix.toString("ascii", 8, 12) === "WEBP" : mime === "audio/ogg" ? prefix.toString("ascii", 0, 4) === "OggS" : mime === "audio/mpeg" ? prefix.toString("ascii", 0, 3) === "ID3" || prefix[0] === 255 && ((prefix[1] ?? 0) & 224) === 224 : mime === "audio/webm" ? prefix.subarray(0, 4).equals(Buffer.from("1a45dfa3", "hex")) : ["video/mp4", "audio/mp4"].includes(mime) ? prefix.toString("ascii", 4, 8) === "ftyp" : false;
  if (!recognized) throw new ServiceError("MEDIA_TYPE_MISMATCH", 415);
}
let mediaTransferBusy = false;
export type MediaDiagnostic = "MEDIA_REFERENCE_REJECTED" | "MEDIA_METADATA_REJECTED" | "MEDIA_REFERENCE_RETAINED" | "MEDIA_REFERENCE_CONFLICT" | "MEDIA_REFERENCE_LIMIT";
export class ProviderMedia {
  private readonly files;
  constructor(private readonly vault: Vault, private readonly enabled: boolean, private readonly diagnostic: (code: MediaDiagnostic) => void = () => undefined, private readonly download: (...args: Parameters<typeof downloadContentFromMessage>) => Promise<Readable> = downloadContentFromMessage) { this.files = vault.privateFiles(); }
  private allowed(scope: Scope) { if (!this.enabled) throw new ServiceError("MEDIA_DISABLED", 403); if (!this.vault.get(scope)) throw new ServiceError("SESSION_NOT_FOUND", 404); }
  async retain(scope: Scope, message: WAMessage) {
    const normalized = normalizeSyncMessage(scope, message);
    if (normalized?.kind !== "message" || normalized.message.content.type === "TEXT" || normalized.message.content.type === "DOCUMENT") return;
    const meta = normalized.message.content.media, raw = normalizeMessageContent(message.message), data = raw?.imageMessage ?? raw?.audioMessage ?? raw?.videoMessage;
    const directPath = mediaPath(data?.directPath, data?.url);
    if (!directPath) { this.diagnostic("MEDIA_REFERENCE_REJECTED"); return; }
    if (!data?.mediaKey || data.mediaKey.length !== 32 || !meta.sha256 || !meta.size || !validMediaKind(meta.type as MediaUpload["type"], meta.mimeType) || meta.size > mediaLimit(meta.type as MediaUpload["type"])) { this.diagnostic("MEDIA_METADATA_REJECTED"); return; }
    const reference = JSON.stringify({ directPath, mediaKey: data.mediaKey }, BufferJSON.replacer);
    await this.vault.update(scope, record => {
      record.media ??= [];
      const sent = message.key.fromMe ? record.sends?.find(x => x.providerMessageId === message.key.id) : undefined;
      const uploaded = sent?.mediaId ? record.media.find(x => x.id === sent.mediaId) : undefined;
      if (uploaded && uploaded.sha256 === meta.sha256 && uploaded.size === meta.size && uploaded.type === meta.type && uploaded.mimeType === meta.mimeType) {
        uploaded.reference = reference; uploaded.expiresAt = Date.now() + 30 * 86400000;
      }
      const existing = record.media.find(x => x.id === meta.mediaId);
      if (existing) {
        if (existing.sha256 === meta.sha256 && existing.size === meta.size && existing.mimeType === meta.mimeType && existing.type === meta.type) { existing.reference = reference; existing.expiresAt = Date.now() + 30 * 86400000; this.diagnostic("MEDIA_REFERENCE_RETAINED"); }
        else this.diagnostic("MEDIA_REFERENCE_CONFLICT");
        return;
      }
      record.media = record.media.filter(x => x.expiresAt > Date.now());
      if (record.media.length >= 2048) { this.diagnostic("MEDIA_REFERENCE_LIMIT"); return; }
      record.media.push({ id: meta.mediaId, reference, type: meta.type as MediaUpload["type"], mimeType: meta.mimeType, fileName: meta.fileName, size: meta.size, sha256: meta.sha256!, expiresAt: Date.now() + 30 * 86400000 });
      this.diagnostic("MEDIA_REFERENCE_RETAINED");
    });
  }
  private record(scope: Scope, id: string) {
    const record = this.vault.get(scope)?.media?.find(x => x.id === id);
    if (!record) throw new ServiceError("MEDIA_UNAVAILABLE", 404);
    if (record.expiresAt <= Date.now()) throw new ServiceError("MEDIA_EXPIRED", 410);
    return record;
  }
  private async probe(scope: Scope, id: string, expected: { size: number; sha256: string }) {
    const child = spawn("ffprobe", ["-v", "error", "-max_alloc", "33554432", "-protocol_whitelist", "pipe", "-show_entries", "stream=codec_type,codec_name:format=duration", "-of", "json", "pipe:0"], { stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15000); timer.unref();
    const done = new Promise<void>((resolve, reject) => { child.once("error", () => reject(new ServiceError("MEDIA_CODEC_UNAVAILABLE", 503))); child.once("exit", code => code === 0 ? resolve() : reject(new ServiceError("MEDIA_CODEC_INVALID", 415))); });
    let output = ""; const abort = new AbortController(); const tasks: Promise<unknown>[] = [done];
    try {
      tasks.push(pipeline(await this.files.stream(scope, id, expected), child.stdin, { signal: abort.signal }), pipeline(child.stdout, new Writable({ write(chunk: Buffer, _encoding, callback) { output += chunk.toString(); callback(output.length > 8192 ? new ServiceError("MEDIA_CODEC_INVALID", 415) : undefined); } }), { signal: abort.signal }));
      await Promise.all(tasks);
      const result = JSON.parse(output) as { streams?: { codec_type: string; codec_name: string }[]; format?: { duration: string } };
      return { streams: result.streams ?? [], seconds: Math.ceil(Number(result.format?.duration ?? 0)) };
    } finally { clearTimeout(timer); abort.abort(); child.kill("SIGKILL"); await Promise.allSettled(tasks); }
  }
  async upload(scope: Scope, input: MediaUpload, source: AsyncIterable<Uint8Array>) {
    this.allowed(scope); const meta = mediaUploadSchema.parse(input);
    if (!validMediaKind(meta.type, meta.mimeType) || meta.size > mediaLimit(meta.type)) throw new ServiceError("MEDIA_SIZE_OR_TYPE_DENIED", 415);
    if (mediaTransferBusy) throw new ServiceError("MEDIA_BUSY", 429); mediaTransferBusy = true;
    let cacheOwned = false;
    try {
      if (this.vault.get(scope)?.media?.some(x => x.id === meta.mediaId)) throw new ServiceError("MEDIA_ID_CONFLICT", 409);
      cacheOwned = true;
      await this.files.put(scope, meta.mediaId, source, meta, prefix => inspectMedia(prefix, meta.mimeType));
      const probe = await this.probe(scope, meta.mediaId, meta);
      if (meta.type === "AUDIO" || meta.type === "VOICE") probe.seconds = Math.ceil(await getAudioDuration(await this.files.stream(scope, meta.mediaId, meta)) ?? Number.NaN);
      const codecsValid = meta.type === "IMAGE" ? probe.streams.every(x => x.codec_type === "video" && ["mjpeg", "png", "webp"].includes(x.codec_name)) : meta.type === "VIDEO" ? probe.streams.some(x => x.codec_type === "video" && x.codec_name === "h264") && probe.streams.every(x => x.codec_type === "video" && x.codec_name === "h264" || x.codec_type === "audio" && x.codec_name === "aac") : probe.streams.every(x => x.codec_type === "audio" && ["aac", "mp3", "opus", "vorbis"].includes(x.codec_name));
      if (!Number.isFinite(probe.seconds) || probe.seconds < 0 || probe.seconds > 600 || !probe.streams.length || !codecsValid) throw new ServiceError("MEDIA_CODEC_INVALID", 415);
      let output = { size: meta.size, sha256: meta.sha256, mimeType: meta.mimeType as string };
      if (meta.mimeType === "audio/webm" || meta.type === "VOICE" && (meta.mimeType !== "audio/ogg" || probe.streams.some(x => x.codec_name !== "opus"))) {
        const temporary = randomUUID(), child = spawn("ffmpeg", ["-nostdin", "-v", "error", "-max_alloc", "33554432", "-protocol_whitelist", "pipe", "-i", "pipe:0", "-map", "0:a:0", "-threads", "1", "-t", "600", "-c:a", "libopus", "-f", "ogg", "pipe:1"], { stdio: ["pipe", "pipe", "ignore"] });
        const timer = setTimeout(() => child.kill("SIGKILL"), 30000); timer.unref();
        const done = new Promise<void>((resolve, reject) => { child.once("error", () => reject(new ServiceError("MEDIA_CODEC_UNAVAILABLE", 503))); child.once("exit", code => code === 0 ? resolve() : reject(new ServiceError("MEDIA_CODEC_INVALID", 415))); });
        const abort = new AbortController(), tasks: Promise<unknown>[] = [done];
        try {
          const input = pipeline(await this.files.stream(scope, meta.mediaId, meta), child.stdin, { signal: abort.signal });
          const convertedFile = this.files.put(scope, temporary, child.stdout, { maximum: mediaLimit(meta.type) }, prefix => inspectMedia(prefix, "audio/ogg"));
          tasks.push(input, convertedFile);
          const [, converted] = await Promise.all([input, convertedFile, done]);
          await this.files.put(scope, meta.mediaId, await this.files.stream(scope, temporary, converted), converted);
          output = { ...converted, mimeType: "audio/ogg" };
        } finally { clearTimeout(timer); abort.abort(); child.kill("SIGKILL"); await Promise.allSettled(tasks); await this.files.remove(scope, temporary); }
      }
      await this.vault.update(scope, record => { record.media ??= []; record.media = record.media.filter(x => x.expiresAt > Date.now()); if (record.media.length >= 2048) throw new ServiceError("MEDIA_CACHE_LIMIT", 429); record.media.push({ id: meta.mediaId, type: meta.type, fileName: meta.fileName, ...output, seconds: probe.seconds, expiresAt: Date.now() + 24 * 3600000 }); });
      return { mediaId: meta.mediaId, type: meta.type, fileName: meta.fileName, ...output, state: "READY" as const };
    } catch (error) { if (cacheOwned) await this.files.remove(scope, meta.mediaId); throw error; }
    finally { mediaTransferBusy = false; }
  }
  async read(scope: Scope, id: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    this.allowed(scope); const record = this.record(scope, id);
    if (!await this.files.has(scope, id)) {
      if (!record.reference) throw new ServiceError("MEDIA_EXPIRED", 410);
      if (mediaTransferBusy) throw new ServiceError("MEDIA_BUSY", 429); mediaTransferBusy = true;
      const transfer = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30000)]);
      try {
        const reference = JSON.parse(record.reference, BufferJSON.reviver), directPath = mediaPath(reference.directPath, reference.url);
        if (!directPath || !reference.mediaKey || reference.mediaKey.length !== 32) throw new ServiceError("MEDIA_UNAVAILABLE", 404);
        const stream = await this.download({ directPath, mediaKey: reference.mediaKey }, record.type === "VOICE" ? "audio" : record.type.toLowerCase() as "image" | "audio" | "video", { host: "mmg.whatsapp.net", options: { redirect: "error", signal: transfer } });
        try { await this.files.put(scope, id, stream, record, prefix => inspectMedia(prefix, record.mimeType), transfer); }
        finally { stream.destroy(); }
      } catch (reason) {
        if (signal?.aborted) throw new ServiceError("MEDIA_TRANSFER_CANCELLED", 499);
        if (transfer.aborted) throw new ServiceError("MEDIA_TRANSFER_TIMEOUT", 408);
        if (reason instanceof ServiceError) throw reason;
        const status = reason && typeof reason === "object" && "output" in reason && reason.output && typeof reason.output === "object" && "statusCode" in reason.output ? reason.output.statusCode : undefined;
        if (status === 404 || status === 410) throw new ServiceError("MEDIA_EXPIRED", 410);
        throw new ServiceError("MEDIA_UNAVAILABLE", 503);
      }
      finally { mediaTransferBusy = false; }
    }
    return { record, stream: await this.files.stream(scope, id, record, signal) };
  }
}
