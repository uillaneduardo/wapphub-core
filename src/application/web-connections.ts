import { randomUUID } from "node:crypto";
import type { PrismaClient, ProviderConnection, ProviderCommand } from "@prisma/client";
import type { ProviderSession } from "../../contracts/provider-internal.js";
import type { Principal } from "./foundation.js";
import type { Chat } from "./chat.js";
import type { WebProviderPort } from "../integrations/web-provider-client.js";
import { WebProviderError } from "../integrations/web-provider-client.js";
import { AppError } from "../domain/errors.js";
export type ConnectionAction = "connect" | "refresh" | "disconnect";
export type CommandInput = { commandId: string; action: ConnectionAction; expectedVersion: number };
const pending = { in: ["PENDING", "PROCESSING"] };
export function connectionDTO(record: ProviderConnection, command?: ProviderCommand | null) {
  const state = record.state;
  return { id: record.channelId, state,
    uiState: state === "QR_REQUIRED" ? "QR_READY" : state === "FAILED" ? "ERROR" : state === "LOGGED_OUT" ? "DISCONNECTED" : state,
    version: record.version, qrRevision: record.qrRevision,
    errorCode: record.errorCode,
    lastCheckedAt: record.lastCheckedAt?.toISOString() ?? null,
    operation: command ? { id: command.id, action: command.action, status: command.status, errorCode: command.errorCode } : null,
    sendingEnabled: false, mediaEnabled: false,
  };
}
export class WebConnections {
  constructor(private readonly db: PrismaClient, private readonly chat: Chat, readonly client?: WebProviderPort) {}
  private enabled() { if (!this.client) throw new AppError(503, "PROVIDER_NOT_ENABLED"); }
  async read(p: Principal) {
    const c = await this.chat.context(p, "providers.manage"); this.enabled();
    const record = await this.db.providerConnection.findFirst({ where: { organizationId: c.organizationId, channel: { provider: "WHATSAPP_WEB" } }, include: { commands: { orderBy: { createdAt: "desc" }, take: 1 } } });
    return { connection: record ? connectionDTO(record, record.commands[0]) : null };
  }
  async create(p: Principal, commandId: string) {
    await this.chat.context(p, "providers.manage"); this.enabled();
    return this.chat.mutation(p, "providers.manage", async (tx, c) => {
      const channel = await tx.channel.upsert({ where: { organizationId_provider: { organizationId: c.organizationId, provider: "WHATSAPP_WEB" } }, create: { organizationId: c.organizationId, provider: "WHATSAPP_WEB", status: "DISABLED" }, update: {} });
      let record = await tx.providerConnection.findUnique({ where: { organizationId_channelId: { organizationId: c.organizationId, channelId: channel.id } } });
      if (record) {
        const last = await tx.providerCommand.findFirst({ where: { organizationId: c.organizationId, channelId: channel.id }, orderBy: { createdAt: "desc" } });
        return connectionDTO(record, last);
      }
      record = await tx.providerConnection.create({ data: { organizationId: c.organizationId, channelId: channel.id } });
      const command = await tx.providerCommand.create({ data: { id: commandId, organizationId: c.organizationId, channelId: channel.id, actorUserId: c.userId, sessionId: p.session.id, action: "create" } });
      await tx.auditEvent.create({ data: { organizationId: c.organizationId, actorUserId: c.userId, action: "WHATSAPP_WEB_CONNECTION_CREATED", details: { channelId: channel.id, commandId } } });
      await this.chat.resourceEvent(tx, c.organizationId, "provider.connection.updated", channel.id);
      return connectionDTO(record, command);
    });
  }
  async command(p: Principal, id: string, input: CommandInput) {
    await this.chat.context(p, "providers.manage"); this.enabled();
    return this.chat.mutation(p, "providers.manage", async (tx, c) => {
      const record = await tx.providerConnection.findFirst({ where: { organizationId: c.organizationId, channelId: id, channel: { provider: "WHATSAPP_WEB" } } });
      if (!record) throw new AppError(404, "NOT_FOUND");
      const existing = await tx.providerCommand.findFirst({ where: { id: input.commandId, organizationId: c.organizationId, channelId: id } });
      if (existing) {
        if (existing.action !== input.action || existing.actorUserId !== c.userId) throw new AppError(409, "IDEMPOTENCY_CONFLICT");
        return connectionDTO(record, existing);
      }
      if (record.version !== input.expectedVersion) throw new AppError(409, "CONNECTION_VERSION_CONFLICT");
      if (await tx.providerCommand.count({ where: { organizationId: c.organizationId, channelId: id, status: pending } })) throw new AppError(409, "CONNECTION_OPERATION_PENDING");
      if (input.action === "refresh" && !["QR_REQUIRED", "CONNECTING"].includes(record.state)) throw new AppError(409, "INVALID_SESSION_STATE");
      if (input.action === "connect" && record.state === "CONNECTED") throw new AppError(409, "CONNECTION_ALREADY_CONNECTED");
      const command = await tx.providerCommand.create({ data: { id: input.commandId, organizationId: c.organizationId, channelId: id, actorUserId: c.userId, sessionId: p.session.id, action: input.action } });
      const updated = await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: c.organizationId, channelId: id } }, data: { version: { increment: 1 } } });
      await tx.auditEvent.create({ data: { organizationId: c.organizationId, actorUserId: c.userId, action: `WHATSAPP_WEB_${input.action.toUpperCase()}_REQUESTED`, details: { channelId: id, commandId: input.commandId } } });
      await this.chat.resourceEvent(tx, c.organizationId, "provider.connection.updated", id);
      return connectionDTO(updated, command);
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
  async synchronize(scope: { organizationId: string; connectionId: string }, view: ProviderSession, leaseToken: string) {
    return this.chat.integrationMutation(scope.organizationId, async (tx) => {
      const record = await tx.providerConnection.findFirst({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, leaseToken, leaseUntil: { gt: new Date() }, channel: { provider: "WHATSAPP_WEB" } } });
      if (!record) throw new AppError(409, "STALE_PROVIDER_LEASE");
      if (view.revision < record.providerRevision) return false;
      const changed = view.revision !== record.providerRevision || view.state !== record.state || record.errorCode !== (view.errorCode ?? null);
      await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: scope.organizationId, channelId: scope.connectionId } }, data: { state: view.state, qrRevision: view.qrRevision, providerRevision: view.revision, errorCode: view.errorCode ?? null, lastCheckedAt: new Date(), ...(changed ? { version: { increment: 1 } } : {}) } });
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
