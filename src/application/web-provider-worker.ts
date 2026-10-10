import type { PrismaClient, Prisma } from "@prisma/client";
import type { Chat } from "./chat.js";
import { WebConnections } from "./web-connections.js";
import { WebIngestion } from "./web-ingestion.js";
import { AppError } from "../domain/errors.js";
import { WebProviderError, type WebProviderPort, type InternalAction } from "../integrations/web-provider-client.js";
type Scope = { organizationId: string; connectionId: string };
export class WebProviderWorker {
  private readonly connections: WebConnections;
  private readonly ingestion: WebIngestion;
  private cursor?: { organizationId: string; channelId: string };
  constructor(private readonly db: PrismaClient, private readonly chat: Chat, private readonly client: WebProviderPort, private readonly onError: (code: string) => void = () => {}) {
    this.connections = new WebConnections(db, chat, client); this.ingestion = new WebIngestion(chat);
  }
  private async fence(tx: Prisma.TransactionClient, scope: Scope, token: string) {
    if (!await tx.providerConnection.findFirst({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, leaseToken: token, leaseUntil: { gt: new Date() }, channel: { provider: "WHATSAPP_WEB" } } })) throw new AppError(409, "STALE_PROVIDER_LEASE");
  }
  async runConnection(scope: Scope) {
    const token = await this.connections.claim({ organizationId: scope.organizationId, channelId: scope.connectionId });
    if (!token) return;
    try {
      if (!await this.client.ready()) throw new WebProviderError("PROVIDER_UNAVAILABLE");
      const command = await this.db.providerCommand.findFirst({ where: { organizationId: scope.organizationId, channelId: scope.connectionId, status: { in: ["PENDING", "PROCESSING"] }, nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: "asc" } });
      if (command) {
        await this.chat.integrationMutation(scope.organizationId, async (tx) => { await this.fence(tx, scope, token); await tx.providerCommand.update({ where: { id: command.id }, data: { status: "PROCESSING", attempts: { increment: 1 } } }); });
        try {
          const session = await this.db.session.findFirst({ where: { id: command.sessionId, userId: command.actorUserId, currentOrganizationId: scope.organizationId }, include: { user: true } });
          if (!session) throw new AppError(403, "COMMAND_AUTHORIZATION_REVOKED");
          await this.chat.context({ session, user: session.user }, "providers.manage");
          // Only explicitly requested create/connect produces a session/socket.
          await this.client.create(scope);
          const view = command.action === "create" ? await this.client.session(scope) : await this.client.command(scope, command.action === "disconnect" ? "logout" : command.action as InternalAction, command.id);
          await this.connections.synchronize(scope, view, token);
          await this.chat.integrationMutation(scope.organizationId, async (tx) => {
            await this.fence(tx, scope, token);
            await tx.providerCommand.update({ where: { id: command.id }, data: { status: "COMPLETED", errorCode: null } });
            await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: scope.organizationId, channelId: scope.connectionId } }, data: { version: { increment: 1 } } });
            await tx.auditEvent.create({ data: { organizationId: scope.organizationId, actorUserId: command.actorUserId, action: "WHATSAPP_WEB_COMMAND_COMPLETED", details: { channelId: scope.connectionId, commandId: command.id, action: command.action } } });
            await this.chat.resourceEvent(tx, scope.organizationId, "provider.connection.updated", scope.connectionId);
          });
        } catch (error) {
          const attempts = command.attempts + 1;
          const permanent = error instanceof AppError && [401, 403, 409].includes(error.status) || error instanceof WebProviderError && [400, 403, 409].includes(error.status);
          const code = error instanceof AppError && [401, 403].includes(error.status) ? "COMMAND_AUTHORIZATION_REVOKED" : error instanceof WebProviderError ? error.code : "PROVIDER_OPERATION_FAILED";
          await this.chat.integrationMutation(scope.organizationId, async (tx) => {
            await this.fence(tx, scope, token);
            await tx.providerCommand.update({ where: { id: command.id }, data: { status: permanent || attempts >= 5 ? "FAILED" : "PENDING", errorCode: code, nextAttemptAt: new Date(Date.now() + Math.min(30_000, 1000 * 2 ** attempts)) } });
            await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: scope.organizationId, channelId: scope.connectionId } }, data: { errorCode: code, version: { increment: 1 } } });
            await this.chat.resourceEvent(tx, scope.organizationId, "provider.connection.updated", scope.connectionId);
          });
          return;
        }
      }
      const view = await this.client.session(scope);
      await this.connections.synchronize(scope, view, token);
      // Bounded batch leaves time to refresh the lease, preserving tenant fairness.
      for (const delivery of await this.client.pull(scope)) {
        try {
          await this.ingestion.apply(scope, delivery.event, token);
          // Refresh lifecycle from current metadata, never from an old replay event.
          if (delivery.event.type === "connection.updated") await this.connections.synchronize(scope, await this.client.session(scope), token);
          await this.client.ack(scope, delivery.event.eventId, delivery.leaseId);
        } catch (error) {
          if (error instanceof AppError && error.code === "STALE_PROVIDER_LEASE") throw error;
          this.onError(error instanceof AppError ? error.code : "PROVIDER_EVENT_PROCESSING_FAILED");
          await this.client.nack(scope, delivery.event.eventId, delivery.leaseId).catch(() => this.onError("PROVIDER_NACK_FAILED"));
        }
      }
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
  async tick() {
    const connections = await this.db.providerConnection.findMany({ where: { channel: { provider: "WHATSAPP_WEB", organization: { status: "ACTIVE" } } }, take: 2, orderBy: [{ organizationId: "asc" }, { channelId: "asc" }], ...(this.cursor ? { cursor: { organizationId_channelId: this.cursor }, skip: 1 } : {}) });
    const last = connections.at(-1); this.cursor = last ? { organizationId: last.organizationId, channelId: last.channelId } : undefined;
    // Two concurrent scopes, sequential within each. No browser/WhatsApp polling.
    for (let index = 0; index < connections.length; index += 2) await Promise.all(connections.slice(index, index + 2).map((row) => this.runConnection({ organizationId: row.organizationId, connectionId: row.channelId }).catch((error: unknown) => this.onError(error instanceof WebProviderError ? error.code : "PROVIDER_SYNC_FAILED"))));
  }
}
