import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { parseProviderEvent, type ProviderEvent, type SyncItem } from "../../../contracts/provider.js";
import type { ProviderSync } from "../../../contracts/provider-internal.js";
import { ServiceError } from "./errors.js";
import { Serial } from "./serial.js";

export const scopeSchema = z.strictObject({ organizationId: z.uuid(), connectionId: z.uuid() });
export type Scope = z.infer<typeof scopeSchema>;
export type State = "DISCONNECTED" | "CONNECTING" | "QR_REQUIRED" | "CONNECTED" | "RECONNECTING" | "FAILED" | "LOGGED_OUT";
export type Delivery = { event: ProviderEvent; attempts: number; leaseUntil: number; leaseId?: string; dead: boolean };
export type Session = Scope & {
  version: 1; desired: boolean; state: State; revision: number; qrRevision: number;
  attempts: number; errorCode?: string; auth?: string; keys: Record<string, string>;
  events: Delivery[]; dedup: string[]; commands: { id: string; digest: string }[];
  pairingPhase?: string;
  historyImports?: { downloads: number; decodedBytes: number; seen: string[] };
  sync?: ProviderSync & { pending: { item: SyncItem; historical: boolean }[]; complete: boolean; startedAt: number; historyContacts: number; historyConversations: number; historyMessages: number; historyIdentities?: string[][] };
};
const filename = (scope: Scope) => createHash("sha256").update(JSON.stringify([scope.organizationId, scope.connectionId])).digest("hex");
const MAX_RECORD_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_SESSIONS = 16;

/** Single writer is enforced by flock before startup. AES-GCM protects the entire
 * record, including auth keys, event contents and command receipts. */
export class Vault {
  private readonly records = new Map<string, Session>();
  private readonly sizes = new Map<string, number>();
  private readonly serial = new Serial();
  constructor(readonly directory: string, private readonly key: Buffer) {
    if (key.length !== 32) throw new ServiceError("INVALID_ENCRYPTION_KEY", 503);
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const files = await readdir(this.directory);
    for (const file of files) {
      if (/^[a-f0-9]{64}\.[a-f0-9-]+\.tmp$/.test(file)) { await rm(join(this.directory, file)); continue; }
      if (!/^[a-f0-9]{64}\.vault$/.test(file)) continue;
      if (this.records.size >= MAX_SESSIONS || (await stat(join(this.directory, file))).size > MAX_RECORD_BYTES + 32) throw new ServiceError("VAULT_LIMIT", 503);
      try {
        const raw = await readFile(join(this.directory, file));
        if (raw[0] !== 1 || raw.length < 29) throw new Error();
        const name = file.slice(0, -6);
        const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(1, 13));
        decipher.setAAD(Buffer.from(`wapphub-provider-web:v1:${name}`));
        decipher.setAuthTag(raw.subarray(13, 29));
        const plaintext = Buffer.concat([decipher.update(raw.subarray(29)), decipher.final()]);
        const record = JSON.parse(plaintext.toString()) as Session;
        scopeSchema.parse({ organizationId: record.organizationId, connectionId: record.connectionId });
        if (record.version !== 1 || filename(record) !== name || !Array.isArray(record.events) || !Array.isArray(record.commands) || !Array.isArray(record.dedup)) throw new Error();
        record.events.forEach((item) => {
          const event = parseProviderEvent(item.event);
          if (event.organizationId !== record.organizationId || event.connectionId !== record.connectionId) throw new Error();
        });
        this.records.set(name, record);
        this.sizes.set(name, plaintext.length);
        if ([...this.sizes.values()].reduce((sum, size) => sum + size, 0) > MAX_TOTAL_BYTES) throw new Error();
      } catch { throw new ServiceError("VAULT_INTEGRITY_FAILED", 503); }
    }
  }
  get(scope: Scope): Session | undefined { return structuredClone(this.records.get(filename(scope))); }
  all(): Session[] { return structuredClone([...this.records.values()]); }
  async flush() { await this.serial.run(async () => undefined); }
  metrics() {
    let pending = 0, dead = 0, syncDead = 0, syncQueued = 0;
    for (const record of this.records.values()) {
      syncQueued += record.sync?.pending.length ?? 0;
      for (const item of record.events) { if (item.dead) { dead++; if (item.event.type === "sync.batch") syncDead++; } else pending++; }
    }
    return { sessions: this.records.size, pending, dead, syncDead, syncQueued };
  }
  async update<T>(scope: Scope, mutate: (record: Session) => T): Promise<T> {
    scopeSchema.parse(scope);
    return this.serial.run(async () => {
      const name = filename(scope);
      const previous = this.records.get(name);
      if (!previous && this.records.size >= MAX_SESSIONS) throw new ServiceError("SESSION_LIMIT", 429);
      const record: Session = previous ? structuredClone(previous) : {
        ...scope, version: 1, desired: false, state: "DISCONNECTED", revision: 0,
        qrRevision: 0, attempts: 0, keys: {}, events: [], dedup: [], commands: [],
      };
      const result = mutate(record);
      const plaintext = Buffer.from(JSON.stringify(record));
      if (plaintext.length > MAX_RECORD_BYTES) throw new ServiceError("VAULT_LIMIT", 503);
      const total = [...this.sizes.values()].reduce((sum, size) => sum + size, 0) - (this.sizes.get(name) ?? 0) + plaintext.length;
      if (total > MAX_TOTAL_BYTES) throw new ServiceError("VAULT_LIMIT", 503);
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
      cipher.setAAD(Buffer.from(`wapphub-provider-web:v1:${name}`));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const raw = Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), ciphertext]);
      const temporary = join(this.directory, `${name}.${randomUUID()}.tmp`);
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, join(this.directory, `${name}.vault`));
      const directory = await open(this.directory, "r");
      try { await directory.sync(); } finally { await directory.close(); }
      this.records.set(name, record); // expose committed state only after fsync
      this.sizes.set(name, plaintext.length);
      return result;
    });
  }
}
