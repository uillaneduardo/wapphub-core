import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflate } from "node:zlib";
import { proto, downloadContentFromMessage } from "baileys";
import { ServiceError } from "./errors.js";

export const HISTORY_COMPRESSED_BYTES = 1024 * 1024;
export const HISTORY_DECODED_BYTES = 8 * 1024 * 1024;
/** Bound BOTH sides of inflation. Never use the SDK's unbounded history reader. */
export async function decodeBoundedHistory(source: AsyncIterable<Uint8Array>, volume?: (decoded: number) => void) {
  const chunks: Buffer[] = []; let compressed = 0, decoded = 0;
  async function* input() { for await (const chunk of source) { compressed += chunk.length; if (compressed > HISTORY_COMPRESSED_BYTES) throw new ServiceError("HISTORY_BYTE_LIMIT"); yield chunk; } }
  await pipeline(Readable.from(input()), createInflate(), async (output) => {
    for await (const chunk of output) { decoded += chunk.length; if (decoded > HISTORY_DECODED_BYTES) throw new ServiceError("HISTORY_BYTE_LIMIT"); chunks.push(Buffer.from(chunk)); }
  });
  volume?.(decoded);
  return proto.HistorySync.decode(Buffer.concat(chunks));
}
export async function readBoundedHistory(notification: proto.Message.IHistorySyncNotification, signal: AbortSignal) {
  let decodedBytes = 0;
  if (notification.initialHistBootstrapInlinePayload) {
    const history = await decodeBoundedHistory(Readable.from([notification.initialHistBootstrapInlinePayload]), (bytes) => { decodedBytes = bytes; });
    return { history, decodedBytes };
  }
  const size = Number(notification.fileLength);
  if (!Number.isSafeInteger(size) || size <= 0 || size > HISTORY_COMPRESSED_BYTES || !notification.directPath || !notification.mediaKey) throw new ServiceError("HISTORY_BYTE_LIMIT");
  const stream = await downloadContentFromMessage(notification, "md-msg-hist", { options: { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) } });
  const history = await decodeBoundedHistory(stream, (bytes) => { decodedBytes = bytes; });
  return { history, decodedBytes };
}
