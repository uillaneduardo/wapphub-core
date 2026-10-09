import type { Prisma, PrismaClient } from "@prisma/client";
import type { Chat, PageQuery } from "./chat.js";
import type { Principal } from "./foundation.js";
import type { Config } from "../infrastructure/config.js";
import { AppError } from "../domain/errors.js";
import { cursorDecode, cursorEncode } from "../domain/chat.js";
import { permissionCatalog, resolvePermissions } from "../domain/resources.js";
const include = { user: true, role: { include: { permissions: { include: { permission: true } } } }, permissionOverrides: { include: { permission: true } } } as const;
type Member = Prisma.MembershipGetPayload<{ include: typeof include }>;
export type OverridesInput = { expectedVersion: number; grants: string[]; revocations: string[] };
function memberDTO(member: Member) {
  return { id: member.id, userId: member.userId, name: member.user.name, email: member.user.email, role: member.role.code, status: member.status, userStatus: member.user.status };
}
function permissionsDTO(member: Member) {
  return { member: memberDTO(member), version: member.permissionVersion, inherited: member.role.permissions.map((row) => row.permission.code).sort(), grants: member.permissionOverrides.filter((row) => row.effect === "GRANT").map((row) => row.permission.code).sort(), revocations: member.permissionOverrides.filter((row) => row.effect === "REVOKE").map((row) => row.permission.code).sort(), effective: member.status === "ACTIVE" && member.user.status === "ACTIVE" ? resolvePermissions(member) : [] };
}
export class Permissions {
  constructor(private db: PrismaClient, private chat: Chat, private config: Config) {}
  async directory(p: Principal, query: PageQuery) {
    const c = await this.chat.context(p, "team.read");
    const scope = `membership-directory:${c.organizationId}:${c.userId}`;
    const after = cursorDecode(this.config.ENCRYPTION_KEY, scope, query.cursor);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const rows = await this.db.membership.findMany({ where: { organizationId: c.organizationId, ...(after ? { id: { gt: after } } : {}) }, include, orderBy: { id: "asc" }, take: limit + 1 });
    return { items: rows.slice(0, limit).map(memberDTO), nextCursor: rows.length > limit ? cursorEncode(this.config.ENCRYPTION_KEY, scope, rows[limit - 1]!.id) : null };
  }
  async read(p: Principal, id: string) {
    const c = await this.chat.context(p, "team.permissions.manage");
    const member = await this.db.membership.findFirst({ where: { id, organizationId: c.organizationId }, include });
    if (!member) throw new AppError(404, "MEMBER_NOT_FOUND");
    return permissionsDTO(member);
  }
  async update(p: Principal, id: string, input: OverridesInput, restore = false) {
    return this.chat.mutation(p, "team.permissions.manage", async (tx, c) => {
      const member = await tx.membership.findFirst({ where: { id, organizationId: c.organizationId }, include });
      if (!member) throw new AppError(404, "MEMBER_NOT_FOUND");
      if (member.userId === c.userId) throw new AppError(403, "SELF_PERMISSION_CHANGE_DENIED");
      if (member.permissionVersion !== input.expectedVersion) throw new AppError(409, "PERMISSION_VERSION_CONFLICT");
      const grants = restore ? [] : input.grants, revocations = restore ? [] : input.revocations;
      const codes = [...grants, ...revocations];
      if (new Set(codes).size !== codes.length || codes.some((code) => !permissionCatalog.some((entry) => entry.code === code && entry.editable))) throw new AppError(400, "INVALID_PERMISSION_OVERRIDE");
      const before = permissionsDTO(member);
      const overrides = codes.map((code) => ({ permission: { code }, effect: grants.includes(code) ? "GRANT" : "REVOKE" }));
      const after = resolvePermissions({ role: member.role, permissionOverrides: overrides });
      // Neither granting new authority nor editing authority absent from the actor is allowed.
      const beforeEffects = new Map([...before.grants.map((code) => [code, "GRANT"] as const), ...before.revocations.map((code) => [code, "REVOKE"] as const)]);
      const nextEffects = new Map(overrides.map((row) => [row.permission.code, row.effect]));
      const changed = new Set([...new Set([...codes, ...beforeEffects.keys()])].filter((code) => beforeEffects.get(code) !== nextEffects.get(code)));
      for (const code of after) if (!resolvePermissions(member).includes(code)) changed.add(code);
      if ([...changed].some((code) => !c.permissions.includes(code))) throw new AppError(403, "PERMISSION_DELEGATION_DENIED");
      if (after.includes("team.permissions.manage") && !after.includes("team.read")) throw new AppError(400, "PERMISSION_DEPENDENCY_REQUIRED");
      const owners = await tx.membership.findMany({ where: { organizationId: c.organizationId, status: "ACTIVE", user: { status: "ACTIVE" }, role: { code: "OWNER" } }, include });
      if (!owners.some((owner) => {
        const effective = owner.id === member.id ? after : resolvePermissions(owner);
        return ["organization.read", "team.read", "team.permissions.manage"].every((code) => effective.includes(code));
      })) throw new AppError(409, "LAST_FUNCTIONAL_OWNER_REQUIRED");
      const permissions = await tx.permission.findMany({ where: { code: { in: codes } } });
      if (permissions.length !== codes.length) throw new AppError(400, "INVALID_PERMISSION_OVERRIDE");
      await tx.membershipPermissionOverride.deleteMany({ where: { organizationId: c.organizationId, membershipId: id } });
      if (codes.length) await tx.membershipPermissionOverride.createMany({ data: permissions.map((permission) => ({ organizationId: c.organizationId, membershipId: id, permissionId: permission.id, effect: grants.includes(permission.code) ? "GRANT" : "REVOKE" })) });
      await tx.membership.update({ where: { id }, data: { permissionVersion: { increment: 1 } } });
      await tx.auditEvent.create({ data: { organizationId: c.organizationId, actorUserId: c.userId, targetMembershipId: id, action: restore ? "MEMBER_PERMISSIONS_RESTORED" : "MEMBER_PERMISSIONS_UPDATED", details: { before: { grants: before.grants, revocations: before.revocations, version: before.version }, after: { grants, revocations, version: before.version + 1 } } } });
      return permissionsDTO((await tx.membership.findUniqueOrThrow({ where: { id }, include })));
    });
  }
}
