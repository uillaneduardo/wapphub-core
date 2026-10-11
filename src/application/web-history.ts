import { Prisma, type PrismaClient } from "@prisma/client";
import { historyControlSchema, historyLimitsSchema, type HistoryView, type HistorySpec } from "../../contracts/history.js";
import { resolvePermissions } from "../domain/resources.js";
import type { Principal } from "./foundation.js";
import type { Chat } from "./chat.js";
import { AppError } from "../domain/errors.js";

export type HistoryRecord = { id: string; from: string; to: string; limits: { contacts: number; conversations: number; messages: number }; state: HistoryView["state"]; actorUserId: string; sessionId: string; source?: HistoryView; manifest: { contacts: string[]; conversations: string[]; messages: string[] }; processed: number; duplicates: number; rejected: number; createdAt: string; authorization?: { organizationId: string; connectionId: string; actorUserId: string; authorizedAt: string; state: "ENABLED" | "PAUSED" | "DISABLED"; nextCheckAt: string; lastAnchorCheckAt?: string }; errorCode?: string; };
export function historyRecord(value: Prisma.JsonValue | null): HistoryRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.id !== "string" || !Array.isArray((value.manifest as Record<string, unknown>)?.messages)) return undefined;
  return value as unknown as HistoryRecord;
}
export const historyPermissions = ["providers.manage", "providers.diagnostics.read", "conversations.supervise", "messages.read"] as const;
export class WebHistory {
  constructor(private readonly db: PrismaClient, private readonly chat: Chat, readonly executionEnabled = false) {}
  private async authorize(p: Principal) { let c; for (const permission of historyPermissions) c = await this.chat.context(p, permission); return c!; }
  private dto(op?: HistoryRecord) { return op ? { id: op.id, state: op.source?.state === "COMPLETED" && (op.rejected || op.source.failures) ? "PARTIAL" : op.source?.state === "COMPLETED" && op.source.queued ? "RUNNING" : op.source?.state ?? op.state, from: op.from, to: op.to, limits: op.limits, processed: op.processed, duplicates: op.duplicates, rejected: op.rejected, persisted: { contacts: op.manifest.contacts.length, conversations: op.manifest.conversations.length, messages: op.manifest.messages.length }, source: op.source ?? null, createdAt: op.createdAt, errorCode: op.errorCode ?? null, authorization: op.authorization ? { state: op.authorization.state, authorizedAt: op.authorization.authorizedAt } : null } : null; }
  async read(p: Principal, connectionId: string) {
    const c = await this.authorize(p), row = await this.db.providerConnection.findFirst({ where: { organizationId: c.organizationId, channelId: connectionId, channel: { provider: "WHATSAPP_WEB" } } });
    if (!row) throw new AppError(404, "NOT_FOUND");
    return { version: row.version, executionEnabled: this.executionEnabled, operation: this.dto(historyRecord(row.historyOperation)), mechanism: "ON_DEMAND_ANCHORED", remoteAvailability: "UNVERIFIED_UNTIL_AUTHORIZED_RESPONSE" };
  }
  async prepare(p: Principal, connectionId: string, input: { commandId: string; expectedVersion: number; messages?: number; automatic?: boolean }) {
    await this.authorize(p);
    if (input.automatic && !this.executionEnabled) throw new AppError(403, "HISTORY_EXECUTION_DISABLED");
    return this.chat.mutation(p, "providers.manage", async (tx, c) => {
      for (const permission of historyPermissions) if (!c.permissions.includes(permission)) throw new AppError(403, "PERMISSION_DENIED");
      const row = await tx.providerConnection.findFirst({ where: { organizationId: c.organizationId, channelId: connectionId, channel: { provider: "WHATSAPP_WEB" } } });
      if (!row) throw new AppError(404, "NOT_FOUND");
      const previous = await tx.providerCommand.findUnique({ where: { id: input.commandId } });
      if (previous) { if (previous.organizationId !== c.organizationId || previous.channelId !== connectionId || previous.actorUserId !== c.userId || previous.action !== (input.automatic ? "history_authorize" : "history_prepare") || (previous.payload as Record<string, unknown>)?.spec && ((previous.payload as Record<string, unknown>).spec as { limits?: { messages?: number } }).limits?.messages !== (input.messages ?? 20)) throw new AppError(409, "IDEMPOTENCY_CONFLICT"); return { operation: this.dto(historyRecord(row.historyOperation)) }; }
      if (row.version !== input.expectedVersion) throw new AppError(409, "CONNECTION_VERSION_CONFLICT");
      const existing = historyRecord(row.historyOperation);
      if (existing?.authorization) throw new AppError(409, "HISTORY_BUDGET_OR_REVIEW_REQUIRED");
      if (existing && !(input.automatic && !existing.authorization && existing.state === "PREPARED") && !["COMPLETED", "NO_DATA", "FAILED", "CANCELLED", "PARTIAL"].includes(existing.source?.state ?? existing.state)) throw new AppError(409, "HISTORY_OPERATION_PENDING");
      if (await tx.providerCommand.count({ where: { organizationId: c.organizationId, channelId: connectionId, status: { in: ["PENDING", "PROCESSING"] } } })) throw new AppError(409, "CONNECTION_OPERATION_PENDING");
      if (row.state !== "CONNECTED" || row.errorCode) throw new AppError(409, "HISTORY_TRANSPORT_UNAVAILABLE");
      const to = new Date().toISOString(), from = new Date(Date.now() - 30 * 86400000).toISOString(), id = input.commandId;
      // Window function picks one oldest available anchor per scoped conversation;
      // no N+1, payload bodies or identifiers provided by the browser.
      const anchors = await selectHistoryAnchors(tx, { organizationId: c.organizationId, connectionId }, from);
      const limits = historyLimitsSchema.parse({ contacts: 500, conversations: 500, messages: input.messages ?? 20 });
      const payload = historyControlSchema.parse({ commandId: input.commandId, operationId: id, action: "prepare", spec: { id, from, to, limits, anchors } });
      const op: HistoryRecord = { id, from, to, limits, state: "PREPARED", ...(input.automatic ? { authorization: { organizationId: c.organizationId, connectionId, actorUserId: c.userId, authorizedAt: to, state: "ENABLED" as const, nextCheckAt: to } } : {}), actorUserId: c.userId, sessionId: p.session.id, manifest: { contacts: [], conversations: [], messages: [] }, processed: 0, duplicates: 0, rejected: 0, createdAt: to };
      await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: c.organizationId, channelId: connectionId } }, data: { historyOperation: op, version: { increment: 1 } } });
      await tx.providerCommand.create({ data: { id: input.commandId, organizationId: c.organizationId, channelId: connectionId, actorUserId: c.userId, sessionId: p.session.id, action: input.automatic ? "history_authorize" : "history_prepare", payload: input.automatic ? { ...payload, authorization: { organizationId: c.organizationId, connectionId, actorUserId: c.userId, authorizedAt: to } } : payload } });
      await tx.auditEvent.create({ data: { organizationId: c.organizationId, actorUserId: c.userId, action: input.automatic ? "HISTORY_AUTHORIZED" : "HISTORY_PREPARED", details: { operationId: id, connectionId, anchors: anchors.length, messages: limits.messages } } });
      await this.chat.resourceEvent(tx, c.organizationId, "provider.connection.updated", connectionId);
      return { operation: this.dto(op) };
    });
  }
  async configure(p: Principal, connectionId: string, input: { commandId: string; expectedVersion: number; action: "enable" | "pause" | "disable"; confirmed?: boolean }) {
    const c = await this.authorize(p);
    if (input.action === "enable" && input.confirmed !== true) throw new AppError(400, "HISTORY_CONFIRMATION_REQUIRED");
    const row = await this.db.providerConnection.findFirst({ where: { organizationId: c.organizationId, channelId: connectionId } });
    if (!row) throw new AppError(404, "NOT_FOUND");
    const op = historyRecord(row.historyOperation);
    const prior = await this.db.providerCommand.findUnique({ where: { id: input.commandId } });
    if (prior?.action === "history_authorize" && input.action === "enable") {
      if (prior.organizationId !== c.organizationId || prior.channelId !== connectionId || prior.actorUserId !== c.userId) throw new AppError(409, "IDEMPOTENCY_CONFLICT");
      return { operation: this.dto(op) };
    }
    if (input.action === "enable" && !op?.authorization) return this.prepare(p, connectionId, { ...input, automatic: true, messages: 20 });
    if (!op?.authorization) throw new AppError(409, "HISTORY_NOT_AUTHORIZED");
    return this.control(p, connectionId, { ...input, operationId: op.id, action: input.action === "enable" ? "resume" : input.action === "pause" ? "pause" : "cancel" });
  }
  async control(p: Principal, connectionId: string, input: { commandId: string; operationId: string; action: "start" | "pause" | "resume" | "cancel"; expectedVersion: number }) {
    await this.authorize(p);
    if (["start", "resume"].includes(input.action) && !this.executionEnabled) throw new AppError(403, "HISTORY_EXECUTION_DISABLED");
    return this.chat.mutation(p, "providers.manage", async (tx, c) => {
      for (const permission of historyPermissions) if (!c.permissions.includes(permission)) throw new AppError(403, "PERMISSION_DENIED");
      const row = await tx.providerConnection.findFirst({ where: { organizationId: c.organizationId, channelId: connectionId, channel: { provider: "WHATSAPP_WEB" } } });
      if (!row) throw new AppError(404, "NOT_FOUND");
      const op = historyRecord(row.historyOperation);
      if (!op || op.id !== input.operationId) throw new AppError(409, "HISTORY_OPERATION_MISMATCH");
      const previous = await tx.providerCommand.findUnique({ where: { id: input.commandId } });
      if (previous) { if (previous.organizationId !== c.organizationId || previous.channelId !== connectionId || previous.actorUserId !== c.userId || previous.action !== `history_${input.action}`) throw new AppError(409, "IDEMPOTENCY_CONFLICT"); return { operation: this.dto(op) }; }
      if (row.version !== input.expectedVersion) throw new AppError(409, "CONNECTION_VERSION_CONFLICT");
      if (await tx.providerCommand.count({ where: { organizationId: c.organizationId, channelId: connectionId, status: { in: ["PENDING", "PROCESSING"] } } })) throw new AppError(409, "CONNECTION_OPERATION_PENDING");
      const state = op.source?.state ?? op.state;
      if (["start", "resume"].includes(input.action) && !op.authorization) throw new AppError(403, "HISTORY_NOT_AUTHORIZED");
      const valid = input.action === "start" ? state === "PREPARED" : input.action === "resume" ? state === "PAUSED" : input.action === "pause" ? ["RUNNING", "WAITING", "BACKPRESSURE", "PAUSED"].includes(state) : !["COMPLETED", "NO_DATA", "FAILED"].includes(state);
      if (!valid && !op.authorization) throw new AppError(409, "INVALID_HISTORY_STATE");
      if (op.authorization && ["start", "resume"].includes(input.action) && (op.source?.requests === 16 || op.source && op.source.messages >= op.limits.messages || op.source?.errorCode && ["HISTORY_RESPONSE_TIMEOUT", "HISTORY_REQUEST_UNCERTAIN", "HISTORY_RESTART_UNCERTAIN"].includes(op.source.errorCode) || ["FAILED", "PARTIAL", "CANCELLED"].includes(state))) throw new AppError(409, "HISTORY_BUDGET_OR_REVIEW_REQUIRED");
      if (op.authorization) {
        delete op.errorCode;
        op.authorization.state = input.action === "cancel" ? "DISABLED" : input.action === "pause" ? "PAUSED" : "ENABLED";
        op.authorization.nextCheckAt = new Date().toISOString();
      }
      const payload = historyControlSchema.parse({ commandId: input.commandId, operationId: op.id, action: op.authorization && input.action === "cancel" ? "pause" : input.action, ...(op.authorization ? { authorization: { organizationId: c.organizationId, connectionId, actorUserId: op.actorUserId, authorizedAt: op.authorization.authorizedAt } } : {}) });
      await tx.providerCommand.create({ data: { id: input.commandId, organizationId: c.organizationId, channelId: connectionId, actorUserId: c.userId, sessionId: p.session.id, action: `history_${input.action}`, payload } });
      await tx.providerConnection.update({ where: { organizationId_channelId: { organizationId: c.organizationId, channelId: connectionId } }, data: { historyOperation: op, version: { increment: 1 } } });
      await tx.auditEvent.create({ data: { organizationId: c.organizationId, actorUserId: c.userId, action: `HISTORY_${input.action.toUpperCase()}_REQUESTED`, details: { operationId: op.id, commandId: input.commandId } } });
      await this.chat.resourceEvent(tx, c.organizationId, "provider.connection.updated", connectionId);
      return { operation: this.dto(op) };
    });
  }
}

/** Durable grant is scoped to a connection and active authorizing membership. */
export async function historyGrantValid(db: PrismaClient | Prisma.TransactionClient, scope: { organizationId: string; connectionId: string }, op?: HistoryRecord) {
  const grant = op?.authorization;
  if (!grant || grant.state !== "ENABLED" || grant.organizationId !== scope.organizationId || grant.connectionId !== scope.connectionId || grant.actorUserId !== op.actorUserId) return false;
  const member = await db.membership.findFirst({ where: { organizationId: scope.organizationId, userId: grant.actorUserId, status: "ACTIVE", user: { status: "ACTIVE" }, organization: { status: "ACTIVE" } }, include: { permissionOverrides: { include: { permission: true } }, role: { include: { permissions: { include: { permission: true } } } } } });
  return !!member && historyPermissions.every((permission) => resolvePermissions(member).includes(permission));
}

/** Shared bounded discovery for activation and automatic reconsideration. */
export async function selectHistoryAnchors(tx: Prisma.TransactionClient, scope: { organizationId: string; connectionId: string }, from: string): Promise<HistorySpec["anchors"]> {
  const rows = await tx.$queryRaw<{ chatId: string; messageId: string; direction: string; createdAt: Date }[]>(Prisma.sql`SELECT chatId,messageId,direction,createdAt FROM (SELECT c.providerConversationId AS chatId,m.providerMessageId AS messageId,m.direction,m.createdAt,ROW_NUMBER() OVER(PARTITION BY m.conversationId ORDER BY m.createdAt,m.id) AS rn FROM Message m JOIN Conversation c ON c.organizationId=m.organizationId AND c.channelId=m.channelId AND c.id=m.conversationId WHERE m.organizationId=${scope.organizationId} AND m.channelId=${scope.connectionId} AND m.providerMessageId IS NOT NULL AND c.providerConversationId IS NOT NULL AND m.createdAt>${new Date(from)}) a WHERE rn=1 ORDER BY createdAt,chatId LIMIT 16`);
  return rows.filter((a) => /@(s\.whatsapp\.net|lid)$/.test(a.chatId)).map((a) => ({ chatId: a.chatId, messageId: a.messageId, fromMe: a.direction === "OUTBOUND", timestamp: a.createdAt.getTime() }));
}
