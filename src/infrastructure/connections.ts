import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import type { Config } from "./config.js";
export function connections(config: Config) {
  const db = new PrismaClient({
    datasources: { db: { url: config.DATABASE_URL } },
    log: [],
    errorFormat: "minimal",
  });
  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
  });
  redis.on("error", () => {});
  return {
    db,
    redis,
    close: async () => {
      await Promise.all([
        db.$disconnect(),
        redis.quit().catch(() => redis.disconnect()),
      ]);
    },
  };
}
