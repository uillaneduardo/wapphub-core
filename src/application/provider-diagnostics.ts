import type { PrismaClient } from "@prisma/client";
import type { Chat } from "./chat.js";
import type { Principal } from "./foundation.js";
import { AppError } from "../domain/errors.js";
import { syncProgress, type SyncOccurrence } from "./web-sync.js";
export type DiagnosticQuery = { kind?: "ERRORS" | "EVENTS"; page?: number; limit?: number; from?: string; to?: string; severity?: string; stage?: string; status?: string };
const descriptions: Record<string, string> = {
 PERSISTENCE_FAILED: "O Core não conseguiu persistir o lote nessa tentativa.", PROVIDER_IDEMPOTENCY_CONFLICT: "Um identificador repetido chegou com dados incompatíveis.", IDENTITY_MAPPING_CONFLICT: "O mapeamento de identidade conflita com contatos existentes.", PROVIDER_IDENTITY_CONFLICT: "A identidade da mensagem não corresponde à conversa.", UNSUPPORTED_PROVIDER_EVENT: "O evento não atende ao contrato suportado.", INVALID_PROVIDER_TIMESTAMP: "O horário recebido não atende aos limites de processamento.", HISTORY_RETENTION_LIMIT: "O item excede o limite de retenção do histórico.", STALE_PROVIDER_LEASE: "A tentativa perdeu a autorização temporária de processamento.", PROVIDER_UNAVAILABLE: "O serviço do provider está indisponível.", COMMAND_AUTHORIZATION_REVOKED: "A autorização do comando foi revogada.", PROVIDER_OPERATION_FAILED: "Não foi possível concluir a operação do provider.", PERSISTED: "O evento foi aceito e registrado pelo Core. Detalhes por item não foram retidos nesta ocorrência.", COMMAND_COMPLETED: "O comando foi concluído.", COMMAND_PENDING: "O comando aguarda processamento.", COMMAND_PROCESSING: "O comando está em processamento.", COMMAND_FAILED: "O comando falhou.",
};
export type DiagnosticOccurrence = { id: string; correlationId: string | null; code: string; description: string; occurredAt: string; component: string; stage: string; severity: string; status: string; attempts: number | null; items: number | null; lastAttemptAt: string | null; recoveredAt: string | null; eventType: string | null; deadLetter: boolean | null };
const knownCode = (code: string | null, fallback: string) => code && code in descriptions ? code : fallback;
const fromOccurrence = (row: SyncOccurrence): DiagnosticOccurrence => ({ ...row, description: descriptions[row.code]!, recoveredAt: row.recoveredAt ?? null, eventType: "sync.batch", deadLetter: row.status === "DEAD_LETTER" });
const commandOccurrence = (x: { id: string; status: string; errorCode: string | null; attempts: number; createdAt: Date; updatedAt: Date }): DiagnosticOccurrence => {
 const failed = x.status === "FAILED" || Boolean(x.errorCode);
 const code = knownCode(x.errorCode, x.status === "COMPLETED" ? "COMMAND_COMPLETED" : x.status === "PROCESSING" ? "COMMAND_PROCESSING" : x.status === "FAILED" ? "COMMAND_FAILED" : "COMMAND_PENDING");
 return { id: x.id, correlationId: x.id, code, description: descriptions[code]!, occurredAt: x.createdAt.toISOString(), component: "WORKER", stage: "LIFECYCLE", severity: failed ? "ERROR" : "INFO", status: x.status === "FAILED" ? "REJECTED" : failed ? "ACTIVE" : x.status === "COMPLETED" ? "ACCEPTED" : "WAITING", attempts: x.attempts, items: null, lastAttemptAt: x.attempts ? x.updatedAt.toISOString() : null, recoveredAt: null, eventType: "PROVIDER_COMMAND", deadLetter: null };
};
// A bounded read model over existing connection checkpoint, SQL Inbox and commands.
// No payload, auth material, raw provider identity or stack reaches this boundary.
export class ProviderDiagnostics {
 constructor(private db: PrismaClient, private chat: Chat) {}
 private async snapshot(p: Principal, provider: string) {
  if (!["WHATSAPP_WEB", "DEMO", "META"].includes(provider)) throw new AppError(404, "NOT_FOUND");
  const c = await this.chat.context(p, "providers.diagnostics.read");
  if (!c.permissions.includes("providers.manage")) throw new AppError(403, "PERMISSION_DENIED");
  const channel = await this.db.channel.findUnique({ where: { organizationId_provider: { organizationId: c.organizationId, provider } }, include: { webConnection: true } });
  const connection = channel?.webConnection ?? null;
  const progress = syncProgress(connection?.syncProgress ?? null);
  return { c, channel, connection, progress };
 }
 async list(p: Principal, provider: string, query: DiagnosticQuery) {
  const { c, channel, connection, progress } = await this.snapshot(p, provider);
  const now = new Date(), cutoff = new Date(now.getTime() - 30 * 86400000);
  if (query.from && !Number.isFinite(Date.parse(query.from)) || query.to && !Number.isFinite(Date.parse(query.to)) || query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) throw new AppError(400, "INVALID_DIAGNOSTIC_PERIOD");
  const from = query.from && new Date(query.from) > cutoff ? new Date(query.from) : cutoff;
  const to = query.to ? new Date(query.to) : now;
  const bounds = { gte: from, lte: to };
  const where = { organizationId: c.organizationId, channelId: channel?.id ?? "" };
  // Existing tenant/connection/time indexes; fixed upper bounds regardless of backlog.
  const [inbox, commands] = channel && connection ? await Promise.all([
   query.kind === "ERRORS" ? Promise.resolve([]) : this.db.providerInbox.findMany({ where: { ...where, receivedAt: bounds }, orderBy: [{ receivedAt: "desc" }, { deduplicationId: "desc" }], take: 201, select: { eventId: true, correlationId: true, type: true, receivedAt: true } }),
   this.db.providerCommand.findMany({ where: { ...where, createdAt: bounds }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51, select: { id: true, status: true, errorCode: true, attempts: true, createdAt: true, updatedAt: true } }),
  ]) : [[], []];
  let items: DiagnosticOccurrence[] = progress.occurrences.map(fromOccurrence);
  if (query.kind !== "ERRORS") items.push(...inbox.slice(0, 200).map((x) => ({ id: x.eventId, correlationId: x.correlationId, code: "PERSISTED", description: descriptions.PERSISTED!, occurredAt: x.receivedAt.toISOString(), component: "CORE", stage: "PERSISTENCE", severity: "INFO", status: "ACCEPTED", attempts: null, items: null, lastAttemptAt: null, recoveredAt: null, eventType: ["sync.batch", "connection.updated", "message.received", "message.sent", "message.updated", "contacts.updated", "conversation.updated"].includes(x.type) ? x.type : "PROVIDER_EVENT", deadLetter: null })));
  items.push(...commands.slice(0, 50).map(commandOccurrence));
  // Snapshot counters describe this retained window, never an invented global total.
  const errors = items.filter((x) => x.severity === "ERROR");
  const counters = { active: errors.filter((x) => ["ACTIVE", "REJECTED", "DEAD_LETTER"].includes(x.status)).length, recovered: errors.filter((x) => x.status === "RECOVERED").length };
  items = items.filter((x) => (query.kind !== "ERRORS" || x.severity === "ERROR") && x.occurredAt >= from.toISOString() && x.occurredAt <= to.toISOString() && (!query.severity || x.severity === query.severity) && (!query.stage || x.stage === query.stage) && (!query.status || x.status === query.status)).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id) || b.status.localeCompare(a.status));
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 50), page = Math.min(Math.max(query.page ?? 1, 1), 100), offset = (page - 1) * limit;
  await this.db.auditEvent.create({ data: { organizationId: c.organizationId, actorUserId: c.userId, action: "PROVIDER_DIAGNOSTICS_VIEWED", details: { provider, ...(channel ? { channelId: channel.id } : {}), kind: query.kind ?? "EVENTS", page } } });
  const source = connection?.providerSync as { failures?: number; diagnostics?: { legacyFailures?: number } } | null;
  const legacyFailures = source?.diagnostics ? Number(source.diagnostics.legacyFailures ?? 0) : Number(source?.failures ?? 0);
  return { items: items.slice(offset, offset + limit), page, limit, hasMore: offset + limit < items.length, counters, legacyFailures, legacyDescription: legacyFailures ? "Falhas registradas apenas como contador, sem detalhes individuais. Não é possível reconstruir seus detalhes com segurança." : null, retentionDays: 30, truncated: inbox.length > 200 || commands.length > 50 || progress.diagnosticEvictions > 0, coverage: connection ? "CORE_CHECKPOINT_INBOX_COMMANDS" : "NO_PROCESSING_RECORDS" };
 }
 async detail(p: Principal, provider: string, id: string) {
  const { progress, c, channel } = await this.snapshot(p, provider);
  await this.db.auditEvent.create({ data: { organizationId: c.organizationId, actorUserId: c.userId, action: "PROVIDER_DIAGNOSTIC_DETAIL_VIEWED", details: { provider, occurrenceId: id } } });
  const found = progress.occurrences.map(fromOccurrence).find((x) => x.id === id);
  if (found) return found;
  if (channel) {
   const command = await this.db.providerCommand.findFirst({ where: { organizationId: c.organizationId, channelId: channel.id, id, createdAt: { gte: new Date(Date.now() - 30 * 86400000) } }, select: { id: true, status: true, errorCode: true, attempts: true, createdAt: true, updatedAt: true } });
   if (command) return commandOccurrence(command);
   const row = await this.db.providerInbox.findFirst({ where: { organizationId: c.organizationId, channelId: channel.id, eventId: id, receivedAt: { gte: new Date(Date.now() - 30 * 86400000) } }, select: { eventId: true, correlationId: true, type: true, receivedAt: true } });
   if (row) return { id: row.eventId, correlationId: row.correlationId, code: "PERSISTED", description: descriptions.PERSISTED!, occurredAt: row.receivedAt.toISOString(), component: "CORE", stage: "PERSISTENCE", severity: "INFO", status: "ACCEPTED", attempts: null, items: null, lastAttemptAt: null, recoveredAt: null, eventType: "PROVIDER_EVENT", deadLetter: null };
  }
  throw new AppError(404, "NOT_FOUND");
 }
 async health(p: Principal, provider: string) {
  const { connection, channel, progress, c } = await this.snapshot(p, provider);
  const source = connection?.providerSync as { queued?: number; failures?: number; diagnostics?: { legacyFailures?: number } } | null;
  const commands = connection ? await this.db.providerCommand.count({ where: { organizationId: c.organizationId, channelId: channel!.id, status: { in: ["PENDING", "PROCESSING"] } } }) : null;
  return { provider, state: connection?.state ?? channel?.status ?? "UNCONFIGURED", backlog: source?.queued ?? null, pendingFailures: connection ? Object.keys(progress.failedBatches).length : null, failedAttempts: progress.diagnosticsSince ? progress.failedAttempts : null, deadLetters: progress.diagnosticsSince ? progress.occurrences.filter((x) => x.status === "DEAD_LETTER").length : null, pendingCommands: commands, legacyFailures: source?.diagnostics?.legacyFailures ?? source?.failures ?? null, lastProcessedAt: progress.lastProcessedAt ?? null, lastCheckedAt: connection?.lastCheckedAt?.toISOString() ?? null, diagnosticsSince: progress.diagnosticsSince ?? null, detailsAvailable: Boolean(connection) };
 }
}
