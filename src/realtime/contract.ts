/** Reserved envelope for M1. M0 emits no operational events. */
export type TenantEvent<TType extends string, TPayload> = {
  version: 1;
  eventId: string;
  organizationId: string;
  type: TType;
  entityId: string;
  occurredAt: string;
  payload: TPayload;
};
export type TenantScope = {
  organizationId: string;
  userId: string;
  membershipId: string;
};
