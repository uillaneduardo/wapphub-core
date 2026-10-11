import { createHash } from "node:crypto";
import makeWASocket, { BufferJSON, initAuthCreds, proto, processHistoryMessage, normalizeMessageContent, type AuthenticationState, type SignalDataTypeMap, type BaileysEventMap } from "baileys";
import pino from "pino";
import type { TransportFactory } from "./transport.js";
import { Vault, type Scope } from "./vault.js";
import { normalizeContact, normalizeConversation, directIdentity, diagnoseIdentity, diagnoseMessage, type NormalizationOutcome } from "./sync-normalization.js";
import { readBoundedHistory } from "./history.js";
import type { SyncObservation } from "../../../contracts/provider-internal.js";
import type { SyncItem } from "../../../contracts/provider.js";

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
export function baileysFactory(vault: Vault, createSocket: SocketCreator = makeWASocket, syncOptions: { enabled: boolean; historyEnabled: boolean; approvedScope?: string } = { enabled: false, historyEnabled: false }): TransportFactory {
  return async (scope, callbacks) => {
    const historyEnabled = syncOptions.historyEnabled && syncOptions.approvedScope === `${scope.organizationId}:${scope.connectionId}`;
    const auth = await encryptedAuth(vault, scope, callbacks.failure);
    const downloads = new AbortController(); let downloading = false, historyObserved = false;
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
      callbacks.connection({ state: update.connection === "open" || update.connection === "close" ? update.connection : undefined, qr: update.qr, code: reason?.output?.statusCode, ...(update.isNewLogin ? { authenticating: true } : {}) });
    });
    const submit = <T>(values: T[], normalize: (value: T) => NormalizationOutcome, historical: boolean, completed = false, source: SyncObservation["source"] = "MESSAGES_NOTIFY") => {
      if (auth.isDisabled() || !syncOptions.enabled || historical && !historyEnabled) return;
      const limit = historical ? 1000 : 250;
      const writes: (void | Promise<void>)[] = [];
      const observation: SyncObservation = { source, received: values.length, normalized: 0, ignored: 0, rejected: 0, failures: 0, reasons: {} };
      let items: SyncItem[] = [];
      for (const value of values.slice(0, limit)) {
        let outcome: NormalizationOutcome;
        try { outcome = normalize(value); } catch { outcome = { type: "failures", code: "NORMALIZATION_FAILED" }; }
        if (outcome.type === "normalized") { items.push(outcome.item); observation.normalized++; }
        else { observation[outcome.type]++; observation.reasons[outcome.code] = (observation.reasons[outcome.code] ?? 0) + 1; }
        if (items.length === 50) { writes.push(callbacks.sync?.(items, historical)); items = []; }
      }
      if (values.length > limit) { observation.rejected += values.length - limit; observation.reasons.STAGING_LIMIT = values.length - limit; }
      writes.push(callbacks.sync?.(items, historical, completed, observation.failures, values.length > limit, observation));
      return Promise.all(writes).then(() => undefined);
    };
    socket.ev.on("contacts.upsert", (values) => submit(values, (value) => diagnoseIdentity(value, () => normalizeContact(value)), false, false, "CONTACTS_UPSERT"));
    socket.ev.on("contacts.update", (values) => submit(values, (value) => diagnoseIdentity(value, () => normalizeContact(value)), false, false, "CONTACTS_UPDATE"));
    socket.ev.on("chats.upsert", (values) => submit(values, (value) => diagnoseIdentity(value, () => normalizeConversation(value)), false, false, "CHATS_UPSERT"));
    socket.ev.on("chats.update", (values) => submit(values, (value) => diagnoseIdentity(value, () => normalizeConversation(value)), false, false, "CHATS_UPDATE"));
    socket.ev.on("lid-mapping.update", ({ lid, pn }) => submit([{ id: pn, lid }], (value) => diagnoseIdentity(value, () => normalizeContact(value)), false, false, "IDENTITY_MAPPING"));
    const processHistory = async (data: BaileysEventMap["messaging-history.set"]) => {
      if (!historyEnabled) return;
      historyObserved = true;
      await submit(data.lidPnMappings ?? [], (value) => diagnoseIdentity({ id: value.pn, lid: value.lid }, () => normalizeContact({ id: value.pn, lid: value.lid })), true, false, "IDENTITY_MAPPING");
      await submit(data.contacts, (value) => diagnoseIdentity(value, () => normalizeContact(value)), true, false, "HISTORY_CONTACTS");
      await submit(data.chats, (value) => diagnoseIdentity(value, () => normalizeConversation(value)), true, false, "HISTORY_CHATS");
      await submit(data.messages, (value) => diagnoseMessage(scope, value), true, data.progress === 100, "HISTORY_MESSAGES");
    };
    socket.ev.on("messaging-history.set", (data) => { void processHistory(data).catch(() => callbacks.failure()); });
    socket.ev.on("messaging-history.status", (value) => {
      if (historyEnabled && historyObserved && !downloading && !auth.isDisabled()) callbacks.sync?.([], true, value.status === "complete" && value.explicit, value.explicit ? 0 : 1);
    });
    socket.ev.on("messages.upsert", (update) => {
      // No history, placeholder resend, groups, status broadcasts or raw payloads.
      if (auth.isDisabled() || update.requestId) return;
      if (syncOptions.enabled) {
        // RC14 authenticates self-only protocol messages. Keep SDK automatic
        // history off; our bounded reader accepts only self-origin notifications.
        for (const message of update.messages.slice(0, 250)) {
          const notification = normalizeMessageContent(message.message)?.protocolMessage?.historySyncNotification;
          if (!notification || !message.key.fromMe || !historyEnabled) continue;
          if (downloading) { callbacks.sync?.([], true, false, 1, true); continue; }
          downloading = true;
          const digest = createHash("sha256").update(notification.fileSha256 ?? notification.initialHistBootstrapInlinePayload ?? Buffer.alloc(0)).digest("hex");
          void vault.update(scope, (record) => {
            const imports = record.historyImports ??= { downloads: 0, decodedBytes: 0, seen: [] };
            if (imports.seen.includes(digest)) return false;
            if (imports.downloads >= 16 || imports.decodedBytes + 8 * 1024 * 1024 > 32 * 1024 * 1024) throw new Error("HISTORY_OPERATION_LIMIT");
            imports.downloads++; return true;
          }).then(async (admitted) => {
            if (!admitted || auth.isDisabled()) return;
            await callbacks.sync?.([], true, false);
            const { history, decodedBytes } = await readBoundedHistory(notification, downloads.signal);
            if (auth.isDisabled()) return;
            await processHistory({ ...processHistoryMessage(history), isLatest: false });
            if (auth.isDisabled()) return;
            await vault.update(scope, (record) => { record.historyImports!.decodedBytes += decodedBytes; record.historyImports!.seen.push(digest); });
          }).catch(() => { if (!auth.isDisabled()) callbacks.sync?.([], true, false, 1, true); }).finally(() => { downloading = false; });
        }
        const messages = update.messages.slice(0, update.type === "notify" ? 250 : 1000);
        if (update.type === "notify" || historyEnabled) submit(messages, (message) => diagnoseMessage(scope, message), update.type !== "notify", false, update.type === "notify" ? "MESSAGES_NOTIFY" : "MESSAGES_APPEND");
        else {
          // Small recent offline catch-up is continuous ingestion, not a full
          // historical import. Older append data awaits explicit authorization.
          const recent = messages.filter((message) => Number(message.messageTimestamp) * 1000 >= Date.now() - 5 * 60000);
          submit(recent, (message) => diagnoseMessage(scope, message), false, false, "MESSAGES_APPEND");
          if (recent.length < messages.length || update.messages.length > 1000) callbacks.sync?.([], false, false, 0, true);
        }
        return;
      }
      if (update.type !== "notify") return;
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
        const chatId = directIdentity(key.remoteJid);
        if (status === proto.WebMessageInfo.Status.SERVER_ACK) callbacks.receipt(key.id, "SENT", chatId);
        if (status === proto.WebMessageInfo.Status.DELIVERY_ACK) callbacks.receipt(key.id, "DELIVERED", chatId);
        if (status === proto.WebMessageInfo.Status.READ || status === proto.WebMessageInfo.Status.PLAYED) callbacks.receipt(key.id, "READ", chatId);
      }
    });
    return { close: () => { downloads.abort(); auth.disable(); void socket.end(new Error("CONTROLLED_SHUTDOWN")).catch(() => callbacks.failure()); }, logout: () => { downloads.abort(); auth.disable(true); return socket.logout(); } };
  };
}
