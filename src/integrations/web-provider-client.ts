import { readFile } from "node:fs/promises";
import { z } from "zod";
import { providerSessionSchema, providerQrSchema, providerDeliveriesSchema, signedHeaders, type ProviderSession, type ProviderQr } from "../../contracts/provider-internal.js";
import type { Config } from "../infrastructure/config.js";
export type ProviderScope = { organizationId: string; connectionId: string };
export type InternalAction = "connect" | "refresh" | "logout";
export type Delivery = z.infer<typeof providerDeliveriesSchema>["deliveries"][number];
export interface WebProviderPort {
  ready(): Promise<boolean>;
  create(scope: ProviderScope): Promise<ProviderSession>;
  session(scope: ProviderScope): Promise<ProviderSession>;
  command(scope: ProviderScope, action: InternalAction, commandId: string): Promise<ProviderSession>;
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
      const response = await fetch(this.url + path, { method, redirect: "error", signal: AbortSignal.timeout(7000), headers: { ...signedHeaders(this.key, method, path, body), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const reader = response.body?.getReader(); if (!reader) throw new Error();
      const chunks: Uint8Array[] = []; let bytes = 0;
      try { for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 256 * 1024) throw new Error(); chunks.push(next.value); } } finally { await reader.cancel(); }
      const result: unknown = JSON.parse(Buffer.concat(chunks).toString());
      if (!response.ok) {
        const error = z.object({ error: z.object({ code: z.string() }) }).safeParse(result);
        const code = error.success && ["QR_NOT_AVAILABLE", "SESSION_NOT_FOUND", "CONNECTIONS_DISABLED", "INVALID_SESSION_STATE", "IDEMPOTENCY_CONFLICT"].includes(error.data.error.code) ? error.data.error.code : "PROVIDER_UNAVAILABLE";
        throw new WebProviderError(code, response.status);
      }
      return result;
    } catch (reason) { if (reason instanceof WebProviderError) throw reason; throw new WebProviderError("PROVIDER_UNAVAILABLE"); }
  }
  async ready() { try { const result = z.strictObject({ status: z.literal("ready"), connectionsEnabled: z.boolean() }).parse(await this.request("GET", "/health/ready")); return result.connectionsEnabled; } catch { return false; } }
  async create(scope: ProviderScope) { return providerSessionSchema.parse(await this.request("PUT", prefix(scope))); }
  async session(scope: ProviderScope) { return providerSessionSchema.parse(await this.request("GET", prefix(scope))); }
  async command(scope: ProviderScope, action: InternalAction, commandId: string) { return providerSessionSchema.parse(await this.request("POST", `${prefix(scope)}/commands`, { action, commandId })); }
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
