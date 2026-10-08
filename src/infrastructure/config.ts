import { z } from "zod";
import { isIP } from "node:net";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().startsWith("mysql://"),
  REDIS_URL: z.string().url(),
  WEB_ORIGINS: z.string().min(1),
  CLOUDFLARED_TRUSTED_IPS: z.string().default(""),
  ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
  ENCRYPTION_KEY_VERSION: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .default("1"),
  SESSION_ABSOLUTE_SECONDS: z.coerce.number().int().min(60).default(43200),
  SESSION_IDLE_SECONDS: z.coerce.number().int().min(60).default(1800),
});
export function loadConfig(env = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) throw new Error("Invalid environment configuration");
  const origins = result.data.WEB_ORIGINS.split(",").map((s) => s.trim());
  if (
    origins.some((s) => {
      try {
        const u = new URL(s);
        return (
          u.origin !== s ||
          !["http:", "https:"].includes(u.protocol) ||
          (result.data.NODE_ENV === "production" && u.protocol !== "https:")
        );
      } catch {
        return true;
      }
    })
  )
    throw new Error("Invalid WEB_ORIGINS");
  const trustedCloudflaredIPs = result.data.CLOUDFLARED_TRUSTED_IPS.split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  if (trustedCloudflaredIPs.some((address) => !isIP(address)))
    throw new Error("Invalid trusted connector configuration");
  return { ...result.data, origins, trustedCloudflaredIPs };
}
export type Config = ReturnType<typeof loadConfig>;
