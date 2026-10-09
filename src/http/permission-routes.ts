import type { FastifyInstance, FastifyRequest, FastifySchema } from "fastify";
import type { Foundation } from "../application/foundation.js";
import type { Chat, PageQuery } from "../application/chat.js";
import type { Permissions, OverridesInput } from "../application/permissions.js";
import { resourceCatalog, permissionCatalog } from "../domain/resources.js";
const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, properties, required });
const str = { type: "string" }, uuid = { type: "string", format: "uuid" }, strings = { type: "array", items: str };
const revision = { type: "integer", minimum: 0, maximum: 2147483646 };
const member = obj({ id: uuid, userId: uuid, name: str, email: { type: "string", format: "email" }, role: str, status: str, userStatus: str });
const state = obj({ member, version: revision, inherited: strings, grants: strings, revocations: strings, effective: strings });
const resource = obj({ code: str, module: str, name: str, description: str, availability: { type: "string", enum: ["AVAILABLE", "PLANNED", "RESEARCH", "UNSUPPORTED", "DEPRECATED"] }, permissions: strings, dependencies: strings, base: { type: "boolean" }, entitlement: { type: ["string", "null"] }, navigation: { type: "boolean" } });
const permission = obj({ code: str, name: str, module: str, resourceCode: str, editable: { type: "boolean" }, sensitive: { type: "boolean" } });
const error = obj({ error: obj({ code: str, requestId: str }) });
const schema = (dto: unknown, mutable = false): FastifySchema => ({ tags: ["M2.1 Resources and Permissions"], security: [mutable ? { webSession: [], csrf: [] } : { webSession: [] }], response: { 200: dto, ...Object.fromEntries([400, 401, 403, 404, 409, 413, 415, 429, 500, 503].map((code) => [code, error])) } });
export async function permissionRoutes(app: FastifyInstance, foundation: Foundation, chat: Chat, permissions: Permissions, cookieName: string) {
  const principal = async (req: FastifyRequest) => {
    const p = await foundation.authenticate(req.cookies[cookieName]);
    if (req.method !== "GET") foundation.csrf(p, req.headers["x-csrf-token"] as string | undefined);
    return p;
  };
  app.get("/api/v1/resources", { schema: schema(obj({ items: { type: "array", items: resource } })) }, async (r) => {
    await chat.context(await principal(r), "organization.read");
    return { items: resourceCatalog };
  });
  app.get("/api/v1/permissions", { schema: schema(obj({ items: { type: "array", items: permission } })) }, async (r) => {
    await chat.context(await principal(r), "team.permissions.manage");
    return { items: permissionCatalog };
  });
  app.get<{ Querystring: PageQuery }>("/api/v1/team/directory", { schema: { ...schema(obj({ items: { type: "array", items: member }, nextCursor: { type: ["string", "null"] } })), querystring: obj({ limit: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "string", maxLength: 1500 } }, []) } }, async (r) => permissions.directory(await principal(r), r.query));
  const params = obj({ membershipId: uuid });
  app.get<{ Params: { membershipId: string } }>("/api/v1/team/members/:membershipId/permissions", { schema: { ...schema(state), params } }, async (r) => permissions.read(await principal(r), r.params.membershipId));
  const overrides = { type: "array", items: { type: "string", maxLength: 80 }, uniqueItems: true, maxItems: permissionCatalog.length };
  app.put<{ Params: { membershipId: string }; Body: OverridesInput }>("/api/v1/team/members/:membershipId/permissions", { schema: { ...schema(state, true), params, body: obj({ expectedVersion: revision, grants: overrides, revocations: overrides }) } }, async (r) => permissions.update(await principal(r), r.params.membershipId, r.body));
  app.post<{ Params: { membershipId: string }; Body: { expectedVersion: number } }>("/api/v1/team/members/:membershipId/permissions/reset", { schema: { ...schema(state, true), params, body: obj({ expectedVersion: revision }) } }, async (r) => permissions.update(await principal(r), r.params.membershipId, { ...r.body, grants: [], revocations: [] }, true));
}
