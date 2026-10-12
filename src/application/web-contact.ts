import type { Prisma } from "@prisma/client";
import { AppError } from "../domain/errors.js";
/** Shared creation policy for legacy ingress, sync.batch and explicit opening.
 * Existing channel identities have already been resolved by the caller. Names
 * never participate in matching; legacy PN/LID identifiers remain reusable. */
export async function createWebContact(tx: Prisma.TransactionClient, scope: { organizationId: string; connectionId: string }, identity: { externalId: string; name?: string }) {
  const primaryIdentifier = `web:${scope.connectionId}:${identity.externalId}`;
  const existing = await tx.contact.findMany({ where: { organizationId: scope.organizationId, primaryIdentifier: { in: [primaryIdentifier, identity.externalId] } }, take: 2 });
  if (existing.length > 1) throw new AppError(409, "IDENTITY_MAPPING_CONFLICT");
  if (existing[0]) return existing[0];
  return tx.contact.upsert({ where: { organizationId_primaryIdentifier: { organizationId: scope.organizationId, primaryIdentifier } }, create: { organizationId: scope.organizationId, name: identity.name ?? "Contato", providerName: identity.name, primaryIdentifier }, update: {} });
}
