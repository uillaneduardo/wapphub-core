import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pino from "pino";
import { InternalAuth } from "./auth.js";
import { baileysFactory } from "./baileys.js";
import { EventJournal } from "./events.js";
import { createHttp } from "./http.js";
import { Sessions } from "./sessions.js";
import { Vault } from "./vault.js";

const logger = pino({ level: "info", base: undefined });
const log = (code: string, fields?: { source: string; stage: string; count: number }) => logger.info({ code, ...fields }); // never log SDK errors/request bodies/IDs
async function secret(path: string) {
  const value = (await readFile(path, "utf8")).trim();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("INVALID_SECRET");
  return Buffer.from(value, "hex");
}
async function start() {
  if (process.env.PROVIDER_WRITER_LOCK !== "held") throw new Error("WRITER_LOCK_REQUIRED");
  const directory = process.env.PROVIDER_DATA_DIR ?? "/data";
  const vault = new Vault(join(directory, "sessions"), await secret(process.env.SESSION_KEY_FILE ?? "/run/secrets/session_key"));
  await vault.initialize();
  const auth = new InternalAuth(await secret(process.env.INTERNAL_KEY_FILE ?? "/run/secrets/internal_key"), join(directory, "nonces"));
  await auth.initialize();
  const journal = new EventJournal(vault);
  const syncOptions = { enabled: process.env.PROVIDER_SYNC_ENABLED !== "false", historyEnabled: process.env.PROVIDER_HISTORY_ENABLED === "true", approvedScope: process.env.PROVIDER_HISTORY_APPROVED_SCOPE };
  const sessions = new Sessions(vault, journal, baileysFactory(vault, undefined, syncOptions), process.env.ALLOW_SESSION_CONNECT === "true", undefined, undefined, log, syncOptions);
  await sessions.recover();
  const app = createHttp(sessions, journal, auth, log);
  await app.listen({ host: "0.0.0.0", port: 3000 });
  log("SERVICE_READY");
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 15_000); deadline.unref();
    void sessions.shutdown().then(() => app.close()).then(() => { clearTimeout(deadline); log("SERVICE_STOPPED"); }).catch(() => { log("SHUTDOWN_FAILED"); process.exitCode = 1; });
  };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
void start().catch(() => { log("STARTUP_FAILED"); process.exitCode = 1; });
