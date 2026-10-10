import { Permissions } from "../application/permissions.js";
import { permissionRoutes } from "./permission-routes.js";
import websocket from "@fastify/websocket";
import { Chat } from "../application/chat.js";
import { chatRoutes } from "./chat-routes.js";
import { RealtimeGateway } from "../realtime/gateway.js";
import Fastify, { LogController, type FastifyError } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import swagger from "@fastify/swagger";
import rateLimit from "@fastify/rate-limit";
import type { Writable } from "node:stream";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { Config } from "../infrastructure/config.js";
import { Foundation, publicUser } from "../application/foundation.js";
import { AppError } from "../domain/errors.js";
import { loginRateLimitKey } from "./client-ip.js";
import { DemoProvider } from "../integrations/demo-provider.js";
import { MessageIngestionService } from "../application/message-ingestion.js";
import { WebConnections } from "../application/web-connections.js";
import { configuredWebProvider, type WebProviderPort } from "../integrations/web-provider-client.js";
import { ProviderDiagnostics } from "../application/provider-diagnostics.js";
import { providerDiagnosticsRoutes } from "./provider-diagnostics-routes.js";
import { webProviderRoutes } from "./web-provider-routes.js";
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
const string = { type: "string" };
const user = object({ id: string, name: string, email: string });
const organization = object({ id: string, name: string });
const context = object({
  organization,
  membership: object({
    id: string,
    permissionVersion: { type: "integer", minimum: 0 },
    role: string,
    consumesSeat: { type: "boolean" },
  }),
  permissions: { type: "array", items: string },
  resources: { type: "array", items: { type: "object", additionalProperties: false, properties: {
    code: string, module: string, name: string, description: string,
    availability: { type: "string", enum: ["AVAILABLE", "PLANNED", "RESEARCH", "UNSUPPORTED", "DEPRECATED"] },
    permissions: { type: "array", items: string }, dependencies: { type: "array", items: string }, base: { type: "boolean" }, entitlement: { type: ["string", "null"] }, navigation: { type: "boolean" },
  }, required: ["code", "module", "name", "description", "availability", "permissions", "dependencies", "base", "entitlement", "navigation"] } },
});
const error = object({ error: object({ code: string, requestId: string }) });
const responses = {
  400: error,
  401: error,
  403: error,
  409: error,
  413: error,
  415: error,
  429: error,
  500: error,
  503: error,
};
export async function buildApp(
  config: Config,
  db: PrismaClient,
  redis: Redis,
  logging = true,
  stream?: Writable,
  webProvider?: WebProviderPort,
) {
  const app = Fastify({
    trustProxy: false,
    bodyLimit: 16384,
    ajv: { customOptions: { removeAdditional: false } },
    logger: logging
      ? {
          stream,
          redact: {
            paths: [
              "req.headers.cookie",
              "req.headers.authorization",
              'req.headers["x-csrf-token"]',
              'res.headers["set-cookie"]',
              "password",
              "token",
              "csrfToken",
              "passwordHash",
            ],
            censor: "[REDACTED]",
          },
          serializers: {
            req: (r) => ({
              method: r.method,
              url: r.url?.split("?")[0],
              id: r.id,
            }),
            err: () => ({
              type: "Error",
              message: "Internal operation failed",
              stack: "",
            }),
          },
        }
      : false,
    logController: new LogController({ disableRequestLogging: true }),
  });
  const foundation = new Foundation(db, config);
  const sessionCookie =
    config.NODE_ENV === "production"
      ? "__Host-wapphub_session"
      : "wapphub_session";
  const cookieOptions = {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
  };
  await app.register(websocket, { options: { maxPayload: 4096 } });
  await app.register(cookie);
  await app.register(cors, {
    origin: config.origins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["content-type", "x-csrf-token"],
  });
  await app.register(helmet);
  await app.register(rateLimit, {
    global: false,
    redis,
    skipOnError: false,
    keyGenerator: (request) =>
      loginRateLimitKey(request, config.trustedCloudflaredIPs),
  });
  await app.register(swagger, {
    openapi: {
      info: { title: "WappHub Core", version: "1.0.0" },
      components: {
        securitySchemes: {
          webSession: { type: "apiKey", in: "cookie", name: sessionCookie },
          csrf: { type: "apiKey", in: "header", name: "x-csrf-token" },
        },
      },
    },
  });
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (
      req.method !== "GET" &&
      req.method !== "HEAD" &&
      req.method !== "OPTIONS" &&
      (!req.headers.origin || !config.origins.includes(req.headers.origin))
    )
      throw new AppError(403, "ORIGIN_REJECTED");
  });
  app.setErrorHandler((err, req, reply) => {
    const failure = err as FastifyError;
    const status =
      err instanceof AppError
        ? err.status
        : failure.validation || failure.statusCode === 400
          ? 400
          : failure.statusCode === 429
            ? 429
            : failure.statusCode === 415
              ? 415
              : failure.statusCode === 413
                ? 413
                : 500;
    const code =
      err instanceof AppError
        ? err.code
        : status === 400
          ? "INVALID_REQUEST"
          : status === 429
            ? "RATE_LIMITED"
            : status === 415
              ? "UNSUPPORTED_MEDIA_TYPE"
              : status === 413
                ? "PAYLOAD_TOO_LARGE"
                : "INTERNAL_ERROR";
    if (status >= 500)
      req.log.error({ requestId: req.id }, "Internal operation failed");
    return reply.code(status).send({ error: { code, requestId: req.id } });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: { code: "NOT_FOUND", requestId: req.id } }),
  );
  const secured = { security: [{ webSession: [] }], response: responses };
  const mutable = {
    security: [{ webSession: [], csrf: [] }],
    response: responses,
  };
  const chat: Chat = new Chat(db, config, async (org): Promise<void> =>
    gateway.publish(org),
    new DemoProvider(),
    new MessageIngestionService(),
  );
  const gateway = new RealtimeGateway(foundation, chat, redis);
  app.addHook("preClose", async () => gateway.close());
  await chatRoutes(app, foundation, chat, sessionCookie);
  await permissionRoutes(app, foundation, chat, new Permissions(db, chat, config), sessionCookie);
  await providerDiagnosticsRoutes(app, foundation, new ProviderDiagnostics(db, chat), sessionCookie);
  await webProviderRoutes(app, foundation, new WebConnections(db, chat, webProvider ?? await configuredWebProvider(config)), chat, sessionCookie);
  await gateway.routes(app, config, sessionCookie);
  const authenticate = (req: { cookies: Record<string, string | undefined> }) =>
    foundation.authenticate(req.cookies[sessionCookie]);
  app.get(
    "/api/v1/health",
    {
      schema: {
        response: { 200: object({ status: { type: "string", enum: ["ok"] } }) },
      },
    },
    async () => ({ status: "ok" }),
  );
  app.get(
    "/api/v1/health/ready",
    {
      schema: {
        response: {
          200: object({ status: { type: "string", enum: ["ready"] } }),
          503: error,
        },
      },
    },
    async () => {
      try {
        await Promise.all([db.$queryRaw`SELECT 1`, redis.ping()]);
        return { status: "ready" };
      } catch {
        throw new AppError(503, "NOT_READY");
      }
    },
  );
  app.post<{ Body: { email: string; password: string } }>(
    "/api/v1/auth/login",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        body: object({
          email: { type: "string", format: "email", maxLength: 254 },
          password: { type: "string", minLength: 1, maxLength: 1024 },
        }),
        response: { ...responses, 200: object({ user, csrfToken: string }) },
      },
    },
    async (req, reply) => {
      const result = await foundation.login(
        req.body.email,
        req.body.password,
        req.cookies[sessionCookie],
      );
      reply.setCookie(sessionCookie, result.token, {
        ...cookieOptions,
        maxAge: config.SESSION_ABSOLUTE_SECONDS,
      });
      // A readable CSRF cookie permits browser clients to restore the header after reload.
      reply.setCookie("wapphub_csrf", result.csrfToken, {
        ...cookieOptions,
        httpOnly: false,
        maxAge: config.SESSION_ABSOLUTE_SECONDS,
      });
      return { user: result.user, csrfToken: result.csrfToken };
    },
  );
  app.post(
    "/api/v1/auth/logout",
    {
      schema: { ...mutable, response: { ...responses, 204: { type: "null" } } },
    },
    async (req, reply) => {
      const principal = await foundation.authenticate(
        req.cookies[sessionCookie],
        false,
      );
      foundation.csrf(
        principal,
        req.headers["x-csrf-token"] as string | undefined,
      );
      await foundation.logout(principal);
      await gateway.revalidate();
      reply
        .clearCookie(sessionCookie, cookieOptions)
        .clearCookie("wapphub_csrf", { ...cookieOptions, httpOnly: false });
      return reply.code(204).send();
    },
  );
  app.get(
    "/api/v1/me",
    {
      schema: {
        ...secured,
        response: {
          ...responses,
          200: object({
            user,
            currentOrganizationId: { type: ["string", "null"] },
            csrfToken: { type: ["string", "null"] },
          }),
        },
      },
    },
    async (req) => {
      const principal = await authenticate(req);
      return {
        user: publicUser(principal.user),
        currentOrganizationId: principal.session.currentOrganizationId,
        csrfToken: foundation.restoreCsrf(principal, req.cookies.wapphub_csrf),
      };
    },
  );
  app.get(
    "/api/v1/me/organizations",
    {
      schema: {
        ...secured,
        response: {
          ...responses,
          200: object({
            organizations: { type: "array", items: organization },
          }),
        },
      },
    },
    async (req) => ({
      organizations: await foundation.organizations(await authenticate(req)),
    }),
  );
  app.post<{ Body: { organizationId: string } }>(
    "/api/v1/session/organization",
    {
      schema: {
        ...mutable,
        body: object({ organizationId: { type: "string", format: "uuid" } }),
        response: { ...responses, 200: context },
      },
    },
    async (req) => {
      const principal = await authenticate(req);
      foundation.csrf(
        principal,
        req.headers["x-csrf-token"] as string | undefined,
      );
      const selected = await foundation.select(
        principal,
        req.body.organizationId,
      );
      await gateway.revalidate();
      return selected;
    },
  );
  app.get(
    "/api/v1/app/bootstrap",
    {
      schema: {
        ...secured,
        response: {
          ...responses,
          200: object({ user, ...context.properties }),
        },
      },
    },
    async (req) => foundation.bootstrap(await authenticate(req)),
  );
  app.get("/api/v1/openapi.json", { schema: { hide: true } }, async () =>
    app.swagger(),
  );
  return app;
}
