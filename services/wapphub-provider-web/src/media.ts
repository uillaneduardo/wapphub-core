import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import { randomUUID } from "node:crypto";
import { BufferJSON, getAudioDuration, downloadContentFromMessage, normalizeMessageContent, type WAMessage } from "baileys";
import { mediaUploadSchema, mediaLimit, validMediaKind, type MediaUpload } from "../../../contracts/provider-media.js";
import { normalizeSyncMessage } from "./sync-normalization.js";
import { ServiceError } from "./errors.js";
import { Vault, type Scope } from "./vault.js";
export function inspectMedia(prefix: Buffer, mime: string) {
  const recognized = mime === "image/jpeg" ? prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255 : mime === "image/png" ? prefix.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) : mime === "image/webp" ? prefix.toString("ascii", 0, 4) === "RIFF" && prefix.toString("ascii", 8, 12) === "WEBP" : mime === "audio/ogg" ? prefix.toString("ascii", 0, 4) === "OggS" : mime === "audio/mpeg" ? prefix.toString("ascii", 0, 3) === "ID3" || prefix[0] === 255 && ((prefix[1] ?? 0) & 224) === 224 : mime === "audio/webm" ? prefix.subarray(0, 4).equals(Buffer.from("1a45dfa3", "hex")) : ["video/mp4", "audio/mp4"].includes(mime) ? prefix.toString("ascii", 4, 8) === "ftyp" : false;
  if (!recognized) throw new ServiceError("MEDIA_TYPE_MISMATCH", 415);
}
let mediaTransferBusy = false;
export class ProviderMedia {
  private readonly files;
  constructor(private readonly vault: Vault, private readonly enabled: boolean) { this.files = vault.privateFiles(); }
  private allowed(scope: Scope) { if (!this.enabled) throw new ServiceError("MEDIA_DISABLED", 403); if (!this.vault.get(scope)) throw new ServiceError("SESSION_NOT_FOUND", 404); }
  async retain(scope: Scope, message: WAMessage) {
    const normalized = normalizeSyncMessage(scope, message);
    if (normalized?.kind !== "message" || normalized.message.content.type === "TEXT" || normalized.message.content.type === "DOCUMENT") return;
    const meta = normalized.message.content.media, raw = normalizeMessageContent(message.message), data = raw?.imageMessage ?? raw?.audioMessage ?? raw?.videoMessage;
    if (!data?.mediaKey || !data.directPath || !/^\/[^\s\\?#]{1,1800}$/.test(data.directPath) || !meta.sha256 || !meta.size || meta.size > mediaLimit(meta.type as MediaUpload["type"])) return;
    const reference = JSON.stringify({ directPath: data.directPath, mediaKey: data.mediaKey }, BufferJSON.replacer);
    await this.vault.update(scope, record => {
      record.media ??= [];
      const sent = message.key.fromMe ? record.sends?.find(x => x.providerMessageId === message.key.id) : undefined;
      const uploaded = sent?.mediaId ? record.media.find(x => x.id === sent.mediaId) : undefined;
      if (uploaded && uploaded.sha256 === meta.sha256 && uploaded.size === meta.size && uploaded.type === meta.type && uploaded.mimeType === meta.mimeType) {
        uploaded.reference = reference; uploaded.expiresAt = Date.now() + 30 * 86400000;
      }
      if (record.media.some(x => x.id === meta.mediaId)) return;
      record.media = record.media.filter(x => x.expiresAt > Date.now());
      if (record.media.length >= 2048) return;
      record.media.push({ id: meta.mediaId, reference, type: meta.type as MediaUpload["type"], mimeType: meta.mimeType, fileName: meta.fileName, size: meta.size, sha256: meta.sha256!, expiresAt: Date.now() + 30 * 86400000 });
    });
  }
  private record(scope: Scope, id: string) {
    const record = this.vault.get(scope)?.media?.find(x => x.id === id && x.expiresAt > Date.now());
    if (!record) throw new ServiceError("MEDIA_UNAVAILABLE", 404);
    return record;
  }
  private async probe(scope: Scope, id: string, expected: { size: number; sha256: string }) {
    const child = spawn("ffprobe", ["-v", "error", "-max_alloc", "33554432", "-protocol_whitelist", "pipe", "-show_entries", "stream=codec_type,codec_name:format=duration", "-of", "json", "pipe:0"], { stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15000); timer.unref();
    const done = new Promise<void>((resolve, reject) => { child.once("error", () => reject(new ServiceError("MEDIA_CODEC_UNAVAILABLE", 503))); child.once("exit", code => code === 0 ? resolve() : reject(new ServiceError("MEDIA_CODEC_INVALID", 415))); });
    let output = "";
    try {
      await Promise.all([pipeline(await this.files.stream(scope, id, expected), child.stdin), pipeline(child.stdout, new Writable({ write(chunk: Buffer, _encoding, callback) { output += chunk.toString(); callback(output.length > 8192 ? new ServiceError("MEDIA_CODEC_INVALID", 415) : undefined); } })), done]);
      const result = JSON.parse(output) as { streams?: { codec_type: string; codec_name: string }[]; format?: { duration: string } };
      return { streams: result.streams ?? [], seconds: Math.ceil(Number(result.format?.duration ?? 0)) };
    } finally { clearTimeout(timer); child.kill("SIGKILL"); }
  }
  async upload(scope: Scope, input: MediaUpload, source: AsyncIterable<Uint8Array>) {
    this.allowed(scope); const meta = mediaUploadSchema.parse(input);
    if (!validMediaKind(meta.type, meta.mimeType) || meta.size > mediaLimit(meta.type)) throw new ServiceError("MEDIA_SIZE_OR_TYPE_DENIED", 415);
    if (mediaTransferBusy) throw new ServiceError("MEDIA_BUSY", 429); mediaTransferBusy = true;
    try {
      if (this.vault.get(scope)?.media?.some(x => x.id === meta.mediaId)) throw new ServiceError("MEDIA_ID_CONFLICT", 409);
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
        try {
          const [, converted] = await Promise.all([pipeline(await this.files.stream(scope, meta.mediaId, meta), child.stdin), this.files.put(scope, temporary, child.stdout, { maximum: mediaLimit(meta.type) }, prefix => inspectMedia(prefix, "audio/ogg")), done]);
          await this.files.put(scope, meta.mediaId, await this.files.stream(scope, temporary, converted), converted);
          output = { ...converted, mimeType: "audio/ogg" };
        } finally { clearTimeout(timer); child.kill("SIGKILL"); }
      }
      await this.vault.update(scope, record => { record.media ??= []; record.media = record.media.filter(x => x.expiresAt > Date.now()); if (record.media.length >= 2048) throw new ServiceError("MEDIA_CACHE_LIMIT", 429); record.media.push({ id: meta.mediaId, type: meta.type, fileName: meta.fileName, ...output, seconds: probe.seconds, expiresAt: Date.now() + 24 * 3600000 }); });
      return { mediaId: meta.mediaId, type: meta.type, fileName: meta.fileName, ...output, state: "READY" as const };
    } finally { mediaTransferBusy = false; }
  }
  async read(scope: Scope, id: string) {
    this.allowed(scope); const record = this.record(scope, id);
    if (!await this.files.has(scope, id)) {
      if (!record.reference) throw new ServiceError("MEDIA_EXPIRED", 410);
      if (mediaTransferBusy) throw new ServiceError("MEDIA_BUSY", 429); mediaTransferBusy = true;
      try {
        const stream = await downloadContentFromMessage(JSON.parse(record.reference, BufferJSON.reviver), record.type === "VOICE" ? "audio" : record.type.toLowerCase() as "image" | "audio" | "video", { host: "mmg.whatsapp.net", options: { redirect: "error", signal: AbortSignal.timeout(30000) } });
        await this.files.put(scope, id, stream, record, prefix => inspectMedia(prefix, record.mimeType));
      } catch (reason) { if (reason instanceof ServiceError) throw reason; throw new ServiceError("MEDIA_UNAVAILABLE", 503); }
      finally { mediaTransferBusy = false; }
    }
    return { record, stream: await this.files.stream(scope, id, record) };
  }
}
