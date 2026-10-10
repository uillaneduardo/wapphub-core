import type { FastifyInstance } from "fastify";
import type { Foundation } from "../application/foundation.js";
import type { ProviderDiagnostics, DiagnosticQuery } from "../application/provider-diagnostics.js";
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, properties, required });
const str = { type: "string" }, count = { type: "integer", minimum: 0 }, date = { type: "string", format: "date-time" }, nil = (schema: unknown) => ({ anyOf: [schema, { type: "null" }] }), bool = { type: "boolean" };
const occurrence = object({ id: str, correlationId: nil(str), code: str, description: str, occurredAt: date, component: str, stage: str, severity: str, status: str, attempts: nil(count), items: nil(count), lastAttemptAt: nil(date), recoveredAt: nil(date), eventType: nil(str), deadLetter: nil(bool) });
const params = object({ provider: { type: "string", enum: ["WHATSAPP_WEB", "DEMO", "META"] } });
const querystring = object({ kind: { type: "string", enum: ["ERRORS", "EVENTS"] }, page: { type: "integer", minimum: 1, maximum: 100 }, limit: { type: "integer", minimum: 1, maximum: 50 }, from: date, to: date, severity: { type: "string", enum: ["INFO", "ERROR"] }, stage: { type: "string", enum: ["PERSISTENCE", "VALIDATION", "LIFECYCLE"] }, status: { type: "string", enum: ["ACTIVE", "RECOVERED", "REJECTED", "DEAD_LETTER", "ACCEPTED", "WAITING"] } }, []);
const error = object({ error: object({ code: str, requestId: str }) });
const schema = (dto: unknown, extra = {}) => ({ tags: ["Provider diagnostics"], security: [{ webSession: [] }], params, response: { 200: dto, 400: error, 401: error, 403: error, 404: error, 429: error, 500: error, 503: error }, ...extra });
export async function providerDiagnosticsRoutes(app: FastifyInstance, foundation: Foundation, diagnostics: ProviderDiagnostics, cookie: string) {
 const base = "/api/v1/providers/:provider/diagnostics";
 app.get<{ Params: { provider: string }; Querystring: DiagnosticQuery }>(base, { schema: schema(object({ items: { type: "array", items: occurrence }, page: count, limit: count, hasMore: bool, counters: object({ active: count, recovered: count }), legacyFailures: count, legacyDescription: nil(str), retentionDays: count, truncated: bool, coverage: str }), { querystring }) }, async (request, reply) => {
  reply.header("cache-control", "no-store, private"); return diagnostics.list(await foundation.authenticate(request.cookies[cookie]), request.params.provider, request.query);
 });
 app.get<{ Params: { provider: string } }>(`${base}/health`, { schema: schema(object({ provider: str, state: str, backlog: nil(count), pendingFailures: nil(count), failedAttempts: nil(count), deadLetters: nil(count), pendingCommands: nil(count), legacyFailures: nil(count), lastProcessedAt: nil(date), lastCheckedAt: nil(date), diagnosticsSince: nil(date), detailsAvailable: bool })) }, async (request, reply) => {
  reply.header("cache-control", "no-store, private"); return diagnostics.health(await foundation.authenticate(request.cookies[cookie]), request.params.provider);
 });
 app.get<{ Params: { provider: string; id: string } }>(`${base}/:id`, { schema: schema(occurrence, { params: object({ provider: params.properties.provider, id: { type: "string", format: "uuid" } }) }) }, async (request, reply) => {
  reply.header("cache-control", "no-store, private"); return diagnostics.detail(await foundation.authenticate(request.cookies[cookie]), request.params.provider, request.params.id);
 });
}
