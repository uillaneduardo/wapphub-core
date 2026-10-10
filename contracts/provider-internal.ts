import { createHash, createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { providerEventSchema } from "./provider.js";

export const providerStates = ["DISCONNECTED", "CONNECTING", "QR_REQUIRED", "CONNECTED", "RECONNECTING", "FAILED", "LOGGED_OUT"] as const;
export const providerSessionSchema = z.strictObject({ state: z.enum(providerStates), revision: z.number().int().min(0), qrRevision: z.number().int().min(0), attempts: z.number().int().min(0), errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional(), connectEnabled: z.boolean() });
export type ProviderSession = z.infer<typeof providerSessionSchema>;
export const providerQrSchema = z.strictObject({ qr: z.string().min(1).max(8192), revision: z.number().int().min(1), expiresAt: z.iso.datetime({ offset: true }) });
export type ProviderQr = z.infer<typeof providerQrSchema>;
export const providerDeliveriesSchema = z.strictObject({ deliveries: z.array(z.strictObject({ event: providerEventSchema, leaseId: z.uuid(), attempt: z.number().int().min(1).max(5) })).max(20) });
export function signature(key: Buffer, method: string, path: string, body: unknown, timestamp: string, nonce: string) {
  const digest = createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
  return createHmac("sha256", key).update(JSON.stringify([1, "core", method, path, timestamp, nonce, digest])).digest("hex");
}
export function signedHeaders(key: Buffer, method: string, path: string, body?: unknown, now = Date.now()) {
  const timestamp = String(now), nonce = randomUUID();
  return { "x-wapphub-client": "core", "x-wapphub-timestamp": timestamp, "x-wapphub-nonce": nonce, "x-wapphub-signature": signature(key, method, path, body, timestamp, nonce) };
}
