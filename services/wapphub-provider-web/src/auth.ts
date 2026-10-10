import { createHash, timingSafeEqual } from "node:crypto";
import { signature } from "../../../contracts/provider-internal.js";
export { signature, signedHeaders } from "../../../contracts/provider-internal.js";
import { mkdir, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { ServiceError } from "./errors.js";
import { Serial } from "./serial.js";

/** Nonces survive restarts. Only validated signatures allocate bounded disk space.
 * Exclusive creation plus the global writer lock also prevents parallel replay. */
export class InternalAuth {
  private readonly serial = new Serial();
  constructor(private readonly key: Buffer, private readonly directory: string, private readonly now = Date.now) {
    if (key.length !== 32) throw new ServiceError("INVALID_INTERNAL_KEY", 503);
  }
  async initialize() { await mkdir(this.directory, { recursive: true, mode: 0o700 }); }
  async verify(method: string, path: string, body: unknown, headers: Record<string, string | string[] | undefined>) {
    const client = headers["x-wapphub-client"], timestamp = headers["x-wapphub-timestamp"], nonce = headers["x-wapphub-nonce"], supplied = headers["x-wapphub-signature"];
    if (client !== "core" || typeof timestamp !== "string" || !/^\d{13}$/.test(timestamp) || typeof nonce !== "string" || !/^[a-f0-9-]{36}$/.test(nonce) || typeof supplied !== "string" || !/^[a-f0-9]{64}$/.test(supplied)) throw new ServiceError("UNAUTHORIZED", 401);
    if (Math.abs(this.now() - Number(timestamp)) > 30_000) throw new ServiceError("UNAUTHORIZED", 401);
    const expected = signature(this.key, method, path, body, timestamp, nonce);
    if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"))) throw new ServiceError("UNAUTHORIZED", 401);
    await this.serial.run(async () => {
      const files = await readdir(this.directory);
      for (const file of files) {
        if (/^\d{13}-[a-f0-9]{64}$/.test(file) && Number(file.slice(0, 13)) < this.now() - 30_000) await rm(join(this.directory, file));
      }
      const remaining = await readdir(this.directory);
      if (remaining.length >= 4096) throw new ServiceError("AUTH_CAPACITY", 429);
      const hash = createHash("sha256").update(nonce).digest("hex");
      // Filename does not include signature/key; exclusive write prevents replay.
      const duplicate = remaining.some((file) => file.endsWith(`-${hash}`));
      if (duplicate) throw new ServiceError("REPLAY_REJECTED", 401);
      const handle = await open(join(this.directory, `${timestamp}-${hash}`), "wx", 0o600);
      try { await handle.sync(); } finally { await handle.close(); }
      const directory = await open(this.directory, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    });
  }
}
