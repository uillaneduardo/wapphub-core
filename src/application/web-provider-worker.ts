import { z } from "zod";
import { sendIntentSchema, type SendResult } from "../../contracts/provider-outbound.js";
import type { ProviderCommand } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { historyControlSchema } from "../../contracts/history.js";
import { historyPermissions, historyRecord, historyGrantValid, selectHistoryAnchors } from "./web-history.js";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Chat } from "./chat.js";
import { WebConnections } from "./web-connections.js";
import { recordSyncFailure } from "./web-sync.js";
import { WebIngestion } from "./web-ingestion.js";
import { AppError } from "../domain/errors.js";
import { WebProviderError, type WebProviderPort, type InternalAction } from "../integrations/web-provider-client.js";
type Scope = { organizationId: string; connectionId: string };
export class WebProviderWorker {
  private readonly connections: WebConnections;
  private readonly ingestion: WebIngestion;
  private cursor?: { organizationId: string; channelId: string };
  constructor(private readonly db: PrismaClient, private readonly chat: Chat, private readonly client: WebProviderPort, private readonly onError: (code: string) => void = () => {}, private readonly onMetric: (fields: { code: string; durationMs: number; items: number; historical: boolean; committed: boolean; stage?: string; errorCode?: string }) => void = () => {}) {
    this.connections = new WebConnections(db, chat, client); this.ingestion = new WebIngestion(chat);
  }
  private async fence(tx: Prisma.TransactionClient, scope: Scope, token: string) {
    if (!await tx.providerConnection.findFirst({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, leaseToken: token, leaseUntil: { gt: new Date() }, channel: { provider: "WHATSAPP_WEB" } } })) throw new AppError(409, "STALE_PROVIDER_LEASE");
  }
  async runConnection(scope: Scope) {
    const token = await this.connections.claim({ organizationId: scope.organizationId, channelId: scope.connectionId });
    if (!token) return;
    try {
      const available = await this.client.ready();
      // Even an unready service may still drain its durable queue. Never execute
      // lifecycle commands until ready, and retain the unavailability marker.
      const prioritySend = available ? await this.db.providerCommand.findFirst({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, action: "send", status: { in: ["PENDING", "PROCESSING"] }, nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: "asc" } }) : null;
      const stop = available ? await this.db.providerCommand.findFirst({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, action: { in: ["disconnect", "logout"] }, status: { in: ["PENDING", "PROCESSING"] }, nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: "desc" } }) : null;
      const command = stop ?? prioritySend ?? (available ? await this.db.providerCommand.findFirst({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, status: { in: ["PENDING", "PROCESSING"] }, nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: "asc" } }) : null);
      if (command?.action === "send") await this.dispatchSend(scope, token, command);
      else if (command) {
        await this.chat.integrationMutation(scope.organizationId, async (tx) => { await this.fence(tx, scope, token); const current = await tx.providerCommand.findUniqueOrThrow({ where: { id: command.id } }); if (!["PENDING", "PROCESSING"].includes(current.status)) throw new AppError(409, "STALE_CONTROL_COMMAND"); await tx.providerCommand.update({ where: { id: command.id }, data: { status: "PROCESSING", attempts: { increment: 1 } } }); });
        try {
          const session = await this.db.session.findFirst({ where: { id: command.sessionId, userId: command.actorUserId, currentOrganizationId: scope.organizationId }, include: { user: true } });
          const row = await this.db.providerConnection.findUniqueOrThrow({ where: { organizationId_channelId: { organizationId: scope.organizationId, channelId: scope.connectionId } } });
          const durable = command.action.startsWith("history_") && !!historyRecord(row.historyOperation)?.authorization;
          if (durable) {
            const op = historyRecord(row.historyOperation);
            const stopping = ["history_pause", "history_cancel"].includes(command.action);
            if (!stopping && !await historyGrantValid(this.db, scope, op)) throw new AppError(403, "COMMAND_AUTHORIZATION_REVOKED");
          } else {
            if (!session) throw new AppError(403, "COMMAND_AUTHORIZATION_REVOKED");
            await this.chat.context({ session, user: session.user }, "providers.manage");
          }
          // Only explicitly requested create/connect produces a session/socket.
          let view;
          if (command.action.startsWith("history_")) {
            if (!durable && session) for (const permission of historyPermissions) await this.chat.context({ session, user: session.user }, permission);
            const control = historyControlSchema.parse(command.payload);
            if (["start", "resume", "reconcile"].includes(control.action) && !this.chat.historyExecutionEnabled) throw new AppError(403, "HISTORY_EXECUTION_DISABLED");
            if (!this.client.history) throw new WebProviderError("HISTORY_TRANSPORT_UNAVAILABLE", 409);
            view = await this.client.history(scope, control);
          } else {
            await this.client.create(scope);
            const control = z.object({ controlVersion: z.number().int().positive(), removedOnPhone: z.boolean().optional() }).safeParse(command.payload);
            view = command.action === "create" ? await this.client.session(scope) : await this.client.command(scope, command.action as InternalAction, command.id, control.success ? control.data.controlVersion : undefined, control.success ? control.data.removedOnPhone : undefined);
          }
          await this.connections.synchronize(scope, view, token);
          await this.chat.integrationMutation(scope.organizationId, async (tx) => {
            await this.fence(tx, scope, token);
            const current = await tx.providerCommand.findUniqueOrThrow({ where: { id: command.id } }); if (current.status !== "PROCESSING") return;
            await tx.providerCommand.update({ where: { id: command.id }, data: { status: "COMPLETED", errorCode: view.sync?.lifecycle?.termination?.errorCode ?? null } });
            await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: scope.organizationId, channelId: scope.connectionId } }, data: { version: { increment: 1 } } });
            await tx.auditEvent.create({ data: { organizationId: scope.organizationId, actorUserId: command.actorUserId, action: "WHATSAPP_WEB_COMMAND_COMPLETED", details: { channelId: scope.connectionId, commandId: command.id, action: command.action, ...(view.sync?.lifecycle?.termination ? { remote: view.sync.lifecycle.termination.remote } : {}) } } });
            await this.chat.resourceEvent(tx, scope.organizationId, "provider.connection.updated", scope.connectionId);
          });
        } catch (error) {
          const attempts = command.attempts + 1;
          const permanent = error instanceof WebProviderError && error.code === "SESSION_COMMAND_LIMIT" || error instanceof AppError && [401, 403, 409].includes(error.status) || error instanceof WebProviderError && [400, 403, 409].includes(error.status);
          const code = error instanceof AppError && [401, 403].includes(error.status) ? "COMMAND_AUTHORIZATION_REVOKED" : error instanceof WebProviderError ? error.code : "PROVIDER_OPERATION_FAILED";
          await this.chat.integrationMutation(scope.organizationId, async (tx) => {
            await this.fence(tx, scope, token);
            const current = await tx.providerCommand.findUniqueOrThrow({ where: { id: command.id } }); if (current.status === "FAILED" && current.errorCode === "CONNECTION_STOP_AUTHORIZED") return;
            await tx.providerCommand.update({ where: { id: command.id }, data: { status: permanent || attempts >= 5 ? "FAILED" : "PENDING", errorCode: code, nextAttemptAt: new Date(Date.now() + Math.min(30_000, 1000 * 2 ** attempts)) } });
            const row = await tx.providerConnection.findUniqueOrThrow({ where: { organizationId_channelId: { organizationId: scope.organizationId, channelId: scope.connectionId } } });
            const op = historyRecord(row.historyOperation);
            if (command.action.startsWith("history_") && op?.authorization && (permanent || attempts >= 5)) {
              op.authorization.state = code === "COMMAND_AUTHORIZATION_REVOKED" ? "DISABLED" : "PAUSED";
              op.errorCode = code;
            }
            await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: scope.organizationId, channelId: scope.connectionId } }, data: { ...(command.action.startsWith("history_") ? op ? { historyOperation: op } : {} : { errorCode: code }), version: { increment: 1 } } });
            await this.chat.resourceEvent(tx, scope.organizationId, "provider.connection.updated", scope.connectionId);
          });
          // Revoke the producer immediately even when an outbox command failed
          // before the normal active-operation check. Do not wait for its lease.
          if (command.action.startsWith("history_") && (permanent || attempts >= 5) && this.client.history) {
            const control = historyControlSchema.safeParse(command.payload);
            if (control.success) await this.client.history(scope, { action: "pause", operationId: control.data.operationId, commandId: randomUUID() }).catch(() => this.onError("HISTORY_PAUSE_FAILED"));
          }
          return;
        }
      }
      const view = await this.client.session(scope);
      if (view.history && ["RUNNING", "WAITING", "BACKPRESSURE"].includes(view.history.state)) {
        const row = await this.db.providerConnection.findUniqueOrThrow({ where: { organizationId_channelId: { organizationId: scope.organizationId, channelId: scope.connectionId } } });
        const op = historyRecord(row.historyOperation);
        let authorized = available && view.state === "CONNECTED" && this.chat.historyExecutionEnabled && op?.id === view.history.id;
        if (authorized && op?.authorization) authorized = await historyGrantValid(this.db, scope, op);
        else if (authorized && op) {
          try { const session = await this.db.session.findUniqueOrThrow({ where: { id: op.sessionId }, include: { user: true } }); for (const permission of historyPermissions) await this.chat.context({ session, user: session.user }, permission); authorized = session.currentOrganizationId === scope.organizationId; } catch { authorized = false; }
        }
        if (!authorized && this.client.history) await this.client.history(scope, { action: "pause", operationId: view.history.id, commandId: randomUUID() }).catch(() => this.onError("HISTORY_PAUSE_FAILED"));
      }
      await this.connections.synchronize(scope, view, token, !available);
      await this.drain(scope, token, available);
      if (available) { await this.expireUnconfirmed(scope, token); await this.coordinate(scope, token); }
    } catch (error) {
      if (error instanceof AppError && error.code === "STALE_PROVIDER_LEASE") throw error;
      this.onError(error instanceof WebProviderError ? error.code : "PROVIDER_SYNC_FAILED");
      await this.chat.integrationMutation(scope.organizationId, async (tx) => {
        await this.fence(tx, scope, token);
        const row = await tx.providerConnection.findUniqueOrThrow({ where: { organizationId_channelId: { organizationId: scope.organizationId, channelId: scope.connectionId } } });
        if (row.errorCode === "PROVIDER_UNAVAILABLE") return false;
        // Preserve the last genuine state; uncertainty is a separate failure.
        await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: scope.organizationId, channelId: scope.connectionId } }, data: { errorCode: "PROVIDER_UNAVAILABLE", version: { increment: 1 } } });
        await this.chat.resourceEvent(tx, scope.organizationId, "provider.connection.updated", scope.connectionId);
        return true;
      }, (changed) => changed);
    } finally {
      await this.db.providerConnection.updateMany({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, leaseToken: token }, data: { leaseToken: null, leaseUntil: null } });
    }
  }
  private async drain(scope: Scope, token: string, available = true) {
      for (const delivery of await this.client.pull(scope)) {
        const started = performance.now();
        try {
          const committed = await this.ingestion.apply(scope, delivery.event, token);
          if (delivery.event.type === "sync.batch") this.onMetric({ code: "PROVIDER_SYNC_BATCH", durationMs: Math.round(performance.now() - started), items: delivery.event.data.items.length, historical: delivery.event.data.historical, committed });
          // Refresh lifecycle from current metadata, never from an old replay event.
          if (delivery.event.type === "connection.updated") await this.connections.synchronize(scope, await this.client.session(scope), token, !available);
          await this.client.ack(scope, delivery.event.eventId, delivery.leaseId);
        } catch (error) {
          if (error instanceof AppError && error.code === "STALE_PROVIDER_LEASE") throw error;
          const code = error instanceof AppError ? error.code : "PERSISTENCE_FAILED";
          this.onError(code);
          const nacked = await this.client.nack(scope, delivery.event.eventId, delivery.leaseId).then(() => true, () => { this.onError("PROVIDER_NACK_FAILED"); return false; });
          if (delivery.event.type === "sync.batch") {
            this.onMetric({ code: "PROVIDER_SYNC_BATCH_FAILED", durationMs: Math.round(performance.now() - started), items: delivery.event.data.items.length, historical: delivery.event.data.historical, committed: false, stage: "PERSISTENCE", errorCode: code });
            await recordSyncFailure(this.chat, scope, delivery.event, token, code, delivery.attempt, nacked && delivery.attempt >= 5).catch(() => this.onError("SYNC_DIAGNOSTIC_WRITE_FAILED"));
          }
        }
      }
  }
  private async whileDraining<T>(scope: Scope, token: string, work: Promise<T>) {
    let settled = false;
    const pending = work.finally(() => { settled = true; });
    while (!settled) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([pending, new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); timer.unref(); })]); }
      finally { clearTimeout(timer); }
      if (!settled) await this.drain(scope, token);
    }
    return pending;
  }
  private async expireUnconfirmed(scope: Scope, token: string) {
    const pending = await this.db.message.findMany({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, direction: "OUTBOUND", senderUserId: { not: null }, status: "PENDING", deliveryOutcome: null, createdAt: { lt: new Date(Date.now() - 60000) } }, orderBy: { createdAt: "asc" }, take: 20 });
    const expired = await this.db.media.findMany({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, expiresAt: { lt: new Date() }, messageId: null }, select: { id: true }, take: 20 });
    if (!pending.length && !expired.length) return;
    await this.chat.integrationMutation(scope.organizationId, async tx => {
      await this.fence(tx, scope, token);
      for (const message of pending) {
        const sent = await tx.providerCommand.findFirst({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, action: "send", status: "COMPLETED", updatedAt: { lt: new Date(Date.now() - 60000) }, payload: { path: "$.messageId", equals: message.id } } });
        if (!sent) continue;
        const changed = await tx.message.updateMany({ where: { id: message.id, organizationId: scope.organizationId, status: "PENDING", deliveryOutcome: null }, data: { deliveryOutcome: "UNKNOWN" } });
        if (changed.count) await this.chat.resourceEvent(tx, scope.organizationId, "message.updated", message.id, message.conversationId, message.sequence);
      }
      if (expired.length) await tx.media.deleteMany({ where: { organizationId: scope.organizationId, id: { in: expired.map(x => x.id) } } });
    });
  }
  private async dispatchSend(scope: Scope, token: string, command: ProviderCommand) {
    const payload = z.strictObject({ messageId: z.uuid(), expiresAt: z.iso.datetime({ offset: true }) }).parse(command.payload);
    // SQL authorization and PROCESSING marker precede the network. Retries of
    // PROCESSING reconcile the same Provider intent; they never create another ID.
    let intent;
    try {
      intent = await this.chat.integrationMutation(scope.organizationId, async tx => {
        await this.fence(tx, scope, token);
        const session = await tx.session.findFirst({ where: { id: command.sessionId, userId: command.actorUserId, currentOrganizationId: scope.organizationId }, include: { user: true } });
        if (!session) throw new AppError(403, "COMMAND_AUTHORIZATION_REVOKED");
        const context = await this.chat.context({ session, user: session.user }, "messages.send", tx);
        if (context.organizationId !== scope.organizationId) throw new AppError(403, "COMMAND_AUTHORIZATION_REVOKED");
        const message = await tx.message.findFirst({ where: { id: payload.messageId, organizationId: scope.organizationId, channelId: scope.connectionId, senderUserId: command.actorUserId, direction: "OUTBOUND" }, include: { conversation: true } });
        if (!message || message.status !== "PENDING" || message.deliveryOutcome) throw new AppError(409, "SEND_ALREADY_RESOLVED");
        await this.chat.conversation(context, message.conversationId, tx);
        await this.chat.webConnectionReady(tx, scope.organizationId, scope.connectionId);
        if (message.mediaMetadata && (!this.chat.mediaExecutionEnabled || !(await this.chat.webConnectionReady(tx, scope.organizationId, scope.connectionId)).mediaEnabled)) throw new AppError(403, "MEDIA_DISABLED");
        if (message.conversation.status === "ARCHIVED") throw new AppError(409, "CONVERSATION_ARCHIVED");
        const parsed = sendIntentSchema.parse({ commandId: command.id, messageId: message.id, providerMessageId: message.providerMessageId, destination: message.conversation.providerConversationId, body: message.transmittedBody ?? message.body ?? "", ...(message.mediaMetadata ? { media: message.mediaMetadata } : {}), expiresAt: payload.expiresAt });
        if (!this.client.send || Date.parse(payload.expiresAt) <= Date.now()) throw new AppError(409, "SEND_UNAVAILABLE");
        await tx.providerCommand.update({ where: { id: command.id }, data: { status: "PROCESSING", attempts: { increment: 1 } } });
        return parsed;
      });
    } catch {
      // If transmission was previously possible, revocation cannot assert NOT_SENT.
      await this.finishSend(scope, token, command, payload.messageId, command.status === "PROCESSING" ? "UNKNOWN" : "NOT_SENT", "SEND_AUTHORIZATION_FAILED");
      return;
    }
    let result: SendResult;
    try { result = await this.whileDraining(scope, token, this.client.send!(scope, intent)); }
    catch { // Transport failure may have happened after transmission. Reconcile
      // the persisted intent later with the exact same ID, up to a bounded retry.
      await this.chat.integrationMutation(scope.organizationId, async tx => {
        await this.fence(tx, scope, token);
        await tx.providerCommand.update({ where: { id: command.id }, data: { status: command.attempts >= 4 ? "FAILED" : "PROCESSING", errorCode: "SEND_RESULT_UNKNOWN", nextAttemptAt: new Date(Date.now() + 30000) } });
        if (command.attempts >= 4) {
          const message = await tx.message.findFirst({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, id: payload.messageId } });
          if (message?.status === "PENDING") { await tx.message.update({ where: { id: message.id }, data: { deliveryOutcome: "UNKNOWN" } }); await this.chat.resourceEvent(tx, scope.organizationId, "message.updated", message.id, message.conversationId, message.sequence); }
        }
      });
      return;
    }
    if (result.providerMessageId !== intent.providerMessageId) throw new AppError(409, "PROVIDER_IDEMPOTENCY_CONFLICT");
    await this.finishSend(scope, token, command, payload.messageId, result.outcome, result.errorCode);
  }
  private async finishSend(scope: Scope, token: string, command: ProviderCommand, messageId: string, outcome: SendResult["outcome"], errorCode?: string) {
    await this.chat.integrationMutation(scope.organizationId, async tx => {
      await this.fence(tx, scope, token);
      const message = await tx.message.findFirst({ where: { id: messageId, organizationId: scope.organizationId, channelId: scope.connectionId } });
      if (message?.status === "PENDING" && outcome !== "DISPATCHED") {
        await tx.message.update({ where: { id: message.id }, data: { deliveryOutcome: outcome, ...(outcome === "NOT_SENT" ? { status: "FAILED" } : {}) } });
        await this.chat.resourceEvent(tx, scope.organizationId, "message.updated", message.id, message.conversationId, message.sequence);
      }
      await tx.providerCommand.update({ where: { id: command.id }, data: { status: outcome === "DISPATCHED" ? "COMPLETED" : "FAILED", errorCode: errorCode ?? (outcome === "DISPATCHED" ? null : "SEND_RESULT_" + outcome) } });
      await tx.auditEvent.create({ data: { organizationId: scope.organizationId, actorUserId: command.actorUserId, action: "MESSAGE_SEND_RESULT", details: { commandId: command.id, outcome } } });
    });
  }
  private async coordinate(scope: Scope, token: string) {
    if (!this.chat.historyExecutionEnabled || !this.client.history) return;
    await this.chat.integrationMutation(scope.organizationId, async (tx) => {
      await this.fence(tx, scope, token);
      const row = await tx.providerConnection.findUniqueOrThrow({ where: { organizationId_channelId: { organizationId: scope.organizationId, channelId: scope.connectionId } } });
      const op = historyRecord(row.historyOperation), grant = op?.authorization;
      if (!op || !grant || grant.state !== "ENABLED" || Date.parse(grant.nextCheckAt) > Date.now()) return false;
      if (!await historyGrantValid(tx, scope, op)) {
        grant.state = "DISABLED";
        await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: scope.organizationId, channelId: scope.connectionId } }, data: { historyOperation: op, version: { increment: 1 } } });
        await tx.auditEvent.create({ data: { organizationId: scope.organizationId, actorUserId: op.actorUserId, action: "HISTORY_AUTHORIZATION_REVOKED", details: { connectionId: scope.connectionId, operationId: op.id } } });
        await this.chat.resourceEvent(tx, scope.organizationId, "provider.connection.updated", scope.connectionId); return true;
      }
      if (row.state !== "CONNECTED" || row.errorCode || !row.lastCheckedAt || Date.now() - row.lastCheckedAt.getTime() > 15000) return false;
      if (await tx.providerCommand.count({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, status: { in: ["PENDING", "PROCESSING"] } } })) return false;
      const source = op.source;
      // A grant never creates a second operation or silently replenishes quota.
      const exhausted = !!source && (source.messages >= op.limits.messages || source.requests >= 16);
      const uncertain = !!source?.errorCode && ["HISTORY_RESPONSE_TIMEOUT", "HISTORY_REQUEST_UNCERTAIN", "HISTORY_RESTART_UNCERTAIN"].includes(source.errorCode);
      if (exhausted || uncertain || ["FAILED", "PARTIAL", "CANCELLED"].includes(source?.state ?? op.state)) return false;
      if (source?.state === "PAUSED") {
        // A reader-policy failure cannot make progress through lease renewal.
        // Retain its diagnostic and reference for explicit/local controlled
        // recovery rather than producing administrative commands every15s.
        if (source.errorCode && !["HISTORY_AUTHORIZATION_EXPIRED", "HISTORY_RESTART_PAUSED", "HISTORY_LIVE_BACKLOG", "HISTORY_MEMORY_PRESSURE"].includes(source.errorCode)) return false;
        if (Date.parse(grant.nextCheckAt) + 45000 > Date.now()) return false;
      }
      const anchorCheckDue = !grant.lastAnchorCheckAt || Date.now() - Date.parse(grant.lastAnchorCheckAt) >= 300000;
      if (source && ["COMPLETED", "NO_DATA"].includes(source.state) && !anchorCheckDue) {
        grant.nextCheckAt = new Date(Date.parse(grant.lastAnchorCheckAt!) + 300000).toISOString();
        await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: scope.organizationId, channelId: scope.connectionId } }, data: { historyOperation: op } }); return false;
      }
      const authorization = { organizationId: scope.organizationId, connectionId: scope.connectionId, actorUserId: grant.actorUserId, authorizedAt: grant.authorizedAt };
      const control = { commandId: randomUUID(), operationId: op.id, action: source?.state === "PREPARED" ? "start" : "reconcile", authorization } as import("../../contracts/history.js").HistoryControl;
      // Discover new anchors at most every five minutes. Same bounded operation,
      // only previously unseen conversations are admitted by the producer.
      if (anchorCheckDue) {
        control.spec = { id: op.id, from: op.from, to: op.to, limits: op.limits, anchors: await selectHistoryAnchors(tx, scope, op.from) };
        grant.lastAnchorCheckAt = new Date().toISOString();
      }
      grant.nextCheckAt = new Date(Date.now() + 15000).toISOString();
      await tx.providerCommand.create({ data: { id: control.commandId, organizationId: scope.organizationId, channelId: scope.connectionId, actorUserId: op.actorUserId, sessionId: op.sessionId, action: `history_${control.action}`, payload: historyControlSchema.parse(control) } });
      await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: scope.organizationId, channelId: scope.connectionId } }, data: { historyOperation: op } });
      return false;
    }, (changed) => changed);
  }
  async tick() {
    const connections = await this.db.providerConnection.findMany({ where: { channel: { provider: "WHATSAPP_WEB", organization: { status: "ACTIVE" } } }, take: 2, orderBy: [{ organizationId: "asc" }, { channelId: "asc" }], ...(this.cursor ? { cursor: { organizationId_channelId: this.cursor }, skip: 1 } : {}) });
    const last = connections.at(-1); this.cursor = last ? { organizationId: last.organizationId, channelId: last.channelId } : undefined;
    // Two concurrent scopes, sequential within each. No browser/WhatsApp polling.
    for (let index = 0; index < connections.length; index += 2) await Promise.all(connections.slice(index, index + 2).map((row) => this.runConnection({ organizationId: row.organizationId, connectionId: row.channelId }).catch((error: unknown) => this.onError(error instanceof WebProviderError ? error.code : "PROVIDER_SYNC_FAILED"))));
  }
}
