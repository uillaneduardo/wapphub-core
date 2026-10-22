import { resolvePermissions, resourceCatalog } from "../domain/resources.js";
import { PrismaClient, type Session, type User } from "@prisma/client";
import type { Config } from "../infrastructure/config.js";
import {
  digest,
  newToken,
  hashPassword,
  verifyPassword,
  equalHash,
} from "../infrastructure/crypto.js";
import { AppError } from "../domain/errors.js";
export type Principal = { session: Session; user: User };
export const publicUser = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
});
function cleanProfileName(value: string, maxLength: number): string {
  const name = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  // Attendant names also appear in WhatsApp Markdown signatures.
  if (name.length < 2 || name.length > maxLength || /[\p{Cc}\p{Cf}*_~`]/u.test(name))
    throw new AppError(400, "INVALID_PROFILE_NAME");
  return name;
}
export class Foundation {
  private dummy: Promise<string>;
  constructor(
    public db: PrismaClient,
    private config: Config,
  ) {
    this.dummy = hashPassword(newToken());
  }
  async login(email: string, password: string, oldToken?: string) {
    const user = await this.db.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    const valid = await verifyPassword(
      password,
      user?.passwordHash ?? (await this.dummy),
    );
    if (!valid || !user || user.status !== "ACTIVE") {
      await this.db.securityEvent.create({ data: { type: "LOGIN_FAILED" } });
      throw new AppError(401, "INVALID_CREDENTIALS");
    }
    const token = newToken(),
      csrfToken = newToken();
    const session = await this.db.$transaction(async (tx) => {
      if (oldToken)
        await tx.session.updateMany({
          where: { tokenHash: digest(oldToken), revokedAt: null },
          data: { revokedAt: new Date() },
        });
      const session = await tx.session.create({
        data: {
          userId: user.id,
          tokenHash: digest(token),
          csrfHash: digest(csrfToken),
          expiresAt: new Date(
            Date.now() + this.config.SESSION_ABSOLUTE_SECONDS * 1000,
          ),
        },
      });
      await tx.securityEvent.create({
        data: { userId: user.id, type: "LOGIN_SUCCESS" },
      });
      return session;
    });
    return { token, csrfToken, session, user: publicUser(user) };
  }
  async authenticate(
    token?: string,
    checkContext = true,
    touch = true,
  ): Promise<Principal> {
    if (!token || token.length > 128)
      throw new AppError(401, "UNAUTHENTICATED");
    const row = await this.db.session.findUnique({
      where: { tokenHash: digest(token) },
      include: { user: true },
    });
    const now = new Date();
    if (
      !row ||
      row.revokedAt ||
      row.expiresAt <= now ||
      row.lastSeenAt.getTime() + this.config.SESSION_IDLE_SECONDS * 1000 <=
        now.getTime() ||
      row.user.status !== "ACTIVE"
    )
      throw new AppError(401, "UNAUTHENTICATED");
    if (checkContext && row.currentOrganizationId)
      await this.membership(row.userId, row.currentOrganizationId);
    if (!touch) return { session: row, user: row.user };
    const updated = await this.db.session.updateMany({
      where: {
        id: row.id,
        revokedAt: null,
        expiresAt: { gt: now },
        lastSeenAt: {
          gt: new Date(now.getTime() - this.config.SESSION_IDLE_SECONDS * 1000),
        },
      },
      data: { lastSeenAt: now },
    });
    if (!updated.count) throw new AppError(401, "UNAUTHENTICATED");
    return { session: row, user: row.user };
  }
  csrf(principal: Principal, token?: string) {
    if (
      !token ||
      token.length > 128 ||
      !equalHash(token, principal.session.csrfHash)
    )
      throw new AppError(403, "CSRF_REJECTED");
  }
  restoreCsrf(principal: Principal, token?: string) {
    if (
      !token ||
      token.length > 128 ||
      !equalHash(token, principal.session.csrfHash)
    )
      return null;
    return token;
  }
  async updateProfile(principal: Principal, name: string) {
    const cleaned = cleanProfileName(name, 120);
    return this.db.$transaction(async (tx) => {
      const saved = await tx.user.updateMany({ where: { id: principal.user.id, status: "ACTIVE" }, data: { name: cleaned } });
      if (saved.count !== 1) throw new AppError(401, "UNAUTHENTICATED");
      await tx.securityEvent.create({ data: { userId: principal.user.id, type: "PROFILE_UPDATED" } });
      return publicUser(await tx.user.findUniqueOrThrow({ where: { id: principal.user.id } }));
    });
  }
  async updateOrganizationProfile(principal: Principal, displayName: string | null) {
    const organizationId = principal.session.currentOrganizationId;
    if (!organizationId) throw new AppError(409, "ORGANIZATION_CONTEXT_REQUIRED");
    const cleaned = displayName === null ? null : cleanProfileName(displayName, 80);
    return this.db.$transaction(async (tx) => {
      const member = await tx.membership.findFirst({
        where: { userId: principal.user.id, organizationId, status: "ACTIVE", organization: { status: "ACTIVE" } },
        select: { id: true, user: { select: { name: true } } },
      });
      if (!member) throw new AppError(403, "ORGANIZATION_ACCESS_DENIED");
      const updated = await tx.membership.updateMany({
        where: { id: member.id, userId: principal.user.id, organizationId, status: "ACTIVE", organization: { status: "ACTIVE" } },
        data: { displayName: cleaned },
      });
      if (updated.count !== 1) throw new AppError(403, "ORGANIZATION_ACCESS_DENIED");
      await tx.auditEvent.create({ data: { organizationId, actorUserId: principal.user.id, targetMembershipId: member.id, action: "MEMBER_DISPLAY_NAME_UPDATED" } });
      return { displayName: cleaned, effectiveDisplayName: cleaned ?? member.user.name };
    });
  }
  async membership(
    userId: string,
    organizationId: string,
    permission?: string,
  ) {
    const member = await this.db.membership.findFirst({
      where: {
        userId,
        organizationId,
        status: "ACTIVE",
        organization: { status: "ACTIVE" },
      },
      include: {
        permissionOverrides: { include: { permission: true } },
        organization: true,
        user: { select: { name: true } },
        role: { include: { permissions: { include: { permission: true } } } },
      },
    });
    if (!member) throw new AppError(403, "ORGANIZATION_ACCESS_DENIED");
    const permissions = resolvePermissions(member);
    if (permission && !permissions.includes(permission))
      throw new AppError(403, "PERMISSION_DENIED");
    return {
      organization: {
        id: member.organization.id,
        name: member.organization.name,
      },
      membership: {
        id: member.id,
        permissionVersion: member.permissionVersion,
        role: member.role.code,
        consumesSeat: member.consumesSeat,
        displayName: member.displayName,
        effectiveDisplayName: member.displayName ?? member.user.name,
      },
      permissions,
      resources: resourceCatalog,
    };
  }
  async organizations(principal: Principal) {
    const rows = await this.db.membership.findMany({
      where: {
        userId: principal.user.id,
        status: "ACTIVE",
        organization: { status: "ACTIVE" },
      },
      select: { organization: { select: { id: true, name: true } } },
      orderBy: { organizationId: "asc" },
    });
    return rows.map((r) => r.organization);
  }
  async select(principal: Principal, organizationId: string) {
    const context = await this.membership(
      principal.user.id,
      organizationId,
      "organization.read",
    );
    await this.db.$transaction(async (tx) => {
      const updated = await tx.session.updateMany({
        where: {
          id: principal.session.id,
          userId: principal.user.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { currentOrganizationId: organizationId },
      });
      if (!updated.count) throw new AppError(401, "UNAUTHENTICATED");
      await tx.auditEvent.create({
        data: {
          organizationId,
          actorUserId: principal.user.id,
          action: "ORGANIZATION_CONTEXT_SELECTED",
        },
      });
    });
    return context;
  }
  async bootstrap(principal: Principal) {
    if (!principal.session.currentOrganizationId)
      throw new AppError(409, "ORGANIZATION_CONTEXT_REQUIRED");
    const context = await this.membership(
      principal.user.id,
      principal.session.currentOrganizationId,
      "organization.read",
    );
    return { user: publicUser(principal.user), ...context };
  }
  async logout(principal: Principal) {
    await this.db.$transaction(async (tx) => {
      await tx.session.updateMany({
        where: {
          id: principal.session.id,
          userId: principal.user.id,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      await tx.securityEvent.create({
        data: { userId: principal.user.id, type: "SESSION_REVOKED" },
      });
    });
  }
}
