import { createHash } from "node:crypto";
import makeWASocket, { BufferJSON, initAuthCreds, proto, processHistoryMessage, normalizeMessageContent, type AuthenticationState, type SignalDataTypeMap, type BaileysEventMap } from "baileys";
import pino from "pino";
import type { TransportFactory, TransportCause, TransportDiagnostic } from "./transport.js";
import { ProviderMedia } from "./media.js";
import { ServiceError } from "./errors.js";
import { Vault, type Scope } from "./vault.js";
import { normalizeContact, normalizeConversation, directIdentity, diagnoseIdentity, diagnoseMessage, normalizeSyncMessage, type NormalizationOutcome } from "./sync-normalization.js";
import { HistoryImporter } from "./history-operation.js";
import { selectHistory, type HistoryPage } from "./history-selection.js";
import { readBoundedHistory } from "./history.js";
import type { SyncObservation } from "../../../contracts/provider-internal.js";
import type { SyncItem } from "../../../contracts/provider.js";

const signalId = (type: string, id: string) => createHash("sha256").update(JSON.stringify([type, id])).digest("hex");
/** Explicit deploy-time pin, never a network lookup or automatic SDK upgrade. */
export function pairingWebVersion(value?: string): [number, number, number] | undefined {
  if (!value) return undefined;
  if (!/^2,3000,[1-9][0-9]{0,9}$/.test(value)) throw new ServiceError("PROTOCOL_VERSION_CONFIGURATION_ERROR", 503);
  const revision = Number(value.split(",")[2]);
  if (revision > 0xffffffff) throw new ServiceError("PROTOCOL_VERSION_CONFIGURATION_ERROR", 503);
  return [2, 3000, revision];
}
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
type SocketCreator = (options: Parameters<typeof makeWASocket>[0]) => Pick<ReturnType<typeof makeWASocket>, "ev" | "end" | "logout"> & Partial<Pick<ReturnType<typeof makeWASocket>, "fetchMessageHistory" | "onWhatsApp" | "sendMessage" | "query" | "ws">>;
export function baileysFactory(vault: Vault, createSocket: SocketCreator = makeWASocket, syncOptions: { enabled: boolean; historyEnabled: boolean; initialHistoryEnabled?: boolean; approvedScope?: string; linkedRecoveryOnly?: boolean; historyExecutionEnabled?: boolean; scopedHistoryAuthorization?: boolean; mediaEnabled?: boolean; pairingWebVersion?: [number, number, number] } = { enabled: false, historyEnabled: false }): TransportFactory {
  return async (scope, callbacks, authorization) => {
    const pairingAllowed = () => {
      if (!authorization?.allowPairing) return false;
      const record = vault.get(scope);
      return !!record?.pairingAuthorization && record.pairingAuthorization.expiresAt > Date.now() && !record.invalidated && record.termination?.action !== "logout";
    };
    const media = new ProviderMedia(vault, syncOptions.mediaEnabled === true, code => callbacks.diagnostic?.(code));
    const historyEnabled = syncOptions.historyEnabled && syncOptions.approvedScope === `${scope.organizationId}:${scope.connectionId}`;
    if (syncOptions.linkedRecoveryOnly && !pairingAllowed()) {
      let linked = false;
      try { const existing = JSON.parse(vault.get(scope)?.auth ?? "null"); linked = typeof existing?.me?.id === "string" && existing.me.id.length > 0; } catch { /* no credential logging */ }
      if (!linked) throw new ServiceError("EXISTING_AUTH_REQUIRED", 403);
    }
    const auth = await encryptedAuth(vault, scope, callbacks.failure);
    callbacks.diagnostic?.("AUTH_READY");
    // The first QR pairing may deliver old chats. Process them through our bounded
    // pipeline; a linked session must never be re-paired to retrieve old history.
    const previousImport = vault.get(scope)?.historyImports;
    const nativeBootstrap = syncOptions.enabled && syncOptions.initialHistoryEnabled === true &&
      (!auth.state.creds.me?.id || previousImport?.initialPending === true);
    const capturingBootstrap = () => {
      const imports = vault.get(scope)?.historyImports;
      return nativeBootstrap && (imports?.initialPending === true || !!imports?.pending?.length);
    };
    if (nativeBootstrap && !previousImport?.initialPending) {
      await vault.update(scope, (record) => {
        const imports = record.historyImports ??= { downloads: 0, decodedBytes: 0, seen: [] };
        imports.initialPending = true;
      });
    }
    const downloads = new AbortController(); let downloading = false, historyObserved = false;
    // Never forward SDK objects, messages or serializers to a log sink. Only
    // exact installed-SDK stage labels produce our own bounded diagnostic code.
    const sdkStages: Record<string, TransportDiagnostic> = {
      "connected to WA": "HANDSHAKE_START",
      "not logged in, attempting registration...": "REGISTRATION_READY",
      "logging in...": "LOGIN_READY",
      "error in validating connection": "HANDSHAKE_FAILED",
      "pairing configured successfully, expect to restart the connection...": "PAIRING_ACCEPTED",
      "opened connection to WA": "AUTHENTICATED",
      "connection errored": "SDK_SOCKET_END",
      "connection closed": "SDK_SOCKET_END",
    };
    const sdkLogger = pino({ level: "info", hooks: { logMethod(args) {
      const label = args.at(-1);
      if (typeof label === "string" && Object.hasOwn(sdkStages, label)) callbacks.diagnostic?.(sdkStages[label]!);
      // Deliberately do not call the Pino output method, even for unknown logs.
    } } });
    const socket = createSocket({
      auth: auth.state, logger: sdkLogger,
      // Only new, explicitly authorized pairing uses the operational pin.
      // Existing authenticated transports retain the installed SDK settings.
      ...(pairingAllowed() && !auth.state.creds.me?.id && syncOptions.pairingWebVersion ? { version: syncOptions.pairingWebVersion } : {}),
      markOnlineOnConnect: false, syncFullHistory: nativeBootstrap && !auth.state.creds.me?.id,
      // Keep the SDK Web/Chrome identity used by the working QR flow. Desktop
      // + full history advertises DARWIN despite a WEB registration build.
      shouldSyncHistoryMessage: () => false,
      shouldIgnoreJid: (jid) => !jid.endsWith("@s.whatsapp.net") && !jid.endsWith("@lid"),
      connectTimeoutMs: 20_000, keepAliveIntervalMs: 30_000, qrTimeout: 60_000,
      emitOwnEvents: false, generateHighQualityLinkPreview: false,
    });
    callbacks.diagnostic?.("SOCKET_CREATED");
    socket.ws?.on("open", () => callbacks.diagnostic?.("WS_OPEN"));
    socket.ws?.once("frame", () => callbacks.diagnostic?.("HANDSHAKE_FRAME_RECEIVED"));
    socket.ws?.on("CB:iq,type:set,pair-device", () => callbacks.diagnostic?.("PAIRING_OFFER_RECEIVED"));
    socket.ws?.on("close", (code: number) => callbacks.diagnostic?.(code === 1006 ? "WS_CLOSED_ABNORMAL" : "WS_CLOSED"));
    socket.ws?.on("error", () => callbacks.diagnostic?.("WS_ERROR"));
    socket.ev.on("creds.update", (update) => {
      if (auth.isDisabled()) return;
      if (syncOptions.linkedRecoveryOnly && !pairingAllowed() && (Object.hasOwn(update, "me") && update.me?.id !== auth.state.creds.me?.id)) {
        auth.disable(); callbacks.connection({ state: "close", code: 401 }); return;
      }
      Object.assign(auth.state.creds, update);
      void auth.saveCreds().then(() => callbacks.diagnostic?.("AUTH_PERSISTED")).catch(() => callbacks.failure());
    });
    socket.ev.on("connection.update", (update) => {
      if (update.qr) callbacks.diagnostic?.("QR_RECEIVED");
      const reason = update.lastDisconnect?.error as { output?: { statusCode?: number }; message?: string; code?: string } | undefined;
      // Map known SDK observations only. Never publish exception messages,
      // handshake frames, URLs, IDs, QR, auth or Signal material.
      const cause: TransportCause | undefined = !reason ? undefined : reason.message === "Connection Terminated" ? "WS_CLOSED" : reason.message === "Connection Terminated by Server" ? "SERVER_CLOSED" : ["EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENETUNREACH"].includes(reason.code ?? "") ? "NETWORK_ERROR" : reason.message === "Connection Failure" ? "PROTOCOL_FAILURE" : "TRANSPORT_ERROR";
      callbacks.connection({ state: update.connection === "open" || update.connection === "close" ? update.connection : undefined, qr: update.qr, code: reason?.output?.statusCode, ...(update.isNewLogin ? { authenticating: true } : {}), ...(cause ? { cause } : {}) });
    });
    const importer = new HistoryImporter(vault, scope, async (count, anchor) => {
      if (!socket.fetchMessageHistory) throw new ServiceError("HISTORY_TRANSPORT_UNAVAILABLE", 409);
      return socket.fetchMessageHistory(count, { remoteJid: anchor.chatId, id: anchor.messageId, fromMe: anchor.fromMe }, anchor.timestamp);
    }, async (reference) => {
      const notification = JSON.parse(reference, BufferJSON.reviver) as proto.Message.IHistorySyncNotification;
      const op = vault.get(scope)?.historyOperation; if (!op) throw new ServiceError("HISTORY_OPERATION_MISMATCH", 409);
      const { history, decodedBytes } = await readBoundedHistory(notification, downloads.signal, op);
      if (history.syncType !== proto.HistorySync.HistorySyncType.ON_DEMAND) throw new ServiceError("HISTORY_RESPONSE_MISMATCH", 409);
      // The durable file receipt prevents replays from spending admission twice.
      await vault.update(scope, (record) => { const current = record.historyOperation; if (!current || current.id !== op.id || current.reference !== reference) throw new ServiceError("HISTORY_OPERATION_MISMATCH", 409); if (current.decodedReference !== createHash("sha256").update(reference).digest("hex")) { current.decodedBytes = (current.decodedBytes ?? 0) + decodedBytes; current.decodedReference = createHash("sha256").update(reference).digest("hex"); } if ((current.decodedBytes ?? 0) > 32 * 1024 * 1024) throw new ServiceError("HISTORY_BYTE_LIMIT", 413); });
      return selectHistory(scope, history, op);
    }, syncOptions.historyExecutionEnabled === true && (syncOptions.scopedHistoryAuthorization === true || syncOptions.approvedScope === `${scope.organizationId}:${scope.connectionId}`), Date.now, syncOptions.scopedHistoryAuthorization === true);
    await importer.recover();
    const submit = async <T>(values: T[], normalize: (value: T) => NormalizationOutcome | Promise<NormalizationOutcome>, historical: boolean, completed = false, source: SyncObservation["source"] = "MESSAGES_NOTIFY") => {
      if (auth.isDisabled() || !syncOptions.enabled || historical && !historyEnabled && !capturingBootstrap()) return;
      const limit = historical ? 1000 : 250;
      const writes: (void | Promise<void>)[] = [];
      const observation: SyncObservation = { source, received: values.length, normalized: 0, ignored: 0, rejected: 0, failures: 0, reasons: {} };
      let items: SyncItem[] = [];
      for (const value of values.slice(0, limit)) {
        let outcome: NormalizationOutcome;
        try { const normalized = normalize(value); outcome = normalized instanceof Promise ? await normalized : normalized; } catch { outcome = { type: "failures", code: "NORMALIZATION_FAILED" }; }
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
    const diagnoseAndRetain = (value: Parameters<typeof diagnoseMessage>[1]) => {
      const outcome = diagnoseMessage(scope, value);
      if (outcome.type === "normalized" && outcome.item.kind === "message" && outcome.item.message.content.type !== "TEXT") return media.retain(scope, value).then(() => outcome);
      return outcome;
    };
    const processHistory = async (data: BaileysEventMap["messaging-history.set"]) => {
      if (importer.accepting) {
        if (importer.current?.authorization) return; // controlled operations use correlated self-only notifications
        const op = importer.current!;
        const items = [...data.contacts.slice(0, 500).map(normalizeContact), ...data.chats.slice(0, 500).map(normalizeConversation), ...data.messages.slice(0, 1000).map((m) => normalizeSyncMessage(scope, m))].filter((x): x is SyncItem => !!x);
        await importer.receive(items.filter((x) => x.kind !== "message" || Date.parse(x.occurredAt) >= Date.parse(op.from) && Date.parse(x.occurredAt) <= Date.parse(op.to))); return;
      }
      if (!historyEnabled && !capturingBootstrap()) return;
      historyObserved = true;
      await submit(data.lidPnMappings ?? [], (value) => diagnoseIdentity({ id: value.pn, lid: value.lid }, () => normalizeContact({ id: value.pn, lid: value.lid })), true, false, "IDENTITY_MAPPING");
      await submit(data.contacts, (value) => diagnoseIdentity(value, () => normalizeContact(value)), true, false, "HISTORY_CONTACTS");
      await submit(data.chats, (value) => diagnoseIdentity(value, () => normalizeConversation(value)), true, false, "HISTORY_CHATS");
      await submit(data.messages, diagnoseAndRetain, true, data.progress === 100, "HISTORY_MESSAGES");
    };
    socket.ev.on("messaging-history.set", (data) => { void processHistory(data).catch(() => importer.current ? importer.fail("HISTORY_PROCESSING_FAILED") : callbacks.failure()); });
    socket.ev.on("messaging-history.status", (value) => {
      if (historyEnabled && historyObserved && !downloading && !auth.isDisabled()) callbacks.sync?.([], true, value.status === "complete" && value.explicit, value.explicit ? 0 : 1);
    });
    // Bootstrap references are persisted in the existing encrypted vault before
    // download. This prevents dropping later chunks while one is in flight.
    let bootstrapTimer: ReturnType<typeof setTimeout> | undefined;
    const drainBootstrap = async () => {
      if (downloading || auth.isDisabled()) return;
      downloading = true;
      try {
        while (!auth.isDisabled()) {
          const entry = vault.get(scope)?.historyImports?.pending?.[0];
          if (!entry || (entry.nextAttemptAt ?? 0) > Date.now() || process.memoryUsage().rss >= 384 * 1024 * 1024) break;
          try {
            const notification = JSON.parse(entry.reference, BufferJSON.reviver) as proto.Message.IHistorySyncNotification;
            const page: HistoryPage = { cursor: entry.cursor ?? 0 };
            const epoch = Date.now(), window = { from: entry.from ?? new Date(epoch - 30 * 86400000).toISOString(), to: entry.to ?? new Date(epoch).toISOString() };
            if (!entry.from) await vault.update(scope, record => { const pending = record.historyImports!.pending![0]!; pending.from = window.from; pending.to = window.to; });
            const { history, decodedBytes } = await readBoundedHistory(notification, downloads.signal, {
              from: window.from,
              to: window.to,
            }, page, { files: vault.privateFiles(), scope, id: entry.digest });
            if (notification.syncType != null && history.syncType !== notification.syncType) throw new ServiceError("HISTORY_RESPONSE_MISMATCH", 409);
            if (!entry.decoded && (vault.get(scope)?.historyImports?.decodedBytes ?? 0) + decodedBytes > 32 * 1024 * 1024) throw new ServiceError("HISTORY_BYTE_LIMIT", 413);
            const items = selectHistory(scope, history, { id: entry.digest, ...window, limits: { contacts: 500, conversations: 500, messages: 1000 }, anchors: [] });
            for (const conversation of history.conversations ?? []) for (const entry of conversation.messages ?? []) if (entry.message?.key) await media.retain(scope, { ...entry.message, key: entry.message.key });
            if (callbacks.bootstrapPage) await callbacks.bootstrapPage(items, entry.digest, page.next ?? page.cursor);
            else await processHistory({ ...processHistoryMessage(history), isLatest: false });
            await vault.update(scope, (record) => {
              const imports = record.historyImports!;
              if (imports.pending?.[0]?.digest !== entry.digest) throw new ServiceError("HISTORY_OPERATION_MISMATCH", 409);
              imports.pending[0]!.cursor = page.next ?? page.cursor;
              if (!entry.decoded) { imports.decodedBytes += decodedBytes; imports.pending[0]!.decoded = true; }
              if (!page.done) return;
              imports.pending.shift();
              imports.seen.push(entry.digest);
              if (imports.seen.length > 16) imports.seen.shift();
              if (notification.syncType === proto.HistorySync.HistorySyncType.RECENT && notification.progress === 100) { imports.initialPending = false; if (record.sync) record.sync.complete = true; }
            });
            // One local page per interval gives live ingestion/Worker time to drain.
            if (!page.done) break;
          } catch (error) {
            if (auth.isDisabled()) break;
            // Permanent invalid history is marked partial and does not block later chunks.
            // Transient failures retain the reference for controlled recovery.
            if (error instanceof ServiceError && ["HISTORY_BYTE_LIMIT", "HISTORY_OBJECT_LIMIT", "HISTORY_RESPONSE_MISMATCH"].includes(error.code)) {
              await vault.update(scope, (record) => { record.historyImports?.pending?.shift(); });
            }
            await vault.update(scope, record => { const pending = record.historyImports?.pending?.[0]; if (pending?.digest === entry.digest) { pending.failures = (pending.failures ?? 0) + 1; pending.nextAttemptAt = Date.now() + Math.min(300000, 30000 * 2 ** pending.failures); } });
            await callbacks.sync?.([], true, false, 1, true);
            break;
          }
        }
      } finally {
        downloading = false;
        if (!auth.isDisabled() && vault.get(scope)?.historyImports?.pending?.length) {
          const entry = vault.get(scope)!.historyImports!.pending![0]!;
          if ((entry.failures ?? 0) < 5) {
            bootstrapTimer = setTimeout(() => { void drainBootstrap(); }, Math.max(30000, (entry.nextAttemptAt ?? 0) - Date.now())); bootstrapTimer.unref();
          }
        }
      }
    };
    if (nativeBootstrap && vault.get(scope)?.historyImports?.pending?.length) void drainBootstrap();
    socket.ev.on("messages.upsert", (update) => {
      // No history, placeholder resend, groups, status broadcasts or raw payloads.
      if (auth.isDisabled() || update.requestId) return;
      if (syncOptions.enabled) {
        // RC14 authenticates self-only protocol messages. Keep SDK automatic
        // history off; our bounded reader accepts only self-origin notifications.
        for (const message of update.messages.slice(0, 250)) {
          const notification = normalizeMessageContent(message.message)?.protocolMessage?.historySyncNotification;
          if (notification && message.key.fromMe && importer.accepting) {
            if (!notification.peerDataRequestSessionId || notification.peerDataRequestSessionId !== importer.current?.requestId) continue;
            // Persist only the bounded encrypted download reference, never a raw message.
            const minimal = { initialHistBootstrapInlinePayload: notification.initialHistBootstrapInlinePayload, fileLength: notification.fileLength, directPath: notification.directPath, mediaKey: notification.mediaKey, fileSha256: notification.fileSha256 };
            const reference = JSON.stringify(minimal, BufferJSON.replacer);
            if (Buffer.byteLength(reference) > 2 * 1024 * 1024) { void importer.fail("HISTORY_BYTE_LIMIT"); continue; }
            void importer.receive([], reference).catch(() => importer.fail("HISTORY_BACKPRESSURE")); continue;
          }
          if (!notification || !message.key.fromMe || !historyEnabled && !nativeBootstrap) continue;
          // ON_DEMAND must be correlated to an authorized operation above.
          if (nativeBootstrap && !historyEnabled && ![
            proto.HistorySync.HistorySyncType.INITIAL_BOOTSTRAP,
            proto.HistorySync.HistorySyncType.RECENT,
            proto.HistorySync.HistorySyncType.FULL,
            proto.HistorySync.HistorySyncType.PUSH_NAME,
            proto.HistorySync.HistorySyncType.NON_BLOCKING_DATA,
            proto.HistorySync.HistorySyncType.INITIAL_STATUS_V3,
          ].includes(notification.syncType as proto.HistorySync.HistorySyncType)) continue;
          const minimal = { syncType: notification.syncType, progress: notification.progress,
            initialHistBootstrapInlinePayload: notification.initialHistBootstrapInlinePayload,
            fileLength: notification.fileLength, directPath: notification.directPath,
            mediaKey: notification.mediaKey, fileSha256: notification.fileSha256 };
          const reference = JSON.stringify(minimal, BufferJSON.replacer);
          const digest = createHash("sha256").update(notification.fileSha256 ?? notification.initialHistBootstrapInlinePayload ?? Buffer.from(reference)).digest("hex");
          void vault.update(scope, (record) => {
            const imports = record.historyImports ??= { downloads: 0, decodedBytes: 0, seen: [] };
            const pending = imports.pending ??= [];
            if (imports.seen.includes(digest) || pending.some((entry) => entry.digest === digest)) return;
            if (imports.downloads >= 16 || pending.length >= 16 ||
                Buffer.byteLength(reference) > 2 * 1024 * 1024 ||
                pending.reduce((sum, entry) => sum + Buffer.byteLength(entry.reference), 0) + Buffer.byteLength(reference) > 4 * 1024 * 1024)
              throw new ServiceError("HISTORY_BYTE_LIMIT", 413);
            pending.push({ digest, reference });
            imports.downloads++;
          }).then(() => { void drainBootstrap(); }).catch(() => {
            if (!auth.isDisabled()) void callbacks.sync?.([], true, false, 1, true);
          });
        }
        const messages = update.messages.slice(0, update.type === "notify" ? 250 : 1000);
        if (update.type === "notify" || historyEnabled || capturingBootstrap()) submit(messages, diagnoseAndRetain, update.type !== "notify", false, update.type === "notify" ? "MESSAGES_NOTIFY" : "MESSAGES_APPEND");
        else {
          // Small recent offline catch-up is continuous ingestion, not a full
          // historical import. Older append data awaits explicit authorization.
          const recent = messages.filter((message) => Number(message.messageTimestamp) * 1000 >= Date.now() - 5 * 60000);
          submit(recent, diagnoseAndRetain, false, false, "MESSAGES_APPEND");
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
    return { resolveRecipient: async (phone) => {
      if (!socket.onWhatsApp) throw new ServiceError("OUTBOUND_UNAVAILABLE", 409);
      try {
        const result = await socket.onWhatsApp(phone);
        const found = result?.find(x => x.exists && directIdentity(x.jid));
        if (found) return { state: "VALID" as const, jid: found.jid };
        return { state: result?.some(x => x.exists === false) ? "NOT_FOUND" as const : "UNKNOWN" as const };
      } catch { return { state: "UNKNOWN" as const }; }
    }, send: async (intent) => {
      if (auth.isDisabled()) throw new ServiceError("OUTBOUND_UNAVAILABLE", 409);
      if (!socket.sendMessage) throw new ServiceError("OUTBOUND_UNAVAILABLE", 409);
      if (!intent.media) await socket.sendMessage(intent.destination, { text: intent.body }, { messageId: intent.providerMessageId });
      else {
        const { record, stream } = await media.read(scope, intent.media.mediaId);
        if (record.sha256 !== intent.media.sha256 || record.size !== intent.media.size || record.type !== intent.media.type) { stream.destroy(); throw new ServiceError("MEDIA_INTENT_MISMATCH", 409); }
        const content = record.type === "DOCUMENT" ? { document: { stream }, mimetype: record.mimeType, fileName: record.fileName, caption: intent.body } : record.type === "IMAGE" ? { image: { stream }, mimetype: record.mimeType, caption: intent.body, jpegThumbnail: "" } : record.type === "VIDEO" ? { video: { stream }, mimetype: record.mimeType, caption: intent.body, jpegThumbnail: "" } : { audio: { stream }, mimetype: record.mimeType, ptt: record.type === "VOICE", seconds: record.seconds ?? 0, waveform: Buffer.alloc(0) };
        try { await socket.sendMessage(intent.destination, content, { messageId: intent.providerMessageId }); } finally { stream.destroy(); }
      }
    }, history: (control) => importer.command(control), close: () => { callbacks.diagnostic?.("LOCAL_SOCKET_CLOSE"); clearTimeout(bootstrapTimer); importer.close(); downloads.abort(); auth.disable(); void socket.end(new Error("CONTROLLED_SHUTDOWN")).catch(() => callbacks.failure()); }, logout: async () => {
      downloads.abort(); auth.disable(true);
      // RC14 logout() waits only for sendNode, not an acknowledgement. A query
      // of the same documented SDK IQ waits for a correlated server response.
      const jid = auth.state.creds.me?.id;
      if (!jid || !socket.query) { await socket.logout(); return "UNCONFIRMED"; }
      const response = await socket.query({ tag: "iq", attrs: { to: "s.whatsapp.net", type: "set", xmlns: "md" }, content: [{ tag: "remove-companion-device", attrs: { jid, reason: "user_initiated" } }] }, 5000);
      return response?.tag === "iq" && response.attrs.type === "result" ? "CONFIRMED" : "UNCONFIRMED";
    } };
  };
}
