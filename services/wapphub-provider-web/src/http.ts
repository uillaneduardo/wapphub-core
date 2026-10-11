import { resolveRecipientSchema, recipientResultSchema, sendIntentSchema } from "../../../contracts/provider-outbound.js";
import type { Readable } from "node:stream";
import { mediaUploadSchema } from "../../../contracts/provider-media.js";
import type { ProviderMedia } from "./media.js";
import Fastify from "fastify";
import { historyControlSchema } from "../../../contracts/history.js";
import { z } from "zod";
import { InternalAuth } from "./auth.js";
import { ServiceError } from "./errors.js";
import { EventJournal } from "./events.js";
import { Sessions } from "./sessions.js";
import { scopeSchema } from "./vault.js";

const commandSchema = z.strictObject({ action: z.enum(["connect", "refresh", "disconnect", "logout"]), commandId: z.uuid() });
const eventAckSchema = z.strictObject({ eventId: z.uuid(), leaseId: z.uuid() });
const prefix = "/internal/v1/organizations/:organizationId/connections/:connectionId";
export function createHttp(sessions: Sessions, journal: EventJournal, auth: InternalAuth, log: (code: string) => void = () => undefined, media?: ProviderMedia) {
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024, requestTimeout: 15_000, connectionTimeout: 10_000, routerOptions: { maxParamLength: 100 } });
  app.addContentTypeParser("application/octet-stream", (_request, payload, done) => done(null, payload));
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: "NOT_FOUND" } }));
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", "no-store").header("x-content-type-options", "nosniff");
  });
  app.addHook("preHandler", async (request) => {
    if (request.url === "/health/live" || request.url === "/health/ready") return;
    if (request.headers["content-type"] === "application/octet-stream") {
      const value = request.headers["x-media-manifest"];
      if (typeof value !== "string" || value.length > 4096) throw new ServiceError("INVALID_REQUEST", 400);
      const manifest = mediaUploadSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString()));
      await auth.verify(request.method, request.url, manifest, request.headers);
    } else await auth.verify(request.method, request.url, request.body, request.headers);
  });
  app.setErrorHandler((error, _request, reply) => {
    const code = error instanceof ServiceError ? error.code : error instanceof z.ZodError ? "INVALID_REQUEST" : "REQUEST_FAILED";
    const httpStatus = error && typeof error === "object" && "statusCode" in error ? error.statusCode : undefined;
    const status = error instanceof ServiceError ? error.statusCode : error instanceof z.ZodError ? 400 : typeof httpStatus === "number" && httpStatus >= 400 && httpStatus < 500 ? httpStatus : 503;
    log(code);
    void reply.code(status).send({ error: { code } });
  });
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    if (!sessions.ready()) return reply.code(503).send({ status: "not_ready" });
    return { status: "ready", connectionsEnabled: sessions.connectEnabled };
  });
  app.get("/internal/v1/metrics", async () => ({ ...sessions.metrics(), memoryBytes: process.memoryUsage().rss, uptimeSeconds: process.uptime() }));
  app.put(prefix, async (request) => sessions.create(scopeSchema.parse(request.params)));
  app.get(prefix, async (request) => sessions.view(scopeSchema.parse(request.params)));
  app.get(`${prefix}/qr`, async (request) => sessions.qr(scopeSchema.parse(request.params)));
  app.post(`${prefix}/media`, { bodyLimit: 25 * 1024 * 1024 }, async request => {
    if (!media || request.headers["content-type"] !== "application/octet-stream") throw new ServiceError("MEDIA_DISABLED", 403);
    const manifest = mediaUploadSchema.parse(JSON.parse(Buffer.from(String(request.headers["x-media-manifest"]), "base64url").toString()));
    return media.upload(scopeSchema.parse(request.params), manifest, request.body as Readable);
  });
  app.get(`${prefix}/media/:id`, async (request, reply) => {
    if (!media) throw new ServiceError("MEDIA_DISABLED", 403);
    const { id, ...scope } = z.strictObject({ ...scopeSchema.shape, id: z.uuid() }).parse(request.params);
    const result = await media.read(scope, id);
    reply.header("content-type", result.record.mimeType).header("content-length", result.record.size).header("x-media-sha256", result.record.sha256);
    return reply.send(result.stream);
  });
  app.post(`${prefix}/recipients/resolve`, async request => recipientResultSchema.parse(await sessions.resolveRecipient(scopeSchema.parse(request.params), resolveRecipientSchema.parse(request.body).phone)));
  app.post(`${prefix}/messages`, async request => sessions.send(scopeSchema.parse(request.params), sendIntentSchema.parse(request.body)));
  app.post(`${prefix}/history`, async (request) => sessions.history(scopeSchema.parse(request.params), historyControlSchema.parse(request.body)));
  app.post(`${prefix}/commands`, async (request) => {
    const scope = scopeSchema.parse(request.params), body = commandSchema.parse(request.body);
    return sessions.command(scope, body.action, body.commandId);
  });
  app.post(`${prefix}/events/pull`, async (request) => {
    const scope = scopeSchema.parse(request.params), body = z.strictObject({ limit: z.number().int().min(1).max(20) }).parse(request.body);
    sessions.view(scope);
    return { deliveries: await journal.pull(scope, body.limit) };
  });
  for (const action of ["ack", "nack"] as const) {
    app.post(`${prefix}/events/${action}`, async (request) => {
      const scope = scopeSchema.parse(request.params), body = eventAckSchema.parse(request.body);
      sessions.view(scope);
      await journal[action](scope, body.eventId, body.leaseId);
      return { status: "ok" };
    });
  }
  app.post(`${prefix}/events/retry`, async (request) => {
    const scope = scopeSchema.parse(request.params), body = z.strictObject({ eventId: z.uuid() }).parse(request.body);
    sessions.view(scope); await journal.retryDead(scope, body.eventId); return { status: "ok" };
  });
  return app;
}
