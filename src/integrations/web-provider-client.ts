import { Readable } from "node:stream";
import { mediaReferenceSchema } from "../../contracts/provider.js";
import type { MediaUpload } from "../../contracts/provider-media.js";
import { recipientResultSchema, sendResultSchema, type SendIntent, type SendResult } from "../../contracts/provider-outbound.js";
import type { HistoryControl } from "../../contracts/history.js";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { providerSessionSchema, providerQrSchema, providerDeliveriesSchema, signedHeaders, type ProviderSession, type ProviderQr } from "../../contracts/provider-internal.js";
import type { Config } from "../infrastructure/config.js";
export type ProviderScope = { organizationId: string; connectionId: string };
export type InternalAction = "connect" | "refresh" | "recover" | "disconnect" | "logout" | "prepare_link";
export type Delivery = z.infer<typeof providerDeliveriesSchema>["deliveries"][number];
export interface WebProviderPort {
  uploadMedia?(scope: ProviderScope, meta: MediaUpload, stream: AsyncIterable<Uint8Array>): Promise<import("zod").infer<typeof mediaReferenceSchema>>;
  readMedia?(scope: ProviderScope, id: string): Promise<{ stream: Readable; mimeType: string; size: number; sha256: string }>;
  resolveRecipient?(scope: ProviderScope, phone: string): Promise<{ state: "VALID" | "NOT_FOUND" | "UNKNOWN"; jid?: string }>;
  send?(scope: ProviderScope, intent: SendIntent): Promise<SendResult>;
  history?(scope: ProviderScope, control: HistoryControl): Promise<ProviderSession>;
  ready(): Promise<boolean>;
  create(scope: ProviderScope): Promise<ProviderSession>;
  session(scope: ProviderScope): Promise<ProviderSession>;
  command(scope: ProviderScope, action: InternalAction, commandId: string, controlVersion?: number, removedOnPhone?: boolean): Promise<ProviderSession>;
  qr(scope: ProviderScope): Promise<ProviderQr>;
  pull(scope: ProviderScope): Promise<Delivery[]>;
  ack(scope: ProviderScope, eventId: string, leaseId: string): Promise<void>;
  nack(scope: ProviderScope, eventId: string, leaseId: string): Promise<void>;
}
export class WebProviderError extends Error {
  constructor(readonly code: string, readonly status = 503) { super(code); }
}
const prefix = (scope: ProviderScope) => `/internal/v1/organizations/${scope.organizationId}/connections/${scope.connectionId}`;
export class WebProviderClient implements WebProviderPort {
  constructor(private readonly url: string, private readonly key: Buffer) { if (key.length !== 32) throw new WebProviderError("PROVIDER_CONFIGURATION_ERROR"); }
  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    try {
      const response = await fetch(this.url + path, { method, redirect: "error", signal: AbortSignal.timeout(7000), headers: { ...signedHeaders(this.key, method, path, body), ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const reader = response.body?.getReader(); if (!reader) throw new Error();
      const chunks: Uint8Array[] = []; let bytes = 0;
      try { for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 256 * 1024) throw new Error(); chunks.push(next.value); } } finally { await reader.cancel(); }
      const result: unknown = JSON.parse(Buffer.concat(chunks).toString());
      if (!response.ok) {
        const error = z.object({ error: z.object({ code: z.string() }) }).safeParse(result);
        const code = error.success && ["SESSION_COMMAND_LIMIT", "HISTORY_SCOPE_DENIED", "HISTORY_REQUEST_UNCERTAIN", "HISTORY_EXECUTION_DISABLED", "HISTORY_TRANSPORT_UNAVAILABLE", "HISTORY_ANCHOR_REQUIRED", "HISTORY_OPERATION_PENDING", "HISTORY_OPERATION_MISMATCH", "INVALID_HISTORY_STATE", "IDEMPOTENCY_CONFLICT", "QR_NOT_AVAILABLE", "SESSION_NOT_FOUND", "RECOVERY_NOT_ELIGIBLE", "CONTROLLED_RECOVERY_REQUIRED", "STALE_CONTROL_COMMAND", "LINK_PREPARATION_DENIED", "SESSION_ARCHIVE_LIMIT", "LINKED_RECOVERY_ONLY", "CONNECTIONS_DISABLED", "INVALID_SESSION_STATE", "IDEMPOTENCY_CONFLICT"].includes(error.data.error.code) ? error.data.error.code : "PROVIDER_UNAVAILABLE";
        throw new WebProviderError(code, response.status);
      }
      return result;
    } catch (reason) { if (reason instanceof WebProviderError) throw reason; throw new WebProviderError("PROVIDER_UNAVAILABLE"); }
  }
  async uploadMedia(scope: ProviderScope, meta: MediaUpload, stream: AsyncIterable<Uint8Array>) {
    const path = `${prefix(scope)}/media`;
    const body = Readable.from(stream);
    try {
      const response = await fetch(this.url + path, { method: "POST", redirect: "error", signal: AbortSignal.timeout(60000), headers: { ...signedHeaders(this.key, "POST", path, meta), "content-type": "application/octet-stream", "x-media-manifest": Buffer.from(JSON.stringify(meta)).toString("base64url") }, body: Readable.toWeb(body) as unknown as BodyInit, duplex: "half" } as RequestInit & { duplex: "half" });
      const text = await response.text(); if (text.length > 4096) throw new Error();
      if (!response.ok) {
        const result = z.object({ error: z.object({ code: z.enum(["MEDIA_BUSY", "MEDIA_MEMORY_PRESSURE", "MEDIA_CACHE_LIMIT", "MEDIA_INTEGRITY_FAILED", "MEDIA_SIZE_MISMATCH", "MEDIA_TYPE_MISMATCH", "MEDIA_CODEC_INVALID", "MEDIA_CODEC_UNAVAILABLE", "MEDIA_TRANSFER_TIMEOUT"]) }) }).safeParse(JSON.parse(text));
        throw new WebProviderError(result.success ? result.data.error.code : "MEDIA_UPLOAD_FAILED", response.status);
      }
      return mediaReferenceSchema.parse(JSON.parse(text));
    } catch (error) { if (error instanceof WebProviderError) throw error; throw new WebProviderError("MEDIA_UPLOAD_FAILED"); }
    finally { body.destroy(); }
  }
  async readMedia(scope: ProviderScope, id: string) {
    const path = `${prefix(scope)}/media/${id}`;
    try {
      const response = await fetch(this.url + path, { redirect: "error", signal: AbortSignal.timeout(60000), headers: signedHeaders(this.key, "GET", path) });
      const size = Number(response.headers.get("content-length")), mimeType = response.headers.get("content-type") ?? "", sha256 = response.headers.get("x-media-sha256") ?? "";
      if (!response.ok || !response.body || !Number.isSafeInteger(size) || size < 1 || size > 25 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error();
      return { stream: Readable.from((async function* () { const reader = response.body!.getReader(); let bytes = 0; try { for (;;) { const value = await reader.read(); if (value.done) break; bytes += value.value.length; if (bytes > size) throw new WebProviderError("MEDIA_INTEGRITY_FAILED"); yield value.value; } if (bytes !== size) throw new WebProviderError("MEDIA_INTEGRITY_FAILED"); } finally { await reader.cancel(); } })()), size, mimeType, sha256 };
    } catch { throw new WebProviderError("MEDIA_UNAVAILABLE"); }
  }
  async resolveRecipient(scope: ProviderScope, phone: string) { return recipientResultSchema.parse(await this.request("POST", `${prefix(scope)}/recipients/resolve`, { phone })); }
  async send(scope: ProviderScope, intent: SendIntent) { return sendResultSchema.parse(await this.request("POST", `${prefix(scope)}/messages`, intent)); }
  async ready() { try { const result = z.strictObject({ status: z.literal("ready"), connectionsEnabled: z.boolean() }).parse(await this.request("GET", "/health/ready")); return result.connectionsEnabled; } catch { return false; } }
  async history(scope: ProviderScope, control: HistoryControl) { return providerSessionSchema.parse(await this.request("POST", `${prefix(scope)}/history`, control)); }
  async create(scope: ProviderScope) { return providerSessionSchema.parse(await this.request("PUT", prefix(scope))); }
  async session(scope: ProviderScope) { return providerSessionSchema.parse(await this.request("GET", prefix(scope))); }
  async command(scope: ProviderScope, action: InternalAction, commandId: string, controlVersion?: number, removedOnPhone?: boolean) { return providerSessionSchema.parse(await this.request("POST", `${prefix(scope)}/commands`, { action, commandId, ...(removedOnPhone === undefined ? {} : { removedOnPhone }), ...(controlVersion !== undefined ? { controlVersion } : {}) })); }
  async qr(scope: ProviderScope) { return providerQrSchema.parse(await this.request("GET", `${prefix(scope)}/qr`)); }
  async pull(scope: ProviderScope) { return providerDeliveriesSchema.parse(await this.request("POST", `${prefix(scope)}/events/pull`, { limit: 5 })).deliveries; }
  async ack(scope: ProviderScope, eventId: string, leaseId: string) { await this.request("POST", `${prefix(scope)}/events/ack`, { eventId, leaseId }); }
  async nack(scope: ProviderScope, eventId: string, leaseId: string) { await this.request("POST", `${prefix(scope)}/events/nack`, { eventId, leaseId }); }
}
export async function configuredWebProvider(config: Config): Promise<WebProviderPort | undefined> {
  if (!config.PROVIDER_WEB_ENABLED) return undefined;
  const key = (await readFile(config.PROVIDER_WEB_KEY_FILE, "utf8")).trim();
  if (!/^[a-f0-9]{64}$/.test(key)) throw new WebProviderError("PROVIDER_CONFIGURATION_ERROR");
  return new WebProviderClient(config.PROVIDER_WEB_URL, Buffer.from(key, "hex"));
}
