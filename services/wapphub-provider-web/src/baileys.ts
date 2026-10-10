import { createHash } from "node:crypto";
import makeWASocket, { BufferJSON, initAuthCreds, proto, type AuthenticationState, type SignalDataTypeMap } from "baileys";
import pino from "pino";
import type { TransportFactory } from "./transport.js";
import { Vault, type Scope } from "./vault.js";

const signalId = (type: string, id: string) => createHash("sha256").update(JSON.stringify([type, id])).digest("hex");
/** Auth persistence is independent of SDK logging and never uses plaintext files. */
export async function encryptedAuth(vault: Vault, scope: Scope, failure: () => void = () => undefined) {
    let closed = false;
    let revoked = false;
    const existing = vault.get(scope)?.auth;
    const creds: AuthenticationState["creds"] = existing ? JSON.parse(existing, BufferJSON.reviver) : initAuthCreds();
    const saveCreds = async () => {
      if (closed) return;
      const serialized = JSON.stringify(creds, BufferJSON.replacer);
      await vault.update(scope, (record) => { if (!revoked) record.auth = serialized; });
    };
    await saveCreds(); // credentials exist durably before any network activity
    const keys: AuthenticationState["keys"] = {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const result = Object.create(null) as { [id: string]: SignalDataTypeMap[T] };
        const record = vault.get(scope);
        for (const id of ids) {
          const stored = record?.keys[signalId(type, id)];
          if (!stored) continue;
          let value = JSON.parse(stored, BufferJSON.reviver);
          if (type === "app-state-sync-key") value = proto.Message.AppStateSyncKeyData.fromObject(value);
          result[id] = value;
        }
        return result;
      },
      set: async (data) => {
        if (closed) return;
        const updates = Object.entries(data).flatMap(([type, entries]) => Object.entries(entries ?? {}).map(([id, value]) => ({ key: signalId(type, id), value: value == null ? undefined : JSON.stringify(value, BufferJSON.replacer) })));
        try {
          await vault.update(scope, (record) => {
            if (revoked) return;
            for (const { key, value } of updates) {
              if (value === undefined) delete record.keys[key]; else record.keys[key] = value;
            }
          });
        } catch (error) { failure(); throw error; }
      },
    };
    return { state: { creds, keys }, saveCreds, disable: (revoke = false) => { closed = true; revoked ||= revoke; }, isDisabled: () => closed };
}
type SocketCreator = (options: Parameters<typeof makeWASocket>[0]) => Pick<ReturnType<typeof makeWASocket>, "ev" | "end" | "logout">;
export function baileysFactory(vault: Vault, createSocket: SocketCreator = makeWASocket): TransportFactory {
  return async (scope, callbacks) => {
    const auth = await encryptedAuth(vault, scope, callbacks.failure);
    const socket = createSocket({
      auth: auth.state, logger: pino({ level: "silent" }),
      markOnlineOnConnect: false, syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      shouldIgnoreJid: (jid) => !jid.endsWith("@s.whatsapp.net") && !jid.endsWith("@lid"),
      connectTimeoutMs: 20_000, keepAliveIntervalMs: 30_000, qrTimeout: 60_000,
      emitOwnEvents: false, generateHighQualityLinkPreview: false,
    });
    socket.ev.on("creds.update", (update) => {
      if (auth.isDisabled()) return;
      Object.assign(auth.state.creds, update);
      void auth.saveCreds().catch(() => callbacks.failure());
    });
    socket.ev.on("connection.update", (update) => {
      const reason = update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
      callbacks.connection({ state: update.connection === "open" || update.connection === "close" ? update.connection : undefined, qr: update.qr, code: reason?.output?.statusCode });
    });
    socket.ev.on("messages.upsert", (update) => {
      // No history, placeholder resend, groups, status broadcasts or raw payloads.
      if (update.type !== "notify" || update.requestId) return;
      for (const message of update.messages) {
        const chatId = message.key.remoteJid;
        const id = message.key.id;
        const body = message.message?.conversation ?? message.message?.extendedTextMessage?.text;
        if (!id || !chatId || !body || (!chatId.endsWith("@s.whatsapp.net") && !chatId.endsWith("@lid"))) continue;
        const timestamp = Number(message.messageTimestamp);
        if (!Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp * 1000).getTime()) || body.length > 8000 || id.length > 160 || chatId.length > 120) continue;
        callbacks.text({ id, chatId, body, fromMe: message.key.fromMe === true, timestamp: timestamp * 1000 });
      }
    });
    socket.ev.on("messages.update", (updates) => {
      for (const { key, update } of updates) {
        if (!key.id || !key.fromMe) continue;
        const status = update.status;
        if (status === proto.WebMessageInfo.Status.SERVER_ACK) callbacks.receipt(key.id, "SENT");
        if (status === proto.WebMessageInfo.Status.DELIVERY_ACK) callbacks.receipt(key.id, "DELIVERED");
        if (status === proto.WebMessageInfo.Status.READ || status === proto.WebMessageInfo.Status.PLAYED) callbacks.receipt(key.id, "READ");
      }
    });
    return { close: () => { auth.disable(); void socket.end(new Error("CONTROLLED_SHUTDOWN")).catch(() => callbacks.failure()); }, logout: () => { auth.disable(true); return socket.logout(); } };
  };
}
