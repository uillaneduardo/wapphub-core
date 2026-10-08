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
  async authenticate(token?: string, checkContext = true): Promise<Principal> {
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
        organization: true,
        role: { include: { permissions: { include: { permission: true } } } },
      },
    });
    if (!member) throw new AppError(403, "ORGANIZATION_ACCESS_DENIED");
    const permissions = member.role.permissions
      .map((p) => p.permission.code)
      .sort();
    if (permission && !permissions.includes(permission))
      throw new AppError(403, "PERMISSION_DENIED");
    return {
      organization: {
        id: member.organization.id,
        name: member.organization.name,
      },
      membership: {
        id: member.id,
        role: member.role.code,
        consumesSeat: member.consumesSeat,
      },
      permissions,
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
