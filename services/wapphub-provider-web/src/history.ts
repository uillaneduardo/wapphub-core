import { createHash } from "node:crypto";
import type { PrivateFiles } from "./private-files.js";
import type { Scope } from "./vault.js";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflate } from "node:zlib";
import { proto, downloadContentFromMessage } from "baileys";
import { boundHistoryObjects, type HistoryPage } from "./history-selection.js";
import { ServiceError } from "./errors.js";

export const HISTORY_COMPRESSED_BYTES = 4 * 1024 * 1024;
export const HISTORY_DECODED_BYTES = 16 * 1024 * 1024;
/** Bound BOTH sides of inflation. Never use the SDK's unbounded history reader. */
export async function decodeBoundedHistory(source: AsyncIterable<Uint8Array>, volume?: (decoded: number) => void, window?: { from: string; to: string }, page?: HistoryPage) {
  const chunks: Buffer[] = []; let compressed = 0, decoded = 0;
  async function* input() { for await (const chunk of source) { compressed += chunk.length; if (compressed > HISTORY_COMPRESSED_BYTES) throw new ServiceError("HISTORY_BYTE_LIMIT"); yield chunk; } }
  await pipeline(Readable.from(input()), createInflate(), async (output) => {
    for await (const chunk of output) { decoded += chunk.length; if (decoded > HISTORY_DECODED_BYTES) throw new ServiceError("HISTORY_BYTE_LIMIT"); chunks.push(Buffer.from(chunk)); }
  });
  volume?.(decoded);
  return proto.HistorySync.decode(boundHistoryObjects(Buffer.concat(chunks), window, page));
}
export async function readBoundedHistory(notification: proto.Message.IHistorySyncNotification, signal: AbortSignal, window?: { from: string; to: string }, page?: HistoryPage, cache?: { files: PrivateFiles; scope: Scope; id: string }) {
  let decodedBytes = 0;
  if (cache) {
    const inline = notification.initialHistBootstrapInlinePayload;
    const size = inline?.length ?? Number(notification.fileLength), sha256 = inline ? createHash("sha256").update(inline).digest("hex") : notification.fileSha256?.length === 32 ? Buffer.from(notification.fileSha256).toString("hex") : "";
    if (!Number.isSafeInteger(size) || size <= 0 || size > HISTORY_COMPRESSED_BYTES || !sha256) throw new ServiceError("HISTORY_BYTE_LIMIT", 413);
    if (!await cache.files.has(cache.scope, cache.id)) {
      if (!inline && (!notification.directPath || !/^\/[^\s\\?#]{1,1800}$/.test(notification.directPath) || !notification.mediaKey)) throw new ServiceError("HISTORY_BYTE_LIMIT", 413);
      const source = inline ? Readable.from([inline]) : await downloadContentFromMessage({ directPath: notification.directPath, mediaKey: notification.mediaKey }, "md-msg-hist", { host: "mmg.whatsapp.net", options: { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) } });
      await cache.files.put(cache.scope, cache.id, source, { size, sha256 });
    }
    const history = await decodeBoundedHistory(await cache.files.stream(cache.scope, cache.id, { size, sha256 }), bytes => { decodedBytes = bytes; }, window, page);
    return { history, decodedBytes };
  }
  if (notification.initialHistBootstrapInlinePayload) {
    const history = await decodeBoundedHistory(Readable.from([notification.initialHistBootstrapInlinePayload]), (bytes) => { decodedBytes = bytes; }, window, page);
    return { history, decodedBytes };
  }
  const size = Number(notification.fileLength);
  if (!Number.isSafeInteger(size) || size <= 0 || size > HISTORY_COMPRESSED_BYTES || !notification.directPath || !notification.mediaKey) throw new ServiceError("HISTORY_BYTE_LIMIT");
  const stream = await downloadContentFromMessage(notification, "md-msg-hist", { options: { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) } });
  const history = await decodeBoundedHistory(stream, (bytes) => { decodedBytes = bytes; }, window, page);
  return { history, decodedBytes };
}
