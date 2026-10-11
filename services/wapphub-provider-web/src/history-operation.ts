import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { historyControlSchema, type HistoryControl, type HistorySpec, type HistoryView } from "../../../contracts/history.js";
import type { SyncItem } from "../../../contracts/provider.js";
import { EventJournal } from "./events.js";
import { ServiceError } from "./errors.js";
import { Vault, type Scope } from "./vault.js";

export type HistoryOperation = HistorySpec & { state: HistoryView["state"]; contacts: number; conversations: number; messages: number; requests: number; duplicates: number; failures: number; limited: boolean; keys: string[]; identities?: string[][]; files?: string[]; decodedBytes?: number; decodedReference?: string; nextAnchor?: HistorySpec["anchors"][number]; cursor: number; target: number; spool?: SyncItem[]; reference?: string; expiresAt: number; requestId?: string; requestAt?: number; errorCode?: string; lastProcessedAt?: string; authorization?: HistoryControl["authorization"]; nextRequestAt?: number; cooldowns?: Record<string, number>; };
export function historyView(op: HistoryOperation, queued: number): HistoryView {
  return { id: op.id, state: op.state, from: op.from, to: op.to, limits: op.limits, contacts: op.contacts, conversations: op.conversations, messages: op.messages, requests: op.requests, duplicates: op.duplicates, failures: op.failures, limited: op.limited, queued, ...(op.errorCode ? { errorCode: op.errorCode } : {}), ...(op.lastProcessedAt ? { lastProcessedAt: op.lastProcessedAt } : {}) };
}
const active = (op?: HistoryOperation) => !!op && ["RUNNING", "WAITING", "BACKPRESSURE"].includes(op.state);
/** One bounded producer extends the existing encrypted journal. Never owns auth. */
export class HistoryImporter {
  private pumping = false; private closed = false; private pumpTask?: Promise<void>;
  constructor(private readonly vault: Vault, private readonly scope: Scope, private readonly request: (count: number, anchor: HistorySpec["anchors"][number]) => Promise<string>, private readonly decode: (reference: string) => Promise<SyncItem[]>, private readonly executionEnabled = false, private readonly now = Date.now, private readonly scopedAuthorization = false) {}
  get current() { return this.vault.history(this.scope); }
  get accepting() { const op = this.vault.historyState(this.scope); return !!op && ["RUNNING", "WAITING", "BACKPRESSURE"].includes(op.state) && !this.closed && op.expiresAt > this.now(); }
  async command(input: HistoryControl) {
    const c = historyControlSchema.parse(input);
    if (c.authorization && (c.authorization.organizationId !== this.scope.organizationId || c.authorization.connectionId !== this.scope.connectionId)) throw new ServiceError("HISTORY_SCOPE_DENIED", 403);
    const digest = createHash("sha256").update(JSON.stringify(c)).digest("hex");
    await this.vault.update(this.scope, (record) => {
      const previous = record.commands.find((x) => x.id === c.commandId);
      if (previous) { if (previous.digest !== digest) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409); return; }
      if (c.action === "prepare") {
        if (!c.spec || c.spec.id !== c.operationId) throw new ServiceError("INVALID_HISTORY_OPERATION", 400);
        if (record.historyOperation && !(c.authorization && record.historyOperation.state === "PREPARED" && !record.historyOperation.requests) && !["CANCELLED", "COMPLETED", "NO_DATA", "FAILED", "PARTIAL"].includes(record.historyOperation.state) || record.sync?.pending.some((x) => x.operationId) || record.events.some((x) => x.event.type === "sync.batch" && x.event.data.historical)) throw new ServiceError("HISTORY_OPERATION_PENDING", 409);
        record.historyOperation = { ...c.spec, state: "PREPARED", contacts: 0, conversations: 0, messages: 0, requests: 0, duplicates: 0, failures: 0, limited: false, keys: [], cursor: 0, target: 0, expiresAt: this.now() + (c.authorization ? 45000 : 15 * 60000), ...(c.authorization ? { authorization: c.authorization } : {}) };
      } else {
        const op = record.historyOperation;
        if (!op || op.id !== c.operationId) throw new ServiceError("HISTORY_OPERATION_MISMATCH", 409);
        if (op.authorization && c.action !== "pause" && c.action !== "cancel" && JSON.stringify(c.authorization) !== JSON.stringify(op.authorization)) throw new ServiceError("HISTORY_SCOPE_DENIED", 403);
        if (this.scopedAuthorization && ["start", "resume", "reconcile"].includes(c.action) && !op.authorization) throw new ServiceError("HISTORY_EXECUTION_DISABLED", 403);
        if (c.action === "reconcile") {
          if (!this.executionEnabled) throw new ServiceError("HISTORY_EXECUTION_DISABLED", 403);
          op.expiresAt = this.now() + 45000;
          if (c.spec && c.spec.id === op.id && c.spec.from === op.from && c.spec.to === op.to && JSON.stringify(c.spec.limits) === JSON.stringify(op.limits)) {
            for (const anchor of c.spec.anchors) if (op.anchors.length < 16 && !op.anchors.some((a) => a.chatId === anchor.chatId)) op.anchors.push(anchor);
          }
          if (this.now() >= (op.nextRequestAt ?? 0) && !op.requestAt && op.messages < op.limits.messages && op.requests < 16 && (op.failures === 0 || !!op.reference && op.failures < 5 && op.errorCode === "HISTORY_DOWNLOAD_FAILED") && (op.target < op.anchors.length || op.spool || op.reference) && ["COMPLETED", "NO_DATA", "PAUSED"].includes(op.state) && !["HISTORY_RESPONSE_TIMEOUT", "HISTORY_REQUEST_UNCERTAIN", "HISTORY_RESTART_UNCERTAIN"].includes(op.errorCode ?? "")) { op.state = "RUNNING"; delete op.errorCode; }
        } else if (["start", "resume"].includes(c.action)) {
          if (!this.executionEnabled) throw new ServiceError("HISTORY_EXECUTION_DISABLED", 403);
          if (!["PREPARED", "PAUSED"].includes(op.state)) throw new ServiceError("INVALID_HISTORY_STATE", 409);
          if (!op.authorization && !op.anchors.length && !op.spool && !op.reference) throw new ServiceError("HISTORY_ANCHOR_REQUIRED", 409);
          if (op.authorization && op.requestAt) throw new ServiceError("HISTORY_REQUEST_UNCERTAIN", 409);
          op.state = "RUNNING"; op.expiresAt = this.now() + (op.authorization ? 45000 : 15 * 60000); delete op.errorCode;
        } else if (c.action === "pause") { if (!op.authorization && !["RUNNING", "WAITING", "BACKPRESSURE", "PAUSED"].includes(op.state)) throw new ServiceError("INVALID_HISTORY_STATE", 409); op.state = "PAUSED"; }
        else { if (!op.authorization && ["COMPLETED", "NO_DATA", "FAILED"].includes(op.state)) throw new ServiceError("INVALID_HISTORY_STATE", 409); op.state = "CANCELLED"; delete op.spool; delete op.reference; }
      }
      record.commands.push({ id: c.commandId, digest }); if (record.commands.length > 256) record.commands.shift();
    });
    if (this.accepting) this.kick();
  }
  async receive(items: SyncItem[], reference?: string) {
    if (!this.accepting) return;
    await this.vault.update(this.scope, (record) => {
      const op = record.historyOperation!;
      if (!active(op)) return;
      const digest = reference ? createHash("sha256").update(reference).digest("hex") : undefined;
      if (digest && op.files?.includes(digest) || !reference && op.spool && JSON.stringify(op.spool) === JSON.stringify(items)) return;
      if (!op.requestAt || op.spool || op.reference) throw new ServiceError("HISTORY_BACKPRESSURE", 409);
      if (!reference && Buffer.byteLength(JSON.stringify(items)) > 2 * 1024 * 1024) throw new ServiceError("HISTORY_BYTE_LIMIT", 413);
      if (reference) {
        const files = op.files ??= []; if (files.includes(digest!)) return;
        if (files.length >= 16 || (op.decodedBytes ?? 0) + 8 * 1024 * 1024 > 32 * 1024 * 1024) throw new ServiceError("HISTORY_BYTE_LIMIT", 413);
        files.push(digest!);
      }
      op.cursor = 0; op.state = "RUNNING";
      if (reference) op.reference = reference; else op.spool = items;
      delete op.requestId; delete op.requestAt;
    });
    this.kick();
  }
  async fail(code: string) {
    await this.vault.update(this.scope, (record) => { const op = record.historyOperation; if (!op || !active(op)) return; op.failures++; op.nextRequestAt = this.now() + Math.min(300000, 30000 * 2 ** op.failures); op.state = op.spool || op.reference ? "PAUSED" : "PARTIAL"; op.errorCode = ["HISTORY_BYTE_LIMIT", "HISTORY_OBJECT_LIMIT", "HISTORY_DOWNLOAD_FAILED", "HISTORY_BACKPRESSURE", "HISTORY_REQUEST_UNCERTAIN", "HISTORY_TRANSPORT_UNAVAILABLE"].includes(code) ? code : "HISTORY_PROCESSING_FAILED"; });
  }
  private kick() { if (!this.pumping && !this.closed) { this.pumping = true; this.pumpTask = this.pump().catch((error: unknown) => this.closed ? undefined : this.fail(error instanceof ServiceError ? error.code : "HISTORY_PROCESSING_FAILED")).finally(() => { this.pumping = false; }); } }
  private async pump() {
    const journal = new EventJournal(this.vault, this.now);
    while (this.accepting) {
      const op = this.current!;
      const record = this.vault.get(this.scope);
      const liveBacklog = (record?.sync?.pending.filter((item) => !item.historical).length ?? 0) + (record?.events.filter((entry) => entry.event.type === "sync.batch" && !entry.event.data.historical).length ?? 0);
      if (op.authorization && (liveBacklog > 100 || process.memoryUsage().rss > 384 * 1024 * 1024)) {
        await this.vault.update(this.scope, (r) => { r.historyOperation!.state = "PAUSED"; r.historyOperation!.errorCode = liveBacklog > 100 ? "HISTORY_LIVE_BACKLOG" : "HISTORY_MEMORY_PRESSURE"; r.historyOperation!.nextRequestAt = this.now() + 60000; }); return;
      }
      const items = op.spool ?? (op.reference ? await this.decode(op.reference) : undefined);
      if (items) {
        for (let cursor = op.cursor; cursor < items.length && this.accepting;) {
          const result = await journal.stage(this.scope, items.slice(cursor, cursor + 20), true, true, false, 0, false, undefined, op.id, cursor);
          cursor = result?.cursor ?? cursor;
          if (result?.blocked) { await delay(500); continue; }
          if (cursor < items.length) await delay(0);
        }
        if (!this.accepting) return;
        await this.vault.update(this.scope, (r) => { const current = r.historyOperation!; delete current.spool; delete current.reference; current.cursor = 0;
          const anchor = current.nextAnchor ?? current.anchors[current.target];
          const oldest = items.filter((item): item is Extract<SyncItem, { kind: "message" }> => item.kind === "message" && !!anchor && [item.identity.externalId, ...(item.identity.aliases ?? [])].includes(anchor.chatId) && Date.parse(item.occurredAt) < anchor.timestamp).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.message.providerMessageId.localeCompare(b.message.providerMessageId))[0];
          if (oldest && Date.parse(oldest.occurredAt) > Date.parse(current.from)) current.nextAnchor = { chatId: anchor!.chatId, messageId: oldest.message.providerMessageId, fromMe: oldest.message.direction === "OUTBOUND", timestamp: Date.parse(oldest.occurredAt) };
          else { current.target++; delete current.nextAnchor; }
          current.state = "RUNNING"; current.lastProcessedAt = new Date(this.now()).toISOString(); });
        continue;
      }
      if (op.messages >= op.limits.messages || op.target >= op.anchors.length || op.requests >= 16) {
        await this.vault.update(this.scope, (r) => { const current = r.historyOperation!; current.limited ||= current.requests >= 16 && current.target < current.anchors.length && current.messages < current.limits.messages; current.state = current.limited || current.failures ? "PARTIAL" : !current.messages && !current.contacts && !current.conversations ? "NO_DATA" : "COMPLETED"; }); return;
      }
      if (op.requestAt) {
        if (this.now() - op.requestAt > 60000) {
          await this.vault.update(this.scope, (r) => { r.historyOperation!.state = r.historyOperation!.messages || r.historyOperation!.contacts ? "PARTIAL" : "NO_DATA"; r.historyOperation!.errorCode = "HISTORY_RESPONSE_TIMEOUT"; }); return;
        }
        await delay(500); continue;
      }
      const anchor = op.nextAnchor ?? op.anchors[op.target]!;
      if (op.authorization && Math.max(op.nextRequestAt ?? 0, op.cooldowns?.[anchor.chatId] ?? 0) > this.now()) { await delay(500); continue; }
      // Persist dispatch intent BEFORE network: on crash, never repeat an uncertain request.
      await this.vault.update(this.scope, (r) => { const current = r.historyOperation!; current.requests++; current.requestAt = this.now(); current.state = "WAITING"; if (current.authorization) { current.nextRequestAt = this.now() + 30000; (current.cooldowns ??= {})[anchor.chatId] = this.now() + 300000; } });
      if (!this.accepting) return;
      let id: string;
      try { id = await this.request(Math.min(100, op.limits.messages - op.messages), op.nextAnchor ?? op.anchors[op.target]!); } catch { await this.fail("HISTORY_REQUEST_UNCERTAIN"); return; }
      if (this.closed) return;
      await this.vault.update(this.scope, (r) => { const current = r.historyOperation!; if (current.requestAt && active(current)) current.requestId = id; });
    }
    if (!this.closed && this.current && active(this.current)) await this.vault.update(this.scope, (r) => { r.historyOperation!.state = "PAUSED"; r.historyOperation!.errorCode = "HISTORY_AUTHORIZATION_EXPIRED"; });
  }
  close() { this.closed = true; return this.pumpTask; }
  async recover() { if (this.current && active(this.current)) await this.vault.update(this.scope, (r) => { r.historyOperation!.state = "PAUSED"; r.historyOperation!.errorCode = r.historyOperation!.authorization && r.historyOperation!.requestAt ? "HISTORY_RESTART_UNCERTAIN" : "HISTORY_RESTART_PAUSED"; }); }
}
