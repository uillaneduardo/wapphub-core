import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable, Transform, addAbortSignal } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ServiceError } from "./errors.js";
import type { Scope } from "./vault.js";
const TTL = 24 * 3600000, MAX_DISK = 512 * 1024 * 1024;
/** Private AES-GCM cache. No plaintext cache or caller-controlled paths. Files
 * are verified completely before returning any bytes, including range reads. */
export class PrivateFiles {
  private writing = false;
  constructor(private readonly directory: string, private readonly key: Buffer) {}
  private name(scope: Scope, id: string) { return createHash("sha256").update(JSON.stringify([scope.organizationId, scope.connectionId])).digest("hex").slice(0, 32) + createHash("sha256").update(id).digest("hex").slice(0, 32); }
  private path(scope: Scope, id: string) { return join(this.directory, this.name(scope, id) + ".cache"); }
  private async cleanup(scope: Scope) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 }); let bytes = 0, scopedBytes = 0;
    for (const file of await readdir(this.directory)) {
      if (!/^[a-f0-9]{64}(\.cache|\.[a-f0-9-]+\.part)$/.test(file)) continue;
      const path = join(this.directory, file), info = await stat(path);
      if (Date.now() - info.mtimeMs > TTL || file.endsWith(".part") && Date.now() - info.mtimeMs > 60000) await rm(path); else { bytes += info.size; if (file.startsWith(this.name(scope, "").slice(0, 32))) scopedBytes += info.size; }
    }
    return { bytes, scopedBytes };
  }
  async has(scope: Scope, id: string) { try { return Date.now() - (await stat(this.path(scope, id))).mtimeMs < TTL; } catch { return false; } }
  async remove(scope: Scope, id: string) { await rm(this.path(scope, id), { force: true }); }
  async put(scope: Scope, id: string, source: AsyncIterable<Uint8Array>, expected: { size?: number; sha256?: string; maximum?: number }, inspect?: (prefix: Buffer) => void, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.writing) throw new ServiceError("MEDIA_BUSY", 429);
    if (process.memoryUsage().rss >= 384 * 1024 * 1024) throw new ServiceError("MEDIA_MEMORY_PRESSURE", 429);
    this.writing = true;
    const temporary = join(this.directory, `${this.name(scope, id)}.${randomUUID()}.part`);
    try {
      const used = await this.cleanup(scope), reserved = (expected.size ?? expected.maximum ?? 25 * 1024 * 1024) + 29;
      if (used.bytes + reserved > MAX_DISK || used.scopedBytes + reserved > 256 * 1024 * 1024) throw new ServiceError("MEDIA_CACHE_LIMIT", 429);
      const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, nonce);
      cipher.setAAD(Buffer.from(`wapphub-private:v1:${this.name(scope, id)}`));
      const fd = await open(temporary, "wx", 0o600); await fd.write(Buffer.concat([Buffer.from([1]), nonce, Buffer.alloc(16)])); await fd.close();
      let size = 0, prefix = Buffer.alloc(0); const hash = createHash("sha256");
      const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) { size += chunk.length; if (size > (expected.size ?? expected.maximum ?? 25 * 1024 * 1024)) return callback(new ServiceError("MEDIA_SIZE_MISMATCH", 413)); hash.update(chunk); if (prefix.length < 64) prefix = Buffer.concat([prefix, chunk.subarray(0, 64 - prefix.length)]); callback(null, chunk); } });
      try { await pipeline(source instanceof Readable ? source : Readable.from(source), bounded, cipher, createWriteStream(temporary, { flags: "a" }), { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(60_000)]) }); }
      catch (error) { if (error instanceof Error && error.name === "AbortError") throw new ServiceError(signal?.aborted ? "MEDIA_TRANSFER_CANCELLED" : "MEDIA_TRANSFER_TIMEOUT", signal?.aborted ? 499 : 408); throw error; }
      const sha256 = hash.digest("hex");
      if (expected.size !== undefined && size !== expected.size || expected.sha256 !== undefined && sha256 !== expected.sha256) throw new ServiceError("MEDIA_INTEGRITY_FAILED", 409);
      inspect?.(prefix);
      signal?.throwIfAborted();
      const handle = await open(temporary, "r+"); try { await handle.write(cipher.getAuthTag(), 0, 16, 13); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, this.path(scope, id));
      const directory = await open(this.directory, "r"); try { await directory.sync(); } finally { await directory.close(); }
      return { size, sha256 };
    } finally { this.writing = false; await rm(temporary, { force: true }); }
  }
  private async decrypt(scope: Scope, id: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!await this.has(scope, id)) throw new ServiceError("MEDIA_EXPIRED", 410);
    const path = this.path(scope, id), fd = await open(path, "r"), header = Buffer.alloc(29);
    try { await fd.read(header, 0, 29, 0); } finally { await fd.close(); }
    if (header[0] !== 1) throw new ServiceError("MEDIA_INTEGRITY_FAILED", 409);
    const decipher = createDecipheriv("aes-256-gcm", this.key, header.subarray(1, 13));
    decipher.setAAD(Buffer.from(`wapphub-private:v1:${this.name(scope, id)}`)); decipher.setAuthTag(header.subarray(13));
    const source = createReadStream(path, { start: 29 });
    source.once("error", error => decipher.destroy(error));
    const stream = source.pipe(decipher);
    stream.once("close", () => source.destroy());
    if (signal) addAbortSignal(signal, stream);
    return stream;
  }
  async stream(scope: Scope, id: string, expected: { size: number; sha256: string }, signal?: AbortSignal) {
    let size = 0; const hash = createHash("sha256");
    try { for await (const chunk of await this.decrypt(scope, id, signal)) { size += chunk.length; if (size > expected.size) throw new Error(); hash.update(chunk); } if (size !== expected.size || hash.digest("hex") !== expected.sha256) throw new Error(); }
    catch { if (signal?.aborted) throw new ServiceError("MEDIA_TRANSFER_CANCELLED", 499); throw new ServiceError("MEDIA_INTEGRITY_FAILED", 409); }
    return this.decrypt(scope, id, signal);
  }
  async bytes(scope: Scope, id: string, expected: { size: number; sha256: string }, maximum: number) {
    if (expected.size > maximum) throw new ServiceError("MEDIA_SIZE_MISMATCH", 413);
    // Used only for bounded thumbnails/fixtures, never normal media delivery.
    const chunks: Buffer[] = []; for await (const chunk of await this.stream(scope, id, expected)) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks);
  }
}
