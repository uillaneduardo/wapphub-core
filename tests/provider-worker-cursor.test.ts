import { test } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import type { Chat } from "../src/application/chat.js";
import type { WebProviderPort } from "../src/integrations/web-provider-client.js";
import { WebProviderWorker } from "../src/application/web-provider-worker.js";

test("worker wraps an exhausted connection cursor without skipping a polling interval", async () => {
 const scopes = [{ organizationId: "tenant-a", channelId: "channel-a" }, { organizationId: "tenant-b", channelId: "channel-b" }];
 const db = { providerConnection: { findMany: async (query: { cursor?: unknown }) => query.cursor ? [] : scopes } };
 const worker = new WebProviderWorker(db as unknown as PrismaClient, {} as Chat, {} as WebProviderPort);
 const calls: { organizationId: string; connectionId: string }[] = [];
 worker.runConnection = async scope => { calls.push(scope); };
 for (let i = 0; i < 4; i++) {
  const before = calls.length;
  await worker.tick();
  assert.deepEqual(calls.slice(before), scopes.map(s => ({ organizationId: s.organizationId, connectionId: s.channelId })));
 }
});
