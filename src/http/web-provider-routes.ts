import type { FastifyInstance, FastifyRequest, FastifySchema } from "fastify";
import type { Foundation } from "../application/foundation.js";
import type { WebConnections, CommandInput } from "../application/web-connections.js";
import type { Chat } from "../application/chat.js";
import { chatEventTypes } from "../realtime/contract.js";
const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, properties, required });
const str = { type: "string" }, uuid = { type: "string", format: "uuid" }, date = { type: "string", format: "date-time" }, nullable = (value: unknown) => ({ anyOf: [value, { type: "null" }] });
const error = obj({ error: obj({ code: str, requestId: str }) });
const operation = obj({ id: uuid, action: { type: "string", enum: ["create", "connect", "refresh", "disconnect"] }, status: { type: "string", enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"] }, errorCode: nullable(str) });
const connection = obj({ id: uuid, state: { type: "string", enum: ["DISCONNECTED", "CONNECTING", "QR_REQUIRED", "CONNECTED", "RECONNECTING", "FAILED", "LOGGED_OUT"] }, uiState: { type: "string", enum: ["DISCONNECTED", "CONNECTING", "QR_READY", "CONNECTED", "RECONNECTING", "ERROR"] }, version: { type: "integer", minimum: 1 }, qrRevision: { type: "integer", minimum: 0 }, errorCode: nullable(str), lastCheckedAt: nullable(date), operation: nullable(operation), sendingEnabled: { type: "boolean", const: false }, mediaEnabled: { type: "boolean", const: false } });
const schema = (dto: unknown, mutable = false, extra = {}): FastifySchema => ({ tags: ["WhatsApp Web"], security: [mutable ? { webSession: [], csrf: [] } : { webSession: [] } as Record<string, string[]>], response: { 200: dto, 400: error, 401: error, 403: error, 404: error, 409: error, 413: error, 415: error, 429: error, 500: error, 503: error }, ...extra });
const base = "/api/v1/providers/whatsapp-web/connections";
export async function webProviderRoutes(app: FastifyInstance, foundation: Foundation, connections: WebConnections, chat: Chat, cookieName: string) {
  const principal = async (request: FastifyRequest) => {
    const user = await foundation.authenticate(request.cookies[cookieName]);
    if (request.method !== "GET") foundation.csrf(user, request.headers["x-csrf-token"] as string | undefined);
    return user;
  };
  app.get(base, { schema: schema(obj({ connection: nullable(connection) })) }, async (request) => connections.read(await principal(request)));
  app.post<{ Body: { commandId: string } }>(base, { schema: schema(connection, true, { body: obj({ commandId: uuid }) }) }, async (request) => connections.create(await principal(request), request.body.commandId));
  app.post<{ Params: { id: string }; Body: CommandInput }>(`${base}/:id/commands`, { schema: schema(connection, true, { params: obj({ id: uuid }), body: obj({ commandId: uuid, action: { type: "string", enum: ["connect", "refresh", "disconnect"] }, expectedVersion: { type: "integer", minimum: 1 } }) }) }, async (request) => connections.command(await principal(request), request.params.id, request.body));
  app.get<{ Params: { id: string } }>(`${base}/:id/qr`, { schema: schema(obj({ qr: { type: "string", minLength: 1, maxLength: 8192 }, revision: { type: "integer", minimum: 1 }, expiresAt: date, expiresInMs: { type: "integer", minimum: 1, maximum: 30000 } }), false, { params: obj({ id: uuid }) }) }, async (request, reply) => {
    reply.header("cache-control", "no-store, private").header("pragma", "no-cache");
    return connections.qr(await principal(request), request.params.id);
  });
  app.get<{ Querystring: { lastEventId?: string; limit?: number } }>("/api/v1/providers/realtime/events", { schema: schema(obj({ events: { type: "array", items: obj({ version: { type: "integer", enum: [1] }, eventId: str, organizationId: uuid, type: { type: "string", enum: [...chatEventTypes] }, entityId: uuid, occurredAt: date, payload: obj({ resourceId: uuid }) }) }, lastEventId: str, hasMore: { type: "boolean" } }), false, { querystring: obj({ lastEventId: { type: "string", pattern: "^(0|[1-9][0-9]{0,18})$" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, []) }) }, async (request) => chat.stream(await principal(request), request.query.lastEventId, request.query.limit, true));
}
