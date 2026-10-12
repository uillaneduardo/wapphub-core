import { createHash, createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { historyViewSchema } from "./history.js";
import { providerEventSchema } from "./provider.js";

export const providerStates = ["DISCONNECTED", "CONNECTING", "QR_REQUIRED", "CONNECTED", "RECONNECTING", "FAILED", "LOGGED_OUT"] as const;
const count = z.number().int().min(0);
export const syncSources = ["CONTACTS_UPSERT", "CONTACTS_UPDATE", "CHATS_UPSERT", "CHATS_UPDATE", "IDENTITY_MAPPING", "HISTORY_CONTACTS", "HISTORY_CHATS", "HISTORY_MESSAGES", "MESSAGES_NOTIFY", "MESSAGES_APPEND"] as const;
export const syncReasons = ["SYSTEM_NOTICE", "PROTOCOL_MESSAGE", "UNSUPPORTED_CONTENT", "UNSUPPORTED_IDENTITY", "INVALID_IDENTITY", "INVALID_MESSAGE", "INVALID_CONTENT", "NORMALIZATION_FAILED", "STAGING_INVALID", "STAGING_LIMIT"] as const;
export const syncObservationSchema = z.strictObject({ source: z.enum(syncSources), received: count, normalized: count, ignored: count, rejected: count, failures: count, reasons: z.partialRecord(z.enum(syncReasons), count) });
export type SyncObservation = z.infer<typeof syncObservationSchema>;
export const syncDiagnosticsSchema = z.strictObject({ since: z.iso.datetime({ offset: true }), received: count, normalized: count, ignored: count, rejected: count, failures: count, legacyFailures: count, publishedBatches: count, acknowledgedBatches: count, sourceCounts: z.partialRecord(z.enum(syncSources), count), reasons: z.partialRecord(z.enum(syncReasons), count), lastSource: z.enum(syncSources).optional(), lastCode: z.enum(syncReasons).optional() });
export const processingFailureSchema = z.strictObject({ id: z.uuid(), code: z.enum(["SYNC_BACKPRESSURE", "EVENT_QUEUE_FULL", "AUTH_PERSISTENCE_FAILED", "VAULT_LIMIT", "STORAGE_FULL", "STORAGE_IO_FAILED", "SESSION_PROCESSING_FAILED"]), stage: z.enum(["QUEUE", "PERSISTENCE"]), occurredAt: z.iso.datetime({ offset: true }), recoveredAt: z.iso.datetime({ offset: true }).optional() });
export const lifecycleSchema = z.strictObject({ linked: z.boolean(), desired: z.boolean(), recoveryEligible: z.boolean(), recovery: z.strictObject({ commandId: z.uuid(), state: z.enum(["RUNNING", "AUTHENTICATED", "SUCCEEDED", "FAILED", "INTERRUPTED"]), startedAt: z.iso.datetime(), finishedAt: z.iso.datetime().optional(), errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional() }).optional(), termination: z.strictObject({ commandId: z.uuid(), action: z.enum(["disconnect", "logout"]), remote: z.enum(["NOT_REQUESTED", "PENDING", "CONFIRMED", "UNCONFIRMED"]), requestedAt: z.iso.datetime(), finishedAt: z.iso.datetime().optional(), errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional() }).optional() });
export type SessionLifecycle = z.infer<typeof lifecycleSchema>;
export const providerSyncSchema = z.strictObject({ historyEnabled: z.boolean(), phase: z.enum(["DISABLED", "AWAITING_HISTORY", "CONTACTS", "MESSAGES", "PROCESSED", "PARTIAL"]), queued: count, contacts: count, conversations: count, messages: count, failures: count, limited: z.boolean(), durationMs: count, diagnostics: syncDiagnosticsSchema.optional(), activeTransport: z.boolean().optional(), processingFailure: processingFailureSchema.optional(), lifecycle: lifecycleSchema.optional() });
export type ProviderSync = z.infer<typeof providerSyncSchema>;
export const providerSessionSchema = z.strictObject({ state: z.enum(providerStates), revision: z.number().int().min(0), qrRevision: z.number().int().min(0), attempts: z.number().int().min(0), errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional(), connectEnabled: z.boolean(), history: historyViewSchema.optional(), sync: providerSyncSchema.optional(), pairingPhase: z.enum(["IDLE", "GENERATING_QR", "WAITING_SCAN", "AUTHENTICATING", "CONNECTED", "RECONNECTING"]).optional() });
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

/** Namespaced correlation for protocol-delivered bootstrap, not a grant/request.
 * Scope is already authenticated/fenced; this ID cannot authorize fetch history. */
export function bootstrapCorrelationId(scope: { organizationId: string; connectionId: string }) {
  const hex = createHash("sha256").update(JSON.stringify(["wapphub-bootstrap:v1", scope.organizationId, scope.connectionId])).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
