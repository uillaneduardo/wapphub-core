import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type { WebSocket } from "ws";
import type { Foundation, Principal } from "../application/foundation.js";
import type { Chat } from "../application/chat.js";
import type { Config } from "../infrastructure/config.js";
import { AppError } from "../domain/errors.js";
import { decimal } from "../domain/chat.js";
type Client = {
  socket: WebSocket;
  token: string;
  organizationId: string;
  sessionId: string;
  cursor: string;
  permissionStamp: string;
  sessionOnly: boolean;
  providersOnly: boolean;
  contactsOnly: boolean;
  running: boolean;
  pending: boolean;
};
export class RealtimeGateway {
  private clients = new Set<Client>();
  private subscriber: Redis;
  private timer: ReturnType<typeof setInterval>;
  private ticks = 0;
  constructor(
    private foundation: Foundation,
    private chat: Chat,
    private redis: Redis,
  ) {
    this.subscriber = redis.duplicate();
    this.subscriber.on("error", () => {});
    this.subscriber.on("pmessage", (_pattern, channel) => {
      const org = channel.slice("wapphub:realtime:".length);
      for (const c of this.clients)
        if (c.organizationId === org) void this.pump(c);
    });
    this.subscriber.on("ready", () => {
      void this.subscriber
        .psubscribe("wapphub:realtime:*")
        .then(() => this.revalidate(true))
        .catch(() => {});
    });
    // Revocation guard plus durable reconciliation after lost notifications/process crash.
    this.timer = setInterval(() => {
      void this.revalidate(++this.ticks % 5 === 0);
    }, 1000);
    this.timer.unref();
  }
  async publish(org: string) {
    await this.redis.publish(`wapphub:realtime:${org}`, "wake");
    for (const c of this.clients)
      if (c.organizationId === org) void this.pump(c);
  }
  private async principal(c: Client): Promise<Principal> {
    const p = await this.foundation.authenticate(c.token, false, false);
    if (
      p.session.id !== c.sessionId ||
      p.session.currentOrganizationId !== c.organizationId
    )
      throw new AppError(403, "REALTIME_CONTEXT_CHANGED");
    const context = await this.foundation.membership(p.user.id, c.organizationId, c.sessionOnly ? "organization.read" : undefined);
    const stamp = `${context.membership.permissionVersion}:${context.permissions.join(",")}`;
    if (stamp !== c.permissionStamp) {
      this.closeClient(c, 4003);
      throw new AppError(403, "PERMISSIONS_CHANGED");
    }
    if (!c.sessionOnly) {
      try { await this.chat.context(p, c.providersOnly ? "providers.manage" : c.contactsOnly ? "contacts.read" : "conversations.read"); }
      catch (error) {
        // A revocation can commit between the stamp read and the operational
        // permission check. Preserve the refresh signal without delivering data.
        if (error instanceof AppError && error.code === "PERMISSION_DENIED") {
          const updated = await this.foundation.membership(p.user.id, c.organizationId);
          if (`${updated.membership.permissionVersion}:${updated.permissions.join(",")}` !== c.permissionStamp) this.closeClient(c, 4003);
        }
        throw error;
      }
    }
    return p;
  }
  private closeClient(c: Client, code = 1008) {
    if (!this.clients.delete(c)) return;
    c.socket.close(code, "Reconnect with authorized context");
    setTimeout(() => {
      if (c.socket.readyState !== 3) c.socket.terminate();
    }, 1000).unref();
  }
  async revalidate(sync = false) {
    await Promise.all(
      [...this.clients].map(async (c) => {
        try {
          await this.principal(c);
          if (sync) await this.pump(c);
        } catch {
          this.closeClient(c);
        }
      }),
    );
  }
  private async pump(c: Client) {
    if (c.running) {
      c.pending = true;
      return;
    }
    c.running = true;
    try {
      do {
        c.pending = false;
        const p = await this.principal(c);
        if (c.sessionOnly) {
          c.socket.send(JSON.stringify({ version: 1, type: "sync.checkpoint", lastEventId: "0", hasMore: false }));
          return;
        }
        const batch = await this.chat.stream(p, c.cursor, 100, c.providersOnly, c.contactsOnly);
        await this.principal(c); // Do not deliver a batch resolved with stale authority.
        if (c.socket.readyState !== 1) return;
        if (c.socket.bufferedAmount > 1024 * 1024) {
          this.closeClient(c, 1013);
          return;
        }
        for (const event of batch.events) c.socket.send(JSON.stringify(event));
        c.cursor = batch.lastEventId;
        c.socket.send(
          JSON.stringify({
            version: 1,
            type: "sync.checkpoint",
            lastEventId: c.cursor,
            hasMore: batch.hasMore,
          }),
        );
        if (batch.hasMore) c.pending = true;
      } while (c.pending && this.clients.has(c));
    } catch {
      // The permission revision may change after principal() but before stream().
      // Revalidate once to emit the refresh signal; never send the failed batch.
      if (this.clients.has(c)) await this.principal(c).catch(() => undefined);
      this.closeClient(c);
    } finally {
      c.running = false;
    }
  }
  async routes(app: FastifyInstance, config: Config, cookieName: string) {
    for (const kind of ["chat", "session", "providers", "contacts"] as const) {
    const sessionOnly = kind === "session", providersOnly = kind === "providers", contactsOnly = kind === "contacts";
    const permission = sessionOnly ? "organization.read" : providersOnly ? "providers.manage" : contactsOnly ? "contacts.read" : "conversations.read";
    app.get<{ Querystring: { lastEventId?: string } }>(
      sessionOnly ? "/api/v1/session/updates" : providersOnly ? "/api/v1/providers/realtime" : contactsOnly ? "/api/v1/contacts/realtime" : "/api/v1/realtime",
      {
        websocket: true,
        schema: {
          hide: true,
          querystring: {
            type: "object",
            additionalProperties: false,
            properties: {
              lastEventId: {
                type: "string",
                pattern: "^(0|[1-9][0-9]{0,18})$",
              },
            },
          },
        },
        preValidation: async (req) => {
          if (
            !req.headers.origin ||
            !config.origins.includes(req.headers.origin)
          )
            throw new AppError(403, "ORIGIN_REJECTED");
          if (req.query.lastEventId) decimal(req.query.lastEventId);
          const p = await this.foundation.authenticate(req.cookies[cookieName]);
          await this.chat.context(p, permission);
        },
      },
      (socket, req) => {
        // Read-only protocol; REST owns all commands/CSRF. Attach handlers synchronously.
        socket.on("error", () => {});
        socket.on("message", () =>
          socket.close(1008, "Read-only event stream"),
        );
        let client: Client | undefined;
        socket.on("close", () => {
          if (client) this.clients.delete(client);
        });
        void (async () => {
          const token = req.cookies[cookieName]!;
          const p = await this.foundation.authenticate(token, true, false);
          const context = await this.chat.context(p, permission);
          const authorization = await this.foundation.membership(p.user.id, context.organizationId, sessionOnly ? "organization.read" : undefined);
          if (socket.readyState !== 1) return;
          client = {
            socket,
            token,
            organizationId: context.organizationId,
            sessionId: p.session.id,
            cursor: req.query.lastEventId ?? "0",
            sessionOnly,
            providersOnly,
            contactsOnly,
            permissionStamp: `${authorization.membership.permissionVersion}:${authorization.permissions.join(",")}`,
            running: false,
            pending: false,
          };
          // Bound per-session sockets; does not use IP/provider headers as authorization.
          if (
            [...this.clients].filter((c) => c.sessionId === p.session.id)
              .length >= 5
          ) {
            socket.close(1013, "Connection limit");
            return;
          }
          this.clients.add(client);
          await this.pump(client);
        })().catch(() => socket.close(1008, "Unauthorized"));
      },
    );
    }
  }
  async close() {
    clearInterval(this.timer);
    for (const c of this.clients) {
      c.socket.terminate();
    }
    this.clients.clear();
    await this.subscriber.quit().catch(() => this.subscriber.disconnect());
  }
}
