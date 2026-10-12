import { randomUUID } from "node:crypto";
import type { PrismaClient, ProviderConnection, ProviderCommand } from "@prisma/client";
import { lifecycleSchema, type ProviderSession } from "../../contracts/provider-internal.js";
import type { Principal } from "./foundation.js";
import type { Chat } from "./chat.js";
import type { WebProviderPort } from "../integrations/web-provider-client.js";
import { WebProviderError } from "../integrations/web-provider-client.js";
import { AppError } from "../domain/errors.js";
import { historyRecord } from "./web-history.js";
import { syncProgress } from "./web-sync.js";
export type ConnectionAction = "connect" | "refresh" | "recover" | "disconnect" | "logout" | "prepare_link";
export type CommandInput = { commandId: string; action: ConnectionAction; expectedVersion: number; confirmed?: boolean; removedOnPhone?: boolean };
const pending = { in: ["PENDING", "PROCESSING"] };
export function connectionDTO(record: ProviderConnection, command?: ProviderCommand | null) {
  const state = record.state;
  const provider = record.providerSync && typeof record.providerSync === "object" && !Array.isArray(record.providerSync) ? { ...record.providerSync } : null;
  const lifecycle = lifecycleSchema.safeParse(provider?.lifecycle); const transportConfirmed = provider?.activeTransport === true && state === "CONNECTED" && record.errorCode !== "PROVIDER_UNAVAILABLE";
  if (provider) { delete provider.lifecycle; delete provider.processingFailure; delete provider.activeTransport; }
  const { failedBatches, lastBatch: _lastBatch, occurrences: _occurrences, diagnosticEvictions: _evictions, ...progress } = syncProgress(record.syncProgress);
  void _lastBatch; void _occurrences; void _evictions; // Private diagnostic fields require a separate permission.
  return { id: record.channelId, state,
    uiState: state === "QR_REQUIRED" ? "QR_READY" : state === "FAILED" ? "ERROR" : state === "LOGGED_OUT" ? "DISCONNECTED" : state,
    version: record.version, qrRevision: record.qrRevision,
    errorCode: record.errorCode,
    transportConfirmed,
    lastCheckedAt: record.lastCheckedAt?.toISOString() ?? null,
    pairingPhase: record.pairingPhase ?? null,
    sync: { ...progress, pendingFailures: Object.keys(failedBatches).length, provider },
    operation: command ? { id: command.id, action: command.action, status: command.status, errorCode: command.errorCode, createdAt: command.createdAt.toISOString(), updatedAt: command.updatedAt.toISOString(), attempts: command.attempts, nextAttemptAt: command.nextAttemptAt.toISOString() } : null,
    sendingEnabled: record.outboundEnabled, mediaEnabled: record.mediaEnabled, lifecycle: lifecycle.success ? lifecycle.data : null,
  };
}
export class WebConnections {
  constructor(private readonly db: PrismaClient, private readonly chat: Chat, readonly client?: WebProviderPort) {}
  private dto(record: ProviderConnection, command?: ProviderCommand | null) {
    return { ...connectionDTO(record, command), sendingEnabled: this.chat.outboundExecutionEnabled && record.outboundEnabled, mediaEnabled: this.chat.mediaExecutionEnabled && record.mediaEnabled };
  }
  private enabled() { if (!this.client) throw new AppError(503, "PROVIDER_NOT_ENABLED"); }
  async read(p: Principal) {
    const c = await this.chat.context(p, "providers.manage"); this.enabled();
    const record = await this.db.providerConnection.findFirst({ where: { organizationId: c.organizationId, channel: { provider: "WHATSAPP_WEB" } }, include: { commands: { where: { action: { not: "send" } }, orderBy: { createdAt: "desc" }, take: 1 } } });
    return { connection: record ? this.dto(record, record.commands[0]) : null };
  }
  async create(p: Principal, commandId: string) {
    await this.chat.context(p, "providers.manage"); this.enabled();
    return this.chat.mutation(p, "providers.manage", async (tx, c) => {
      const channel = await tx.channel.upsert({ where: { organizationId_provider: { organizationId: c.organizationId, provider: "WHATSAPP_WEB" } }, create: { organizationId: c.organizationId, provider: "WHATSAPP_WEB", status: "DISABLED" }, update: {} });
      let record = await tx.providerConnection.findUnique({ where: { organizationId_channelId: { organizationId: c.organizationId, channelId: channel.id } } });
      if (record) {
        const last = await tx.providerCommand.findFirst({ where: { organizationId: c.organizationId, channelId: channel.id, action: { not: "send" } }, orderBy: { createdAt: "desc" } });
        return this.dto(record, last);
      }
      record = await tx.providerConnection.create({ data: { organizationId: c.organizationId, channelId: channel.id } });
      const command = await tx.providerCommand.create({ data: { id: commandId, organizationId: c.organizationId, channelId: channel.id, actorUserId: c.userId, sessionId: p.session.id, action: "create" } });
      await tx.auditEvent.create({ data: { organizationId: c.organizationId, actorUserId: c.userId, action: "WHATSAPP_WEB_CONNECTION_CREATED", details: { channelId: channel.id, commandId } } });
      await this.chat.resourceEvent(tx, c.organizationId, "provider.connection.updated", channel.id);
      return this.dto(record, command);
    });
  }
  async command(p: Principal, id: string, input: CommandInput) {
    await this.chat.context(p, "providers.manage"); this.enabled();
    return this.chat.mutation(p, "providers.manage", async (tx, c) => {
      const record = await tx.providerConnection.findFirst({ where: { organizationId: c.organizationId, channelId: id, channel: { provider: "WHATSAPP_WEB" } } });
      if (!record) throw new AppError(404, "NOT_FOUND");
      const existing = await tx.providerCommand.findFirst({ where: { id: input.commandId, organizationId: c.organizationId, channelId: id } });
      if (existing) {
        if (existing.action !== input.action || existing.actorUserId !== c.userId || input.action === "prepare_link" && !!(existing.payload && typeof existing.payload === "object" && !Array.isArray(existing.payload) && existing.payload.removedOnPhone) !== (input.removedOnPhone === true)) throw new AppError(409, "IDEMPOTENCY_CONFLICT");
        return this.dto(record, existing);
      }
      if (record.version !== input.expectedVersion) throw new AppError(409, "CONNECTION_VERSION_CONFLICT");
      const stopping = ["disconnect", "logout"].includes(input.action);
      if (["recover", "logout", "prepare_link"].includes(input.action) && input.confirmed !== true) throw new AppError(400, "EXPLICIT_CONFIRMATION_REQUIRED");
      if (!stopping && await tx.providerCommand.count({ where: { organizationId: c.organizationId, channelId: id, status: pending } })) throw new AppError(409, "CONNECTION_OPERATION_PENDING");
      if (input.action === "prepare_link") {
        const lifecycle = lifecycleSchema.safeParse(record.providerSync && typeof record.providerSync === "object" && !Array.isArray(record.providerSync) ? record.providerSync.lifecycle : null);
        if (!lifecycle.success || !lifecycle.data.preparationEligible || lifecycle.data.removalConfirmationRequired && input.removedOnPhone !== true) throw new AppError(409, "LINK_PREPARATION_DENIED");
      }
      if (input.action === "refresh" && (record.pairingPhase === "AUTHENTICATING" || !["QR_REQUIRED", "CONNECTING"].includes(record.state))) throw new AppError(409, "INVALID_SESSION_STATE");
      if (input.action === "connect" && record.state === "CONNECTED") throw new AppError(409, "CONNECTION_ALREADY_CONNECTED");
      if (input.action === "recover" && (!["FAILED", "DISCONNECTED"].includes(record.state) || ["SESSION_REVOKED", "SESSION_REPLACED", "BAD_SESSION"].includes(record.errorCode ?? ""))) throw new AppError(409, "RECOVERY_NOT_ELIGIBLE");
      const lifecycle = lifecycleSchema.safeParse(record.providerSync && typeof record.providerSync === "object" && !Array.isArray(record.providerSync) ? record.providerSync.lifecycle : null);
      const unlinkedPairing = input.action === "connect" && lifecycle.success && lifecycle.data.pairingEligible === true && lifecycle.data.linked === false && record.lastCheckedAt !== null && Date.now() - record.lastCheckedAt.getTime() < 30_000;
      if (["connect", "refresh"].includes(input.action) && (["SESSION_REVOKED", "SESSION_REPLACED", "BAD_SESSION"].includes(record.errorCode ?? "") || record.errorCode === "RECONNECT_LIMIT" && !unlinkedPairing)) throw new AppError(409, "CONTROLLED_RECOVERY_REQUIRED");
      if (stopping) {
        await tx.providerCommand.updateMany({ where: { organizationId: c.organizationId, channelId: id, status: pending, action: { in: ["connect", "refresh", "recover", "disconnect", "logout", "prepare_link", "history_prepare", "history_start", "history_resume", "history_reconcile"] } }, data: { status: "FAILED", errorCode: "CONNECTION_STOP_AUTHORIZED" } });
        const op = historyRecord(record.historyOperation); if (op?.authorization) { op.authorization.state = "PAUSED"; await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: c.organizationId, channelId: id } }, data: { historyOperation: op } }); }
        await tx.channel.update({ where: { organizationId_id: { organizationId: c.organizationId, id } }, data: { status: "DISABLED" } });
      }
      const command = await tx.providerCommand.create({ data: { id: input.commandId, organizationId: c.organizationId, channelId: id, actorUserId: c.userId, sessionId: p.session.id, action: input.action, payload: { controlVersion: record.version + 1, ...(input.action === "prepare_link" ? { removedOnPhone: input.removedOnPhone === true } : {}) } } });
      const updated = await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: c.organizationId, channelId: id } }, data: { version: { increment: 1 }, ...(stopping || input.action === "prepare_link" ? { outboundEnabled: false, mediaEnabled: false } : {}) } });
      await tx.auditEvent.create({ data: { organizationId: c.organizationId, actorUserId: c.userId, action: `WHATSAPP_WEB_${input.action.toUpperCase()}_REQUESTED`, details: { channelId: id, commandId: input.commandId, ...(input.action === "prepare_link" ? { removedOnPhone: input.removedOnPhone === true } : {}) } } });
      await this.chat.resourceEvent(tx, c.organizationId, "provider.connection.updated", id);
      return this.dto(updated, command);
    });
  }
  async qr(p: Principal, id: string) {
    const c = await this.chat.context(p, "providers.manage"); this.enabled();
    const record = await this.db.providerConnection.findFirst({ where: { organizationId: c.organizationId, channelId: id, channel: { provider: "WHATSAPP_WEB" } } });
    if (!record) throw new AppError(404, "NOT_FOUND");
    let qr;
    try { qr = await this.client!.qr({ organizationId: c.organizationId, connectionId: record.channelId }); }
    catch (error) { throw new AppError(error instanceof WebProviderError && error.code === "QR_NOT_AVAILABLE" ? 404 : 503, error instanceof WebProviderError && error.code === "QR_NOT_AVAILABLE" ? "QR_NOT_AVAILABLE" : "PROVIDER_UNAVAILABLE"); }
    const expires = Date.parse(qr.expiresAt);
    if (expires <= Date.now() || expires > Date.now() + 30_000) throw new AppError(409, "QR_EXPIRED");
    // Reauthorize and check the current generation after the remote read. No QR is
    // persisted in the transaction, audit, realtime, logs or browser storage.
    return this.chat.mutation(p, "providers.manage", async (tx, context) => {
      if (context.organizationId !== c.organizationId) throw new AppError(403, "ORGANIZATION_ACCESS_DENIED");
      const current = await tx.providerConnection.findFirst({ where: { organizationId: c.organizationId, channelId: id } });
      if (!current || current.state !== "QR_REQUIRED" || current.qrRevision !== qr.revision) throw new AppError(409, "QR_CHANGED");
      if (expires <= Date.now()) throw new AppError(409, "QR_EXPIRED");
      await tx.auditEvent.create({ data: { organizationId: c.organizationId, actorUserId: context.userId, action: "WHATSAPP_WEB_QR_VIEWED", details: { channelId: id, revision: qr.revision } } });
      const expiresInMs = expires - Date.now();
      if (expiresInMs <= 0) throw new AppError(409, "QR_EXPIRED");
      return { ...qr, expiresInMs };
    });
  }
  async synchronize(scope: { organizationId: string; connectionId: string }, view: ProviderSession, leaseToken: string, unavailable = false) {
    return this.chat.integrationMutation(scope.organizationId, async (tx) => {
      const record = await tx.providerConnection.findFirst({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, leaseToken, leaseUntil: { gt: new Date() }, channel: { provider: "WHATSAPP_WEB" } } });
      if (!record) throw new AppError(409, "STALE_PROVIDER_LEASE");
      if (view.revision < record.providerRevision) return false;
      const errorCode = unavailable ? "PROVIDER_UNAVAILABLE" : view.errorCode ?? null;
      const history = historyRecord(record.historyOperation);
      const historyChanged = !!history && !!view.history && view.history.id === history.id && JSON.stringify(history.source) !== JSON.stringify(view.history);
      if (historyChanged) { history!.source = view.history; history!.state = view.history!.state; }
      const changed = historyChanged || view.revision !== record.providerRevision || view.state !== record.state || record.errorCode !== errorCode || JSON.stringify(record.providerSync) !== JSON.stringify(view.sync ?? null) || record.pairingPhase !== (view.pairingPhase ?? null);
      await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: scope.organizationId, channelId: scope.connectionId } }, data: { ...(historyChanged ? { historyOperation: history } : {}), state: view.state, qrRevision: view.qrRevision, providerRevision: view.revision, errorCode, lastCheckedAt: new Date(), pairingPhase: view.pairingPhase ?? null, ...(view.sync ? { providerSync: view.sync } : {}), ...(changed ? { version: { increment: 1 } } : {}) } });
      await tx.channel.update({ where: { organizationId_id: { organizationId: scope.organizationId, id: scope.connectionId } }, data: { status: view.state === "CONNECTED" ? "ENABLED" : "DISABLED" } });
      if (changed) await this.chat.resourceEvent(tx, scope.organizationId, "provider.connection.updated", scope.connectionId);
      return changed;
    }, (changed) => changed);
  }
  async claim(scope: { organizationId: string; channelId: string }) {
    const leaseToken = randomUUID();
    const claimed = await this.db.providerConnection.updateMany({ where: { ...scope, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }], channel: { provider: "WHATSAPP_WEB", organization: { status: "ACTIVE" } } }, data: { leaseToken, leaseUntil: new Date(Date.now() + 60_000) } });
    return claimed.count ? leaseToken : null;
  }
}
