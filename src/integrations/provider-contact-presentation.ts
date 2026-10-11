/** Adapter boundary for legacy identities. Domain and Chat consume friendly,
 * provider-neutral presentation; external identifiers stay untouched internally. */
export type PresentationIdentity = { externalId?: string; channel: { provider: string } };
const phoneFromWeb = (value: string): string | null => {
 const raw = value.replace(/^web:[a-f0-9-]{36}:/i, '');
 const match = /^([1-9][0-9]{7,14})@s\.whatsapp\.net$/.exec(raw);
 return match ? `+${match[1]}` : null;
};
const formatPhone = (phone: string): string => {
 const br = /^\+55([0-9]{2})([0-9]{4,5})([0-9]{4})$/.exec(phone);
 return br ? `+55 (${br[1]}) ${br[2]}-${br[3]}` : phone;
};
export function externalContactPresentation(primary: string, identities: PresentationIdentity[] = []) {
 const web = identities.filter((x) => x.channel.provider === 'WHATSAPP_WEB');
 const legacyWeb = /^web:[a-f0-9-]{36}:/i.test(primary);
 const technical = /@(s\.whatsapp\.net|lid)$/.test(primary) || legacyWeb || /^demo:/i.test(primary);
 const knownPhones = new Set(web.flatMap((x) => x.externalId && phoneFromWeb(x.externalId) ? [phoneFromWeb(x.externalId)!] : []));
 const primaryPhone = web.length || legacyWeb ? phoneFromWeb(primary) : null;
 const phone = primaryPhone ?? (knownPhones.size === 1 ? [...knownPhones][0]! : null);
 return { external: web.length > 0 || legacyWeb || technical, phone: phone ? formatPhone(phone) : null, identifier: technical ? phone ? formatPhone(phone) : null : primary };
}

export const trustedContactName = (value: string | null | undefined): string | null => {
 const name = value?.trim();
 return name && !/^(?:web:|demo:)|@(s\.whatsapp\.net|lid|g\.us)$/.test(name) ? name : null;
};
