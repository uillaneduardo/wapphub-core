import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { InternalAuth } from "../src/auth.js";
import { EventJournal } from "../src/events.js";
import { createHttp } from "../src/http.js";
import { Sessions } from "../src/sessions.js";
import { Vault } from "../src/vault.js";
import type { TransportCallbacks, TransportFactory } from "../src/transport.js";

export async function fixture(t: TestContext, enabled = true) {
  const directory = await mkdtemp(join(tmpdir(), "wapphub-provider-test-"));
  const key = randomBytes(32), internalKey = randomBytes(32);
  const vault = new Vault(join(directory, "sessions"), key); await vault.initialize();
  let now = Date.now();
  const journal = new EventJournal(vault, () => now);
  const callbacks: TransportCallbacks[] = [];
  let starts = 0, closes = 0, logouts = 0;
  const factory: TransportFactory = async (_scope, handlers) => {
    starts++; callbacks.push(handlers);
    return { close: () => { closes++; }, logout: async () => { logouts++; } };
  };
  const timers: { run: () => void; delay: number; canceled: boolean }[] = [];
  const schedule = (callback: () => void, delay: number) => {
    const timer = { run: callback, delay, canceled: false }; timers.push(timer);
    return () => { timer.canceled = true; };
  };
  const logs: string[] = [];
  const sessions = new Sessions(vault, journal, factory, enabled, schedule, () => now, (code) => logs.push(code));
  const auth = new InternalAuth(internalKey, join(directory, "nonces"), () => now); await auth.initialize();
  const app = createHttp(sessions, journal, auth, (code) => logs.push(code));
  const scope = { organizationId: randomUUID(), connectionId: randomUUID() };
  const other = { organizationId: randomUUID(), connectionId: scope.connectionId };
  const path = `/internal/v1/organizations/${scope.organizationId}/connections/${scope.connectionId}`;
  t.after(async () => { await sessions.shutdown(); await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, key, internalKey, vault, journal, sessions, auth, app, scope, other, path, callbacks, factory, timers, logs,
    advance: (milliseconds: number) => { now += milliseconds; }, now: () => now,
    stats: () => ({ starts, closes, logouts }),
  };
}
