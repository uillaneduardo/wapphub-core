import { intentDigest, sendIntentSchema, type SendIntent, type SendResult } from "../../../contracts/provider-outbound.js";
import { createHash, randomUUID } from "node:crypto";
import { normalizeText, ProviderContractError } from "../../../contracts/provider.js";
import { appendRecordEvent, envelope, EventJournal } from "./events.js";
import { ServiceError } from "./errors.js";
import { Serial } from "./serial.js";
import type { ConnectionUpdate, Transport, TransportFactory } from "./transport.js";
import { historyView } from "./history-operation.js";
import type { HistoryControl } from "../../../contracts/history.js";
import { Vault, type Scope, type State, type Session } from "./vault.js";

type Actor = { serial: Serial; generation: number; socket?: Transport; cancel?: () => void; deadline?: () => void; qrDeadline?: () => void; stable?: () => void; failureCode?: string; storageFailed?: boolean; recoveryStarts?: number; controlled?: string; pairingUntil?: number; pairingRestarted?: boolean; qr?: { value: string; expiresAt: number; revision: number } };
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
    private readonly log: (code: string, fields?: { source: string; stage: string; count: number; scopeHash?: string; generation?: number }) => void = () => undefined,
    private readonly syncOptions: { enabled: boolean; historyEnabled: boolean; initialHistoryEnabled?: boolean; approvedScope?: string; linkedRecoveryOnly?: boolean; outboundEnabled?: boolean } = { enabled: false, historyEnabled: false },
  ) {}
  private historyEnabled(scope: Scope, record = this.vault.get(scope)) {
    const bootstrap = record?.historyImports;
    return (this.syncOptions.initialHistoryEnabled === true && (bootstrap?.initialPending === true || !!bootstrap?.pending?.length)) ||
      this.syncOptions.historyEnabled && this.syncOptions.approvedScope === scopeKey(scope);
  }
  private actor(scope: Scope) {
    const key = scopeKey(scope);
    let actor = this.actors.get(key);
    if (!actor) { actor = { serial: new Serial(), generation: 0 }; this.actors.set(key, actor); }
    return actor;
  }
  private linked(scope: Scope, record = this.vault.get(scope)) {
    try { const auth = JSON.parse(record?.auth ?? "null"); return typeof auth?.me?.id === "string" && auth.me.id.length > 0 && !!auth.signedIdentityKey?.private && !!auth.signedIdentityKey?.public && !!auth.noiseKey?.private && !!auth.noiseKey?.public; } catch { return false; }
  }
  private hasIdentity(scope: Scope, record = this.vault.get(scope)) {
    try { const auth = JSON.parse(record?.auth ?? "null"); return typeof auth?.me?.id === "string" && auth.me.id.length > 0; } catch { return false; }
  }
  private recoveryEligible(scope: Scope, record = this.vault.get(scope)) {
    return !!record && !record.invalidated && this.linked(scope, record) && this.connectEnabled && !this.actor(scope).socket &&
      ["FAILED", "DISCONNECTED"].includes(record.state) &&
      !["SESSION_REVOKED", "SESSION_REPLACED", "BAD_SESSION"].includes(record.errorCode ?? "") &&
      record.termination?.action !== "logout" && !["RUNNING", "AUTHENTICATED"].includes(record.recovery?.state ?? "") &&
      [undefined, "RECONNECT_LIMIT", "CONNECTION_LOST", "PAIRING_TIMEOUT", "PAIRING_TRANSPORT_CLOSED", "PAIRING_START_FAILED", "PAIRING_INTERRUPTED", "RECOVERY_TIMEOUT", "RECOVERY_INTERRUPTED", "EXISTING_AUTH_REQUIRED"].includes(record.errorCode);
  }
  private pairingAuthorized(scope: Scope) {
    const r = this.vault.get(scope);
    return !!r?.pairingAuthorization && r.pairingAuthorization.expiresAt > this.now() && !r.invalidated && r.termination?.action !== "logout";
  }
  private preparation(scope: Scope, r: Session | undefined = this.vault.get(scope)) {
    const remote = r?.termination?.remote === "CONFIRMED" || r?.invalidated === "SESSION_REVOKED" && r.lastDisconnect?.code === 401;
    const eligible = !!r && this.connectEnabled && !this.actor(scope).storageFailed && !this.actor(scope).socket && !r.desired && ["DISCONNECTED", "LOGGED_OUT", "FAILED"].includes(r.state) && (remote || r.termination?.remote === "UNCONFIRMED" || !!r.invalidated);
    return { eligible, remote };
  }
  view(scope: Scope) {
    const record = this.vault.viewSnapshot(scope);
    if (!record) throw new ServiceError("SESSION_NOT_FOUND", 404);
    const sync = record.sync;
    const actor = this.actors.get(scopeKey(scope));
    const linked = this.linked(scope, record), preparation = this.preparation(scope, record);
    const queued = (sync?.pending.length ?? 0) + record.events.reduce((sum, entry) => sum + (entry.event.type === "sync.batch" ? entry.event.data.items.length : 0), 0);
    return { state: actor?.failureCode ? "FAILED" as const : record.state, revision: record.revision, qrRevision: record.qrRevision, attempts: record.attempts, errorCode: actor?.failureCode ?? record.errorCode, connectEnabled: this.connectEnabled,
      ...(record.historyOperation ? { history: historyView(record.historyOperation, (record.sync?.pending.filter((x) => x.operationId === record.historyOperation!.id).length ?? 0) + record.events.reduce((n, e) => n + (e.event.type === "sync.batch" && e.event.correlationId === record.historyOperation!.id ? e.event.data.items.length : 0), 0)) } : {}),
      ...(record.pairingPhase ? { pairingPhase: record.pairingPhase } : {}),
      sync: { lifecycle: { linked, desired: record.desired, recoveryEligible: this.recoveryEligible(scope, record), pairingEligible: this.connectEnabled && !this.hasIdentity(scope, record) && !actor?.socket && !actor?.storageFailed && !record.invalidated && record.termination?.action !== "logout" && ["DISCONNECTED", "FAILED"].includes(record.state), preparationEligible: preparation.eligible && (record.retiredSessions?.length ?? 0) < 2, removalConfirmationRequired: preparation.eligible && !preparation.remote, ...(record.recovery ? { recovery: record.recovery } : {}), ...(record.termination ? { termination: record.termination } : {}) }, activeTransport: Boolean(actor?.socket), ...(record.processingFailure ? { processingFailure: record.processingFailure } : {}), historyEnabled: this.historyEnabled(scope, record), phase: record.events.some((entry) => entry.dead) || sync?.failures || sync?.limited || sync?.diagnostics?.rejected ? "PARTIAL" : sync?.complete && queued === 0 ? "PROCESSED" : sync?.phase ?? "DISABLED", queued, contacts: sync?.contacts ?? 0, conversations: sync?.conversations ?? 0, messages: sync?.messages ?? 0, failures: (sync?.failures ?? 0) + record.events.filter((entry) => entry.dead).length, limited: sync?.limited ?? false, durationMs: sync?.durationMs ?? 0, ...(sync?.diagnostics ? { diagnostics: sync.diagnostics } : {}) } };
  }
  qr(scope: Scope) {
    this.view(scope);
    const qr = this.actor(scope).qr;
    if (!qr || qr.expiresAt <= this.now() || this.syncOptions.linkedRecoveryOnly && !this.pairingAuthorized(scope)) throw new ServiceError("QR_NOT_AVAILABLE", 404);
    return { qr: qr.value, revision: qr.revision, expiresAt: new Date(qr.expiresAt).toISOString() };
  }
  async resolveRecipient(scope: Scope, phone: string) {
    if (!this.syncOptions.outboundEnabled) throw new ServiceError("OUTBOUND_DISABLED", 403);
    const actor = this.actor(scope);
    if (this.view(scope).state !== "CONNECTED" || !actor.socket?.resolveRecipient) throw new ServiceError("OUTBOUND_UNAVAILABLE", 409);
    const generation = actor.generation, result = await actor.socket.resolveRecipient(phone);
    return actor.generation === generation && this.view(scope).state === "CONNECTED" ? result : { state: "UNKNOWN" as const };
  }
  async send(scope: Scope, input: SendIntent): Promise<SendResult> {
    const intent = sendIntentSchema.parse(input), digest = intentDigest(intent), actor = this.actor(scope);
    const reservation = await actor.serial.run(async () => {
      const previous = this.vault.get(scope)?.sends?.find(x => x.id === intent.commandId);
      if (previous) {
        if (previous.digest !== digest) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409);
        return { outcome: previous.outcome, providerMessageId: previous.providerMessageId, ...(previous.errorCode ? { errorCode: previous.errorCode } : {}) };
      }
      if (!this.syncOptions.outboundEnabled) throw new ServiceError("OUTBOUND_DISABLED", 403);
      if (Date.parse(intent.expiresAt) <= this.now() || Date.parse(intent.expiresAt) > this.now() + 7 * 86400000) throw new ServiceError("INTENT_EXPIRED", 409);
      if (this.view(scope).state !== "CONNECTED" || !actor.socket?.send) throw new ServiceError("OUTBOUND_UNAVAILABLE", 409);
      await this.vault.update(scope, record => {
        record.sends ??= [];
        // Expired callers are rejected above: eviction cannot cause retransmission.
        record.sends = record.sends.filter(x => Date.parse(x.expiresAt) > this.now());
        if (record.sends.length >= 1024) throw new ServiceError("SEND_RETENTION_LIMIT", 429);
        record.sends.push({ id: intent.commandId, digest, providerMessageId: intent.providerMessageId, ...(intent.media ? { mediaId: intent.media.mediaId } : {}), outcome: "UNKNOWN", expiresAt: intent.expiresAt });
      }); // uncertainty is durable BEFORE calling the external transport
      return { socket: actor.socket, generation: actor.generation };
    });
    if ("outcome" in reservation) return reservation;
    let outcome: SendResult["outcome"] = "UNKNOWN";
    if (actor.generation === reservation.generation && !this.stopping) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([reservation.socket.send!(intent), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new ServiceError("SEND_RESULT_UNKNOWN", 503)), 15000); timer.unref(); })]);
        outcome = "DISPATCHED";
      } catch { this.log("SEND_RESULT_UNKNOWN"); }
      finally { clearTimeout(timer); }
    }
    await this.vault.update(scope, record => { const receipt = record.sends!.find(x => x.id === intent.commandId)!; receipt.outcome = outcome; });
    return { outcome, providerMessageId: intent.providerMessageId };
  }

  async create(scope: Scope) { await this.vault.update(scope, () => undefined); return this.view(scope); }
  async command(scope: Scope, action: "connect" | "refresh" | "recover" | "disconnect" | "logout" | "prepare_link", commandId: string, controlVersion?: number, removedOnPhone = false) {
    this.view(scope);
    const actor = this.actor(scope);
    return actor.serial.run(async () => {
      if (this.stopping) throw new ServiceError("SERVICE_STOPPING", 503);
      const digest = createHash("sha256").update(controlVersion === undefined ? action : JSON.stringify([action, controlVersion, ...(action === "prepare_link" ? [removedOnPhone] : [])])).digest("hex"), record = this.vault.get(scope)!;
      const previous = record.commands.find(command => command.id === commandId);
      if (previous) { if (previous.digest !== digest) throw new ServiceError("IDEMPOTENCY_CONFLICT"); return this.view(scope); }
      // Versioned administrative commands can rotate the bounded receipt window.
      // An evicted identity still cannot replay: its persisted controlVersion
      // must be greater than the durable fence before any state/network change.
      if (record.commands.length >= 256 && controlVersion === undefined && !["disconnect", "logout"].includes(action)) throw new ServiceError("SESSION_COMMAND_LIMIT", 429);
      if (controlVersion !== undefined && controlVersion <= (record.controlVersion ?? 0) || controlVersion === undefined && record.controlVersion !== undefined) throw new ServiceError("STALE_CONTROL_COMMAND", 409);
      if (["connect", "refresh", "recover"].includes(action) && !this.connectEnabled) throw new ServiceError("CONNECTIONS_DISABLED", 403);
      if (this.syncOptions.linkedRecoveryOnly && action === "refresh" && !this.pairingAuthorized(scope)) throw new ServiceError("LINKED_RECOVERY_ONLY", 403);
      if (action === "prepare_link") {
        const preparation = this.preparation(scope);
        if (!controlVersion || !preparation.eligible || !preparation.remote && !removedOnPhone) throw new ServiceError("LINK_PREPARATION_DENIED", 409);
        if ((record.retiredSessions?.length ?? 0) >= 2) throw new ServiceError("SESSION_ARCHIVE_LIMIT", 409);
        // Existing encrypted record/quota; no auth deletion until outcome or
        // explicit phone-removal confirmation has been validated and recorded.
        this.close(actor);
        await this.vault.update(scope, current => {
          current.retiredSessions ??= [];
          current.retiredSessions.push({ commandId, retiredAt: new Date(this.now()).toISOString(), proof: preparation.remote ? "REMOTE_CONFIRMED" : "PHONE_CONFIRMED", ...(current.auth ? { auth: current.auth } : {}), keys: current.keys, ...(current.invalidated ? { invalidated: current.invalidated } : {}), ...(current.termination ? { termination: current.termination } : {}) });
          current.commands.push({ id: commandId, digest }); if (current.commands.length > 256) current.commands.shift(); current.controlVersion = controlVersion; current.desired = false;
          delete current.auth; current.keys = {}; delete current.invalidated; delete current.termination; delete current.recovery; delete current.pairingAuthorization;
          // Lifetime attempts, history references, journal and receipts remain.
        });
        await this.transition(scope, "DISCONNECTED"); return this.view(scope);
      }
      if (action === "recover" && !this.recoveryEligible(scope)) throw new ServiceError("RECOVERY_NOT_ELIGIBLE", 409);
      if (action === "connect" && (record.invalidated || record.termination?.action === "logout" || ["SESSION_REVOKED", "SESSION_REPLACED", "BAD_SESSION"].includes(record.errorCode ?? "") || this.linked(scope) && ((record.recoveryFailures ?? (record.state === "CONNECTED" ? 0 : record.attempts)) >= 5 || record.recovery && record.recovery.state !== "SUCCEEDED"))) throw new ServiceError("CONTROLLED_RECOVERY_REQUIRED", 409);
      if (action === "refresh" && (record.pairingPhase === "AUTHENTICATING" || !["CONNECTING", "QR_REQUIRED"].includes(record.state))) throw new ServiceError("INVALID_SESSION_STATE");
      // Every authorization/stop is durable before any external activity.
      await this.vault.update(scope, current => {
        current.commands.push({ id: commandId, digest }); if (current.commands.length > 256) current.commands.shift();
        if (controlVersion !== undefined) current.controlVersion = controlVersion;
        current.desired = action === "connect" || action === "refresh";
        if (action === "connect" && !this.linked(scope) && controlVersion !== undefined) current.pairingAuthorization = { commandId, expiresAt: this.now() + 120_000 };
        if (action === "recover") current.recovery = { commandId, state: "RUNNING", startedAt: new Date(this.now()).toISOString() };
        if (action === "disconnect" || action === "logout") {
          delete current.pairingAuthorization;
          if (["RUNNING", "AUTHENTICATED"].includes(current.recovery?.state ?? "")) { current.recovery!.state = "INTERRUPTED"; current.recovery!.finishedAt = new Date(this.now()).toISOString(); current.recovery!.errorCode = "RECOVERY_INTERRUPTED"; }
          if (action === "logout" || current.termination?.action !== "logout") current.termination = { commandId, action, remote: action === "logout" ? "PENDING" : "NOT_REQUESTED", requestedAt: new Date(this.now()).toISOString() };
        } else if (action !== "recover" || current.termination?.action === "disconnect") delete current.termination;
      });
      if (action === "connect" || action === "refresh" || action === "recover") {
        if (action === "refresh") this.close(actor);
        if (["connect", "refresh"].includes(action) && !this.hasIdentity(scope)) { actor.pairingUntil = this.vault.get(scope)?.pairingAuthorization?.expiresAt ?? this.now() + 120_000; actor.pairingRestarted = false; }
        if (action === "recover") actor.controlled = commandId;
        if (!actor.socket) { actor.cancel?.(); await this.start(scope, actor); }
      } else {
        const socket = actor.socket;
        // Fence callbacks and all scheduled starts before a possible remote logout.
        actor.generation++; actor.cancel?.(); actor.deadline?.(); actor.qrDeadline?.(); actor.stable?.(); actor.qr = undefined; actor.pairingUntil = undefined;
        let remote: "CONFIRMED" | "UNCONFIRMED" = "UNCONFIRMED", errorCode = "LOGOUT_TRANSPORT_UNAVAILABLE";
        if (action === "logout" && socket) {
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try { const result = await Promise.race([socket.logout(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new ServiceError("LOGOUT_RESULT_UNKNOWN")), 5000); })]); remote = result === "CONFIRMED" ? "CONFIRMED" : "UNCONFIRMED"; errorCode = "LOGOUT_RESULT_UNKNOWN"; }
          catch { errorCode = "LOGOUT_REMOTE_FAILED"; this.log(errorCode); } finally { clearTimeout(timeout); }
        }
        this.close(actor); actor.controlled = undefined;
        await this.vault.update(scope, current => { if (action === "logout") { current.termination!.remote = remote; if (remote === "CONFIRMED") current.invalidated = "SESSION_REVOKED"; } current.termination!.finishedAt = new Date(this.now()).toISOString(); if (action === "logout" && remote !== "CONFIRMED") current.termination!.errorCode = errorCode; });
        // Retain encrypted credentials for diagnosis; a logout intent prevents reuse.
        await this.transition(scope, action === "logout" && remote === "CONFIRMED" ? "LOGGED_OUT" : "DISCONNECTED", action === "logout" && remote !== "CONFIRMED" ? errorCode : ["SESSION_REVOKED", "SESSION_REPLACED", "BAD_SESSION"].includes(record.errorCode ?? "") ? record.errorCode : undefined);
      }
      return this.view(scope);
    });
  }
  private close(actor: Actor) {
    actor.generation++;
    actor.cancel?.(); actor.deadline?.(); actor.qrDeadline?.(); actor.stable?.();
    actor.stable = undefined;
    actor.cancel = undefined; actor.deadline = undefined; actor.qrDeadline = undefined; actor.qr = undefined;
    const socket = actor.socket; actor.socket = undefined;
    try { socket?.close(); } catch { this.log("TRANSPORT_CLOSE_FAILED"); }
  }
  private enqueue(scope: Scope, actor: Actor, generation: number, operation: () => Promise<void>) {
    return actor.serial.run(async () => {
      if (actor.generation !== generation || this.stopping) return;
      try { await operation(); }
      catch (error) { await this.processingFailure(scope, actor, generation, error); }
    }).catch((error: unknown) => this.processingFailure(scope, actor, generation, error));
  }
  private async processingFailure(scope: Scope, actor: Actor, generation: number, error: unknown) {

      if (actor.generation !== generation || this.stopping) return;
      if (error instanceof ProviderContractError) { this.log("INVALID_PROVIDER_EVENT"); return; }
      const capacity = error instanceof ServiceError && ["SYNC_BACKPRESSURE", "EVENT_QUEUE_FULL", "VAULT_LIMIT"].includes(error.code);
      const io = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      const code = capacity ? (error as ServiceError).code : error instanceof ServiceError && error.code === "AUTH_PERSISTENCE_FAILED" ? error.code : io === "ENOSPC" ? "STORAGE_FULL" : ["EIO", "EACCES", "EROFS"].includes(io) ? "STORAGE_IO_FAILED" : "SESSION_PROCESSING_FAILED";
      actor.storageFailed = !capacity;
      this.failedStorage = [...this.actors.values()].some((entry) => Boolean(entry.storageFailed));
      actor.failureCode = code;
      this.close(actor);
      const closedGeneration = actor.generation; // stop receiving when durability cannot be guaranteed
      this.log(code, { source: "SESSION", stage: capacity ? "QUEUE" : "PERSISTENCE", count: 1 });
      // A capacity failure must leave the API available to drain existing events.
      // Persist only an allowlisted observation, never the exception or payload.
      await this.vault.update(scope, (record) => {
        if (actor.generation !== closedGeneration) return;
        record.state = "FAILED"; record.errorCode = code; record.revision++;
        record.pairingPhase = "IDLE";
        record.processingFailure = { id: randomUUID(), code: code as NonNullable<typeof record.processingFailure>["code"], stage: capacity ? "QUEUE" : "PERSISTENCE", occurredAt: new Date(this.now()).toISOString() };
      }).catch(() => { actor.storageFailed = true; this.failedStorage = true; this.log("DIAGNOSTIC_PERSISTENCE_FAILED"); });
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
    const initial = this.vault.get(scope), controlled = actor.controlled === initial?.recovery?.commandId && initial?.recovery?.state === "RUNNING";
    const pairing = !this.hasIdentity(scope), completingPairing = !pairing && actor.pairingUntil !== undefined;
    if (this.stopping || !this.connectEnabled || !initial || !initial.desired && !controlled || initial.termination?.action === "logout") return;
    if (initial.invalidated || ["SESSION_REVOKED", "SESSION_REPLACED", "BAD_SESSION"].includes(initial.errorCode ?? "")) return;
    if (!pairing && !completingPairing && !controlled && (initial.recoveryFailures ?? (initial.state === "CONNECTED" ? 0 : initial.attempts)) >= 5) { await this.transition(scope, "FAILED", "RECONNECT_LIMIT"); return; }
    if (actor.pairingUntil !== undefined && actor.pairingUntil <= this.now()) { await this.failPairing(scope, actor, "PAIRING_TIMEOUT"); return; }
    this.close(actor);
    if (this.syncOptions.linkedRecoveryOnly && !this.pairingAuthorized(scope) || controlled) {
      const record = this.vault.get(scope); let linked = false;
      if (record?.state === "FAILED" && ["SESSION_REVOKED", "SESSION_REPLACED"].includes(record.errorCode ?? "")) return;
      try { const auth = JSON.parse(record?.auth ?? "null"); linked = typeof auth?.me?.id === "string" && auth.me.id.length > 0; } catch { /* never log credentials */ }
      if (!linked) { await this.transition(scope, "FAILED", "EXISTING_AUTH_REQUIRED"); return; }
      if (!completingPairing && !controlled && (actor.recoveryStarts ?? 0) >= 3) { await this.transition(scope, "FAILED", "RECONNECT_LIMIT"); return; }
      if (!completingPairing) actor.recoveryStarts = (actor.recoveryStarts ?? 0) + 1;
    }
    const generation = actor.generation, startedAt = this.now();
    const attempts = await this.vault.update(scope, (record) => {
      record.attempts++; // historical starts remain available for diagnostics
      if (pairing || completingPairing) return 0; // pairing has its own deadline, no authenticated recovery budget
      // Legacy CONNECTED is evidence of an authenticated success, not five
      // consecutive failures. A legacy failed/reconnecting record retains its
      // exhausted budget; upgrading must never restart a failure loop.
      record.recoveryFailures ??= record.state === "CONNECTED" ? 0 : Math.min(5, record.attempts - 1);
      record.recoveryFailures++;
      return record.recoveryFailures;
    });
    if (!controlled && attempts > 5) {
      if (this.syncOptions.linkedRecoveryOnly) { await this.transition(scope, "FAILED", "RECONNECT_LIMIT"); return; }
      await this.vault.update(scope, (record) => { record.desired = false; });
      await this.transition(scope, "FAILED", "RECONNECT_LIMIT"); return;
    }
    await this.transition(scope, pairing || completingPairing ? "CONNECTING" : "RECONNECTING", undefined, true);
    if (completingPairing) await this.vault.update(scope, record => { record.pairingPhase = "AUTHENTICATING"; });
    try {
      let constructionCancel: (() => void) | undefined, timedOut = false;
      const construction = this.factory(scope, {
        diagnostic: (code) => this.log(code, { source: "BAILEYS", stage: "TRANSPORT", count: 1, scopeHash: createHash("sha256").update(scopeKey(scope)).digest("hex").slice(0, 16), generation }),
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
        bootstrapPage: async (items, digest, next) => {
          if (actor.generation !== generation || this.stopping) throw new ServiceError("HISTORY_TRANSPORT_UNAVAILABLE", 409);
          await actor.serial.run(async () => { await this.journal.stage(scope, items, true, true, false, 0, false, undefined, undefined, undefined, { digest, next }); });
        },
        sync: (items, historical, completed, failures, limited, observation) => {
          if (!this.syncOptions.enabled) return;
          return this.enqueue(scope, actor, generation, async () => {
            await this.journal.stage(scope, items, historical, this.historyEnabled(scope), completed, failures, limited, observation);
            if (observation) for (const [code, count] of Object.entries(observation.reasons)) this.log(`SYNC_${code}`, { source: observation.source, stage: "NORMALIZATION", count });
          });
        },
      }, { allowPairing: pairing && this.pairingAuthorized(scope) && !controlled }).then(socket => { if (timedOut || this.stopping || actor.generation !== generation) { socket.close(); throw new ServiceError("RECOVERY_INTERRUPTED", 409); } return socket; });
      try { actor.socket = await Promise.race([construction, new Promise<never>((_, reject) => { constructionCancel = this.schedule(() => { timedOut = true; reject(new ServiceError(controlled ? "RECOVERY_TIMEOUT" : pairing ? "QR_GENERATION_TIMEOUT" : "PAIRING_TIMEOUT")); }, Math.max(0, Math.min(pairing ? startedAt + 30_000 : startedAt + 120_000, actor.pairingUntil ?? startedAt + 120_000) - this.now())); })]); }
      finally { constructionCancel?.(); }
      actor.deadline = this.schedule(() => this.enqueue(scope, actor, generation, async () => {
        if (pairing || completingPairing) { await this.failPairing(scope, actor, "PAIRING_TIMEOUT"); return; }
        this.close(actor);
        if (!this.syncOptions.linkedRecoveryOnly) await this.vault.update(scope, (record) => { record.desired = false; });
        if (controlled) { await this.finishRecovery(scope, "FAILED", "RECOVERY_TIMEOUT"); actor.controlled = undefined; }
        await this.transition(scope, "FAILED", controlled ? "RECOVERY_TIMEOUT" : "PAIRING_TIMEOUT");
      }), Math.max(0, (actor.pairingUntil ?? startedAt + 120_000) - this.now()));
      if (pairing) actor.qrDeadline = this.schedule(() => this.enqueue(scope, actor, generation, () => this.failPairing(scope, actor, "QR_GENERATION_TIMEOUT")), Math.max(0, Math.min(startedAt + 30_000, actor.pairingUntil ?? startedAt + 120_000) - this.now()));
    } catch (error) {
      const code = error instanceof ServiceError ? error.code : error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (pairing || completingPairing) { await this.failPairing(scope, actor, ["PAIRING_TIMEOUT", "QR_GENERATION_TIMEOUT"].includes(code) ? code : "PAIRING_START_FAILED"); return; }
      if (["RECOVERY_TIMEOUT", "PAIRING_TIMEOUT"].includes(code) || controlled && !["EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED"].includes(code)) {
        this.close(actor); const failure = ["RECOVERY_TIMEOUT", "PAIRING_TIMEOUT"].includes(code) ? code : "RECOVERY_START_FAILED";
        await this.vault.update(scope, record => { record.desired = false; }); await this.finishRecovery(scope, "FAILED", failure); actor.controlled = undefined; await this.transition(scope, "FAILED", failure);
      } else await this.connection(scope, actor, { state: "close", code: 503 });
    }
  }
  private async connection(scope: Scope, actor: Actor, update: ConnectionUpdate) {
    if (update.authenticating && update.state !== "open") {
      actor.qr = undefined; actor.qrDeadline?.(); actor.qrDeadline = undefined;
      await this.vault.update(scope, (record) => {
        record.state = "CONNECTING"; record.pairingPhase = "AUTHENTICATING"; record.revision++;
        appendRecordEvent(record, { ...envelope(scope, "connection.updated", "connection", String(record.revision)), data: { state: "CONNECTING", retryable: false } });
      });
    }
    if (update.qr) {
      if (this.syncOptions.linkedRecoveryOnly && !this.pairingAuthorized(scope) || actor.controlled) { this.close(actor); await this.finishRecovery(scope, "FAILED", "EXISTING_AUTH_REQUIRED"); actor.controlled = undefined; await this.transition(scope, "FAILED", "EXISTING_AUTH_REQUIRED"); return; }
      if (!update.qr.trim() || Buffer.byteLength(update.qr) > 8192) throw new ServiceError("INVALID_QR");
      actor.qrDeadline?.(); actor.qrDeadline = undefined;
      const revision = await this.vault.update(scope, (record) => { record.qrRevision++; return record.qrRevision; });
      actor.qr = { value: update.qr, expiresAt: this.now() + 20_000, revision };
      await this.transition(scope, "QR_REQUIRED", undefined, true);
    }
    if (update.state === "open") {
      actor.deadline?.(); actor.qrDeadline?.(); actor.deadline = undefined; actor.qrDeadline = undefined; actor.qr = undefined; actor.pairingUntil = undefined;
      await this.vault.update(scope, (record) => { if (record.processingFailure && !record.processingFailure.recoveredAt) record.processingFailure.recoveredAt = new Date(this.now()).toISOString(); });
      actor.failureCode = undefined; actor.storageFailed = false;
      this.failedStorage = [...this.actors.values()].some((entry) => Boolean(entry.storageFailed));
      await this.vault.update(scope, record => { record.lastAuthenticatedAt = new Date(this.now()).toISOString(); delete record.pairingAuthorization; if (actor.controlled && record.recovery?.commandId === actor.controlled) record.recovery.state = "AUTHENTICATED"; });
      await this.transition(scope, "CONNECTED");
      {
        const generation = actor.generation;
        actor.stable?.();
        actor.stable = this.schedule(() => { void this.enqueue(scope, actor, generation, async () => {
          if (!actor.socket || this.vault.get(scope)?.state !== "CONNECTED") return;
          await this.vault.update(scope, (record) => { record.recoveryFailures = 0; if (actor.controlled && record.recovery?.commandId === actor.controlled) { record.recovery.state = "SUCCEEDED"; record.recovery.finishedAt = new Date(this.now()).toISOString(); record.desired = true; } });
          actor.controlled = undefined; actor.recoveryStarts = 0;
        }); }, 30_000);
      }
    }
    if (update.state !== "close") return;
    const controlled = !!actor.controlled;
    if (update.cause) this.log("TRANSPORT_" + update.cause);
    await this.vault.update(scope, record => { record.lastDisconnect = { occurredAt: new Date(this.now()).toISOString(), ...(update.code !== undefined ? { code: update.code } : {}), ...(update.cause ? { cause: update.cause } : {}) }; });
    this.close(actor);
    const record = this.vault.get(scope)!;
    if (!record.desired && !controlled) return;
    if (!controlled && actor.pairingUntil !== undefined) {
      // Baileys asks for exactly one fresh authenticated transport (515) after
      // QR success. Reuse the same bounded gesture; never another QR or retry loop.
      if (this.hasIdentity(scope) && update.code === 515 && !actor.pairingRestarted && actor.pairingUntil > this.now()) {
        actor.pairingRestarted = true;
        await this.vault.update(scope, current => { delete current.pairingAuthorization; });
        await this.transition(scope, "CONNECTING");
        await this.vault.update(scope, current => { current.pairingPhase = "AUTHENTICATING"; });
        const generation = actor.generation;
        actor.cancel = this.schedule(() => this.enqueue(scope, actor, generation, () => this.start(scope, actor)), 1000);
        return;
      }
      if (!this.hasIdentity(scope) || ![401, 403, 411, 440, 500].includes(update.code ?? 0)) { await this.failPairing(scope, actor, [401, 403, 411, 440, 500].includes(update.code ?? 0) ? "PAIRING_REJECTED" : "PAIRING_TRANSPORT_CLOSED"); return; }
    }
    if ([401, 403, 411, 440, 500].includes(update.code ?? 0)) {
      const errorCode = update.code === 440 ? "SESSION_REPLACED" : update.code === 500 ? "BAD_SESSION" : "SESSION_REVOKED";
      await this.vault.update(scope, current => { current.desired = false; current.invalidated = errorCode; });
      await this.finishRecovery(scope, "FAILED", errorCode); actor.controlled = undefined;
      await this.transition(scope, update.code === 401 && !this.syncOptions.linkedRecoveryOnly ? "LOGGED_OUT" : "FAILED", errorCode);
    } else if (controlled) {
      await this.finishRecovery(scope, "FAILED", "CONNECTION_LOST"); actor.controlled = undefined;
      await this.transition(scope, "FAILED", "CONNECTION_LOST");
    } else if ((record.recoveryFailures ?? 5) >= 5 || this.syncOptions.linkedRecoveryOnly && (actor.recoveryStarts ?? 0) >= 3) {
      if (this.syncOptions.linkedRecoveryOnly) { await this.transition(scope, "FAILED", "RECONNECT_LIMIT"); return; }
      await this.vault.update(scope, (current) => { current.desired = false; });
      await this.transition(scope, "FAILED", "RECONNECT_LIMIT");
    } else {
      await this.transition(scope, "RECONNECTING", "CONNECTION_LOST", true);
      const generation = actor.generation;
      const failures = record.recoveryFailures ?? 1;
      actor.cancel = this.schedule(() => this.enqueue(scope, actor, generation, () => this.start(scope, actor)), Math.min(30_000, 1000 * 2 ** (failures - 1)) + Math.floor(Math.random() * 250));
    }
  }
  private async finishRecovery(scope: Scope, state: "FAILED" | "INTERRUPTED", errorCode: string) {
    await this.vault.update(scope, record => { if (["RUNNING", "AUTHENTICATED"].includes(record.recovery?.state ?? "")) { record.recovery!.state = state; record.recovery!.finishedAt = new Date(this.now()).toISOString(); record.recovery!.errorCode = errorCode; record.desired = false; } });
  }
  private async failPairing(scope: Scope, actor: Actor, errorCode: string) {
    this.close(actor); actor.pairingUntil = undefined;
    await this.vault.update(scope, record => { record.desired = false; delete record.pairingAuthorization; });
    await this.transition(scope, "FAILED", errorCode);
  }
  async recover() {
    for (const record of this.vault.all()) {
      const scope = { organizationId: record.organizationId, connectionId: record.connectionId };
      const actor = this.actor(scope);
      if (this.syncOptions.enabled) await this.journal.stage(scope, [], false, this.historyEnabled(scope));
      if (["RUNNING", "AUTHENTICATED"].includes(record.recovery?.state ?? "")) { await this.finishRecovery(scope, "INTERRUPTED", "RECOVERY_INTERRUPTED"); await this.transition(scope, "FAILED", "RECOVERY_INTERRUPTED"); }
      else if (record.termination?.remote === "PENDING") { await this.vault.update(scope, current => { current.desired = false; current.termination!.remote = "UNCONFIRMED"; current.termination!.errorCode = "LOGOUT_RESULT_UNKNOWN"; current.termination!.finishedAt = new Date(this.now()).toISOString(); }); await this.transition(scope, "DISCONNECTED", "LOGOUT_RESULT_UNKNOWN"); }
      else if (record.pairingAuthorization) {
        // No replay of interrupted pairing. Terminal observations and expired
        // authorization are retained for diagnosis, with network intent stopped.
        if (record.state === "FAILED") await this.vault.update(scope, current => { current.desired = false; });
        else await this.failPairing(scope, actor, "PAIRING_INTERRUPTED");
      }
      else if (record.desired && this.connectEnabled) {
        if (!this.hasIdentity(scope)) await this.failPairing(scope, actor, this.syncOptions.linkedRecoveryOnly ? "EXISTING_AUTH_REQUIRED" : "PAIRING_INTERRUPTED");
        else await actor.serial.run(() => this.start(scope, actor));
      }
      else if (!["DISCONNECTED", "LOGGED_OUT", "FAILED"].includes(record.state)) await this.transition(scope, "DISCONNECTED");
    }
  }
  async history(scope: Scope, control: HistoryControl) {
    const actor = this.actor(scope);
    if (!actor.socket?.history || this.view(scope).state !== "CONNECTED") throw new ServiceError("HISTORY_TRANSPORT_UNAVAILABLE", 409);
    await actor.socket.history(control); return this.view(scope);
  }
  async settle(scope: Scope) { await this.actor(scope).serial.run(async () => undefined); }
  ready() { return !this.stopping && !this.failedStorage; }
  metrics() { return { sessions: this.vault.metrics().sessions, active: [...this.actors.values()].filter((actor) => !!actor.socket).length, ...this.journal.metrics() }; }
  async shutdown() {
    this.stopping = true;
    for (const actor of this.actors.values()) this.close(actor);
    await Promise.all([...this.actors.values()].map((actor) => actor.serial.run(async () => undefined)));
    await this.vault.flush();
  }
}
