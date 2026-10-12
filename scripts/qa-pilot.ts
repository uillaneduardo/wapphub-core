import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../src/domain/errors.js";
import { loadConfig } from "../src/infrastructure/config.js";
import { configuredWebProvider, type WebProviderPort } from "../src/integrations/web-provider-client.js";
const inputSchema = z.strictObject({ ownerUserId: z.uuid(), organizationId: z.uuid(), connectionId: z.uuid() });
export type QaPilotInput = z.infer<typeof inputSchema>;
/** Explicit maintenance command, never invoked by HTTP, Worker or application startup.
 * Uses existing identities/roles; creates no passwords, invites or remote activity.
 * Stable IDs are supplied by the operator and reused on every invocation.
 */
export async function provisionQaPilot(db: PrismaClient, provider: WebProviderPort, values: QaPilotInput) {
  const input = inputSchema.parse(values);
  if (!await provider.ready()) throw new AppError(503, "QA_PROVIDER_NOT_READY");
  const result = await db.$transaction(async tx => {
    // Serialize concurrent invocations for the existing administrator.
    await tx.$queryRaw`SELECT id FROM User WHERE id=${input.ownerUserId} FOR UPDATE`;
    const owner = await tx.user.findFirst({ where: { id: input.ownerUserId, status: "ACTIVE" }, include: { memberships: { where: { status: "ACTIVE", organization: { status: "ACTIVE" }, role: { code: "OWNER" } }, include: { permissionOverrides: { include: { permission: true } } } } } });
    if (!owner || !owner.memberships.some(m => !m.permissionOverrides.some(p => p.effect === "REVOKE" && p.permission.code === "providers.manage"))) throw new AppError(403, "QA_OWNER_NOT_AUTHORIZED");
    const roles = await tx.role.findMany({ where: { code: { in: ["OWNER", "SUPERVISOR", "AGENT"] } }, include: { permissions: { include: { permission: true } } } });
    const permissions = Object.fromEntries(roles.map(r => [r.code, r.permissions.map(p => p.permission.code).sort()]));
    const role = roles.find(r => r.code === "OWNER");
    if (!role || roles.length !== 3 || !permissions.OWNER?.includes("providers.manage") || !permissions.SUPERVISOR?.includes("conversations.supervise") || !permissions.AGENT?.includes("messages.send") || permissions.SUPERVISOR.includes("providers.manage") || permissions.AGENT.includes("providers.manage")) throw new AppError(409, "QA_RBAC_NOT_READY");
    let organization = await tx.organization.findUnique({ where: { id: input.organizationId } });
    if (organization && (organization.name !== "WappHub QA" || organization.status !== "ACTIVE")) throw new AppError(409, "QA_ORGANIZATION_CONFLICT");
    if (!organization && await tx.organization.count({ where: { name: "WappHub QA" } })) throw new AppError(409, "QA_ORGANIZATION_CONFLICT");
    const created = !organization;
    if (!organization) organization = await tx.organization.create({ data: { id: input.organizationId, name: "WappHub QA", status: "ACTIVE" } });
    const prior = await tx.membership.findUnique({ where: { userId_organizationId: { userId: owner.id, organizationId: organization.id } } });
    if (prior && (prior.roleId !== role.id || prior.status !== "ACTIVE")) throw new AppError(409, "QA_MEMBERSHIP_CONFLICT");
    const member = prior ?? await tx.membership.create({ data: { userId: owner.id, organizationId: organization.id, roleId: role.id, status: "ACTIVE" } });
    const channel = await tx.channel.upsert({ where: { organizationId_provider: { organizationId: organization.id, provider: "WHATSAPP_WEB" } }, create: { id: input.connectionId, organizationId: organization.id, provider: "WHATSAPP_WEB", status: "DISABLED" }, update: {} });
    if (channel.id !== input.connectionId) throw new AppError(409, "QA_CHANNEL_CONFLICT");
    await tx.providerConnection.upsert({ where: { organizationId_channelId: { organizationId: organization.id, channelId: channel.id } }, create: { organizationId: organization.id, channelId: channel.id, outboundEnabled: false, mediaEnabled: false }, update: {} });
    if (created || !prior) await tx.auditEvent.create({ data: { organizationId: organization.id, actorUserId: owner.id, action: "QA_PILOT_PROVISIONED", details: { channelId: channel.id, purpose: "MANUAL_WHATSAPP_TEXT_PILOT", pendingRoles: ["SUPERVISOR", "AGENT"] } } });
    return { organizationId: organization.id, name: organization.name, channelId: channel.id, membershipId: member.id, permissions, created };
  });
  const scope = { organizationId: result.organizationId, connectionId: result.channelId };
  // Existing signed PUT only creates an encrypted idle record. It never calls
  // connect/recover/prepare_link/QR/recipient/history/send. No old scope is used.
  const view = await provider.create(scope);
  if (result.created && (view.state !== "DISCONNECTED" || view.sync?.activeTransport || view.sync?.lifecycle?.linked || view.attempts !== 0 || view.history)) throw new AppError(409, "QA_SESSION_NOT_EMPTY");
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM Organization WHERE id=${scope.organizationId} FOR UPDATE`;
    if (!await tx.auditEvent.count({ where: { organizationId: scope.organizationId, actorUserId: input.ownerUserId, action: "QA_PROVIDER_IDLE_PREPARED" } })) await tx.auditEvent.create({ data: { organizationId: scope.organizationId, actorUserId: input.ownerUserId, action: "QA_PROVIDER_IDLE_PREPARED", details: { channelId: scope.connectionId, remoteActivityAuthorized: false } } });
  });
  return { ...result, providerState: view.state, pairingEligible: view.sync?.lifecycle?.pairingEligible === true, pendingRoles: ["SUPERVISOR", "AGENT"] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = new PrismaClient({ log: [] });
  try {
    const provider = await configuredWebProvider(loadConfig());
    if (!provider) throw new AppError(503, "PROVIDER_NOT_ENABLED");
    console.log(JSON.stringify(await provisionQaPilot(db, provider, { ownerUserId: process.env.QA_OWNER_USER_ID!, organizationId: process.env.QA_ORGANIZATION_ID!, connectionId: process.env.QA_CONNECTION_ID! })));
  } catch (error) { console.error(JSON.stringify({ error: error instanceof AppError ? error.code : "QA_PROVISION_FAILED" })); process.exitCode = 1; }
  finally { await db.$disconnect(); }
}
