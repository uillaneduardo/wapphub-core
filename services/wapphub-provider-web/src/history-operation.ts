import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { historyControlSchema, type HistoryControl, type HistorySpec, type HistoryView } from "../../../contracts/history.js";
import type { SyncItem } from "../../../contracts/provider.js";
import { EventJournal } from "./events.js";
import { ServiceError } from "./errors.js";
import { Vault, type Scope } from "./vault.js";

export type HistoryOperation = HistorySpec & { state: HistoryView["state"]; contacts: number; conversations: number; messages: number; requests: number; duplicates: number; failures: number; limited: boolean; keys: string[]; identities?: string[][]; files?: string[]; decodedBytes?: number; decodedReference?: string; nextAnchor?: HistorySpec["anchors"][number]; cursor: number; target: number; spool?: SyncItem[]; reference?: string; expiresAt: number; requestId?: string; requestAt?: number; errorCode?: string; lastProcessedAt?: string };
export function historyView(op: HistoryOperation, queued: number): HistoryView {
  return { id: op.id, state: op.state, from: op.from, to: op.to, limits: op.limits, contacts: op.contacts, conversations: op.conversations, messages: op.messages, requests: op.requests, duplicates: op.duplicates, failures: op.failures, limited: op.limited, queued, ...(op.errorCode ? { errorCode: op.errorCode } : {}), ...(op.lastProcessedAt ? { lastProcessedAt: op.lastProcessedAt } : {}) };
}
const active = (op?: HistoryOperation) => !!op && ["RUNNING", "WAITING", "BACKPRESSURE"].includes(op.state);
/** One bounded producer extends the existing encrypted journal. Never owns auth. */
export class HistoryImporter {
  private pumping = false; private closed = false;
  constructor(private readonly vault: Vault, private readonly scope: Scope, private readonly request: (count: number, anchor: HistorySpec["anchors"][number]) => Promise<string>, private readonly decode: (reference: string) => Promise<SyncItem[]>, private readonly executionEnabled = false, private readonly now = Date.now) {}
  get current() { return this.vault.get(this.scope)?.historyOperation; }
  get accepting() { return active(this.current) && !this.closed && this.current!.expiresAt > this.now(); }
  async command(input: HistoryControl) {
    const c = historyControlSchema.parse(input), digest = createHash("sha256").update(JSON.stringify(c)).digest("hex");
    await this.vault.update(this.scope, (record) => {
      const previous = record.commands.find((x) => x.id === c.commandId);
      if (previous) { if (previous.digest !== digest) throw new ServiceError("IDEMPOTENCY_CONFLICT", 409); return; }
      if (c.action === "prepare") {
        if (!c.spec || c.spec.id !== c.operationId) throw new ServiceError("INVALID_HISTORY_OPERATION", 400);
        if (record.historyOperation && !["CANCELLED", "COMPLETED", "NO_DATA", "FAILED", "PARTIAL"].includes(record.historyOperation.state) || record.sync?.pending.some((x) => x.operationId) || record.events.some((x) => x.event.type === "sync.batch" && x.event.data.historical)) throw new ServiceError("HISTORY_OPERATION_PENDING", 409);
        record.historyOperation = { ...c.spec, state: "PREPARED", contacts: 0, conversations: 0, messages: 0, requests: 0, duplicates: 0, failures: 0, limited: false, keys: [], cursor: 0, target: 0, expiresAt: this.now() + 15 * 60000 };
      } else {
        const op = record.historyOperation;
        if (!op || op.id !== c.operationId) throw new ServiceError("HISTORY_OPERATION_MISMATCH", 409);
        if (["start", "resume"].includes(c.action)) {
          if (!this.executionEnabled) throw new ServiceError("HISTORY_EXECUTION_DISABLED", 403);
          if (!["PREPARED", "PAUSED"].includes(op.state)) throw new ServiceError("INVALID_HISTORY_STATE", 409);
          if (!op.anchors.length && !op.spool && !op.reference) throw new ServiceError("HISTORY_ANCHOR_REQUIRED", 409);
          op.state = "RUNNING"; op.expiresAt = this.now() + 15 * 60000; delete op.errorCode;
        } else if (c.action === "pause") { if (!["RUNNING", "WAITING", "BACKPRESSURE", "PAUSED"].includes(op.state)) throw new ServiceError("INVALID_HISTORY_STATE", 409); op.state = "PAUSED"; }
        else { if (["COMPLETED", "NO_DATA", "FAILED"].includes(op.state)) throw new ServiceError("INVALID_HISTORY_STATE", 409); op.state = "CANCELLED"; delete op.spool; delete op.reference; }
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
    await this.vault.update(this.scope, (record) => { const op = record.historyOperation; if (!op || !active(op)) return; op.failures++; op.state = op.spool || op.reference ? "PAUSED" : "PARTIAL"; op.errorCode = ["HISTORY_BYTE_LIMIT", "HISTORY_OBJECT_LIMIT", "HISTORY_DOWNLOAD_FAILED", "HISTORY_BACKPRESSURE", "HISTORY_REQUEST_UNCERTAIN", "HISTORY_TRANSPORT_UNAVAILABLE"].includes(code) ? code : "HISTORY_PROCESSING_FAILED"; });
  }
  private kick() { if (!this.pumping && !this.closed) { this.pumping = true; void this.pump().catch((error: unknown) => this.fail(error instanceof ServiceError ? error.code : "HISTORY_PROCESSING_FAILED")).finally(() => { this.pumping = false; }); } }
  private async pump() {
    const journal = new EventJournal(this.vault, this.now);
    while (this.accepting) {
      const op = this.current!;
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
          current.state = "RUNNING"; });
        continue;
      }
      if (op.messages >= op.limits.messages || op.target >= op.anchors.length || op.requests >= 16) {
        await this.vault.update(this.scope, (r) => { const current = r.historyOperation!; current.limited ||= current.requests >= 16 && current.target < current.anchors.length && current.messages < current.limits.messages; current.state = current.limited || current.failures ? "PARTIAL" : "COMPLETED"; }); return;
      }
      if (op.requestAt) {
        if (this.now() - op.requestAt > 60000) {
          await this.vault.update(this.scope, (r) => { r.historyOperation!.state = r.historyOperation!.messages || r.historyOperation!.contacts ? "PARTIAL" : "NO_DATA"; r.historyOperation!.errorCode = "HISTORY_RESPONSE_TIMEOUT"; }); return;
        }
        await delay(500); continue;
      }
      // Persist dispatch intent BEFORE network: on crash, never repeat an uncertain request.
      await this.vault.update(this.scope, (r) => { const current = r.historyOperation!; current.requests++; current.requestAt = this.now(); current.state = "WAITING"; });
      if (!this.accepting) return;
      const id = await this.request(Math.min(100, op.limits.messages - op.messages), op.nextAnchor ?? op.anchors[op.target]!);
      await this.vault.update(this.scope, (r) => { const current = r.historyOperation!; if (current.requestAt && active(current)) current.requestId = id; });
    }
    if (this.current && active(this.current)) await this.vault.update(this.scope, (r) => { r.historyOperation!.state = "PAUSED"; r.historyOperation!.errorCode = "HISTORY_AUTHORIZATION_EXPIRED"; });
  }
  close() { this.closed = true; }
  async recover() { if (this.current && active(this.current)) await this.vault.update(this.scope, (r) => { r.historyOperation!.state = "PAUSED"; r.historyOperation!.errorCode = "HISTORY_RESTART_PAUSED"; }); }
}
