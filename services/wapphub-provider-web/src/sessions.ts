import { createHash } from "node:crypto";
import { normalizeText, ProviderContractError } from "../../../contracts/provider.js";
import { appendRecordEvent, envelope, EventJournal } from "./events.js";
import { ServiceError } from "./errors.js";
import { Serial } from "./serial.js";
import type { ConnectionUpdate, Transport, TransportFactory } from "./transport.js";
import { Vault, type Scope, type State } from "./vault.js";

type Actor = { serial: Serial; generation: number; socket?: Transport; cancel?: () => void; deadline?: () => void; qr?: { value: string; expiresAt: number; revision: number } };
type Scheduler = (callback: () => void, delay: number) => () => void;
const defaultSchedule: Scheduler = (callback, delay) => { const timer = setTimeout(callback, delay); timer.unref(); return () => clearTimeout(timer); };
const scopeKey = (scope: Scope) => `${scope.organizationId}:${scope.connectionId}`;

export class Sessions {
  private readonly actors = new Map<string, Actor>();
  private stopping = false;
  private failedStorage = false;
  constructor(
    private readonly vault: Vault, private readonly journal: EventJournal,
    private readonly factory: TransportFactory, readonly connectEnabled: boolean,
    private readonly schedule: Scheduler = defaultSchedule,
    private readonly now = Date.now,
    private readonly log: (code: string) => void = () => undefined,
    private readonly syncOptions: { enabled: boolean; historyEnabled: boolean; approvedScope?: string } = { enabled: false, historyEnabled: false },
  ) {}
  private historyEnabled(scope: Scope) { return this.syncOptions.historyEnabled && this.syncOptions.approvedScope === scopeKey(scope); }
  private actor(scope: Scope) {
    const key = scopeKey(scope);
    let actor = this.actors.get(key);
    if (!actor) { actor = { serial: new Serial(), generation: 0 }; this.actors.set(key, actor); }
    return actor;
  }
  view(scope: Scope) {
    const record = this.vault.get(scope);
    if (!record) throw new ServiceError("SESSION_NOT_FOUND", 404);
    const sync = record.sync;
    const queued = (sync?.pending.length ?? 0) + record.events.reduce((sum, entry) => sum + (entry.event.type === "sync.batch" ? entry.event.data.items.length : 0), 0);
    return { state: record.state, revision: record.revision, qrRevision: record.qrRevision, attempts: record.attempts, errorCode: record.errorCode, connectEnabled: this.connectEnabled,
      ...(record.pairingPhase ? { pairingPhase: record.pairingPhase } : {}),
      ...(sync ? { sync: { historyEnabled: this.historyEnabled(scope), phase: record.events.some((entry) => entry.dead) || sync.failures || sync.limited ? "PARTIAL" : sync.complete && queued === 0 ? "PROCESSED" : sync.phase, queued, contacts: sync.contacts, conversations: sync.conversations, messages: sync.messages, failures: sync.failures + record.events.filter((entry) => entry.dead).length, limited: sync.limited, durationMs: sync.durationMs } } : {}) };
  }
  qr(scope: Scope) {
    this.view(scope);
    const qr = this.actor(scope).qr;
    if (!qr || qr.expiresAt <= this.now()) throw new ServiceError("QR_NOT_AVAILABLE", 404);
    return { qr: qr.value, revision: qr.revision, expiresAt: new Date(qr.expiresAt).toISOString() };
  }
  async create(scope: Scope) { await this.vault.update(scope, () => undefined); return this.view(scope); }
  async command(scope: Scope, action: "connect" | "refresh" | "disconnect" | "logout", commandId: string) {
    this.view(scope);
    const actor = this.actor(scope);
    return actor.serial.run(async () => {
      if (this.stopping) throw new ServiceError("SERVICE_STOPPING", 503);
      if (["connect", "refresh"].includes(action) && !this.connectEnabled) throw new ServiceError("CONNECTIONS_DISABLED", 403);
      const digest = createHash("sha256").update(action).digest("hex");
      const record = this.vault.get(scope);
      if (!record) throw new ServiceError("SESSION_NOT_FOUND", 404);
      const previous = record.commands.find((command) => command.id === commandId);
      if (previous) {
        if (previous.digest !== digest) throw new ServiceError("IDEMPOTENCY_CONFLICT");
        return this.view(scope);
      }
      if (action === "refresh" && (record.pairingPhase === "AUTHENTICATING" || !["CONNECTING", "QR_REQUIRED"].includes(record.state))) throw new ServiceError("INVALID_SESSION_STATE");
      // Persist intent before network activity; a restart can safely resume it.
      await this.vault.update(scope, (current) => {
        current.commands.push({ id: commandId, digest });
        if (current.commands.length > 256) current.commands.shift();
        current.desired = action === "connect" || action === "refresh";
        if (action === "logout") { delete current.auth; current.keys = {}; }
        if ((action === "connect" && !actor.socket) || action === "refresh") current.attempts = 0;
      });
      if (action === "connect" || action === "refresh") {
        if (action === "refresh") this.close(actor);
        if (!actor.socket) { actor.cancel?.(); await this.start(scope, actor); }
      } else {
        const socket = actor.socket;
        if (action === "logout") {
          actor.generation++; actor.cancel?.(); actor.deadline?.(); actor.qr = undefined;
          // Local revocation is authoritative even if the external logout fails.
          if (socket) {
            let timeout: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([socket.logout(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new ServiceError("LOGOUT_REMOTE_FAILED")), 5000); timeout.unref(); })]).catch(() => this.log("LOGOUT_REMOTE_FAILED"));
            clearTimeout(timeout);
          }
        }
        this.close(actor);
        // A credential callback queued before logout may have committed between
        // persisted intent and SDK disable. Clear again after disabling callbacks.
        if (action === "logout") await this.vault.update(scope, (current) => { delete current.auth; current.keys = {}; });
        await this.transition(scope, action === "logout" ? "LOGGED_OUT" : "DISCONNECTED");
      }
      return this.view(scope);
    });
  }
  private close(actor: Actor) {
    actor.generation++;
    actor.cancel?.(); actor.deadline?.();
    actor.cancel = undefined; actor.deadline = undefined; actor.qr = undefined;
    const socket = actor.socket; actor.socket = undefined;
    try { socket?.close(); } catch { this.log("TRANSPORT_CLOSE_FAILED"); }
  }
  private enqueue(scope: Scope, actor: Actor, generation: number, operation: () => Promise<void>) {
    return actor.serial.run(async () => {
      if (actor.generation !== generation || this.stopping) return;
      await operation();
    }).catch((error: unknown) => {
      if (error instanceof ProviderContractError) { this.log("INVALID_PROVIDER_EVENT"); return; }
      this.failedStorage = true;
      this.close(actor); // fail closed rather than receive events that cannot persist
      this.log("SESSION_PROCESSING_FAILED");
    });
  }
  private async transition(scope: Scope, state: State, errorCode?: string, retryable = false) {
    const qr = this.actor(scope).qr;
    await this.vault.update(scope, (record) => {
      record.state = state; record.errorCode = errorCode; record.revision++;
      record.pairingPhase = state === "CONNECTING" ? "GENERATING_QR" : state === "QR_REQUIRED" ? "WAITING_SCAN" : state === "CONNECTED" ? "CONNECTED" : state === "RECONNECTING" ? "RECONNECTING" : "IDLE";
      appendRecordEvent(record, {
        ...envelope(scope, "connection.updated", "connection", `${record.revision}`),
        data: { state, retryable, ...(errorCode ? { errorCode } : {}),
          ...(state === "QR_REQUIRED" && qr ? { qrRevision: qr.revision, qrExpiresAt: new Date(qr.expiresAt).toISOString() } : {}) },
      });
    });
    this.log(state);
  }
  private async start(scope: Scope, actor: Actor) {
    if (this.stopping || !this.connectEnabled || !this.vault.get(scope)?.desired) return;
    this.close(actor);
    const generation = actor.generation;
    const attempts = await this.vault.update(scope, (record) => { record.attempts++; return record.attempts; });
    if (attempts > 5) {
      await this.vault.update(scope, (record) => { record.desired = false; });
      await this.transition(scope, "FAILED", "RECONNECT_LIMIT"); return;
    }
    await this.transition(scope, attempts === 1 ? "CONNECTING" : "RECONNECTING", undefined, true);
    try {
      actor.socket = await this.factory(scope, {
        connection: (update) => this.enqueue(scope, actor, generation, () => this.connection(scope, actor, update)),
        failure: () => this.enqueue(scope, actor, generation, async () => { throw new ServiceError("AUTH_PERSISTENCE_FAILED"); }),
        text: (message) => this.enqueue(scope, actor, generation, async () => {
          await this.journal.append(scope, {
            ...envelope(scope, message.fromMe ? "message.sent" : "message.received", message.id),
            occurredAt: new Date(message.timestamp).toISOString(),
            data: { providerMessageId: message.id, providerConversationId: message.chatId,
              sender: { origin: message.fromMe ? "DEVICE" : "CONTACT", externalId: message.chatId },
              direction: message.fromMe ? "OUTBOUND" : "INBOUND", content: normalizeText(message.body), status: "SENT" },
          });
        }),
        receipt: (id, status, chatId) => this.enqueue(scope, actor, generation, async () => {
          await this.journal.append(scope, { ...envelope(scope, "message.updated", id, status + (chatId ?? "")), data: { providerMessageId: id, status, ...(chatId ? { providerConversationId: chatId } : {}) } });
        }),
        sync: (items, historical, completed, failures, limited) => {
          if (!this.syncOptions.enabled) return;
          return this.enqueue(scope, actor, generation, () => this.journal.stage(scope, items, historical, this.historyEnabled(scope), completed, failures, limited));
        },
      });
      actor.deadline = this.schedule(() => this.enqueue(scope, actor, generation, async () => {
        this.close(actor);
        await this.vault.update(scope, (record) => { record.desired = false; });
        await this.transition(scope, "FAILED", "PAIRING_TIMEOUT");
      }), 120_000);
    } catch { await this.connection(scope, actor, { state: "close", code: 503 }); }
  }
  private async connection(scope: Scope, actor: Actor, update: ConnectionUpdate) {
    if (update.authenticating && update.state !== "open") {
      actor.qr = undefined;
      await this.vault.update(scope, (record) => {
        record.state = "CONNECTING"; record.pairingPhase = "AUTHENTICATING"; record.revision++;
        appendRecordEvent(record, { ...envelope(scope, "connection.updated", "connection", String(record.revision)), data: { state: "CONNECTING", retryable: false } });
      });
    }
    if (update.qr) {
      if (Buffer.byteLength(update.qr) > 8192) throw new ServiceError("INVALID_QR");
      const revision = await this.vault.update(scope, (record) => { record.qrRevision++; return record.qrRevision; });
      actor.qr = { value: update.qr, expiresAt: this.now() + 20_000, revision };
      await this.transition(scope, "QR_REQUIRED", undefined, true);
    }
    if (update.state === "open") {
      actor.deadline?.(); actor.deadline = undefined; actor.qr = undefined;
      await this.transition(scope, "CONNECTED");
    }
    if (update.state !== "close") return;
    this.close(actor);
    const record = this.vault.get(scope);
    if (!record?.desired) return;
    if ([401, 403, 411, 440, 500].includes(update.code ?? 0)) {
      await this.vault.update(scope, (current) => {
        current.desired = false;
        if (update.code === 401 || update.code === 500) { delete current.auth; current.keys = {}; }
      });
      await this.transition(scope, update.code === 401 ? "LOGGED_OUT" : "FAILED", update.code === 440 ? "SESSION_REPLACED" : "SESSION_REVOKED");
    } else if (record.attempts >= 5) {
      await this.vault.update(scope, (current) => { current.desired = false; });
      await this.transition(scope, "FAILED", "RECONNECT_LIMIT");
    } else {
      await this.transition(scope, "RECONNECTING", "CONNECTION_LOST", true);
      const generation = actor.generation;
      actor.cancel = this.schedule(() => this.enqueue(scope, actor, generation, () => this.start(scope, actor)), Math.min(30_000, 1000 * 2 ** (record.attempts - 1)) + Math.floor(Math.random() * 250));
    }
  }
  async recover() {
    for (const record of this.vault.all()) {
      const scope = { organizationId: record.organizationId, connectionId: record.connectionId };
      const actor = this.actor(scope);
      if (this.syncOptions.enabled) await this.journal.stage(scope, [], false, this.historyEnabled(scope));
      if (record.desired && this.connectEnabled) await actor.serial.run(() => this.start(scope, actor));
      else if (!["DISCONNECTED", "LOGGED_OUT", "FAILED"].includes(record.state)) await this.transition(scope, "DISCONNECTED");
    }
  }
  async settle(scope: Scope) { await this.actor(scope).serial.run(async () => undefined); }
  ready() { const metrics = this.journal.metrics(); return !this.stopping && !this.failedStorage && metrics.dead === metrics.syncDead && metrics.pending < 4096; }
  metrics() { return { sessions: this.vault.metrics().sessions, active: [...this.actors.values()].filter((actor) => !!actor.socket).length, ...this.journal.metrics() }; }
  async shutdown() {
    this.stopping = true;
    for (const actor of this.actors.values()) this.close(actor);
    await Promise.all([...this.actors.values()].map((actor) => actor.serial.run(async () => undefined)));
    await this.vault.flush();
  }
}
