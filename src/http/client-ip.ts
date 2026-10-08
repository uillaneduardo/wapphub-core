import { isIP } from "node:net";
import type { FastifyRequest } from "fastify";

function normalizeIP(address: string) {
  const normalized = address.toLowerCase();
  const ipv4 = normalized.startsWith("::ffff:") ? normalized.slice(7) : "";
  return isIP(ipv4) === 4 ? ipv4 : normalized;
}

/** Forwarded visitor addresses affect only rate limiting, never authorization. */
export function loginRateLimitKey(
  request: FastifyRequest,
  trustedConnectors: string[],
) {
  const peer = request.raw.socket.remoteAddress;
  const visitor = request.headers["cf-connecting-ip"];
  if (
    peer &&
    trustedConnectors.some(
      (address) => normalizeIP(address) === normalizeIP(peer),
    ) &&
    typeof visitor === "string" &&
    isIP(visitor)
  ) {
    return `cloudflare:${normalizeIP(visitor)}`;
  }
  // Missing/invalid headers and all untrusted peers retain a shared peer budget.
  return request.ip;
}
